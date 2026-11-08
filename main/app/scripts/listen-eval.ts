/**
 * Scores the sound listener on real recordings, against the loudness detector it replaces.
 *
 *   node scripts/listen-eval.ts <data dir> [--sound confirm|continuous] [--users N] [--verbose]
 *
 * The data dir holds three public sets, all 16 kHz mono WAV (see `scripts/fetch-listen-data.sh`):
 *  - cnvve/  CNVVE (Hedeshy et al., Interspeech 2023, CC BY 4.0): 48 people's "mm-hmm" (confirm),
 *            "uh-uh" (decline), humming (continuous), "ahem", "shh" (hush) and "psst".
 *  - esc16/  ESC-50 (Piczak 2015, CC BY-NC 3.0) clips: claps, knocks, coughs, laughs, traffic, wind…
 *  - tts/    other talkers: macOS voices saying sentences (s_*) and backchannels (b_*: mhm, yeah…).
 *
 * Each CNVVE person with five takes of the select sound plays the user twice: enrolled on three
 * takes (plus their own "ahem" and "shh" as negatives and a bank of other people's sounds), then
 * tested in a scene with background noise where their two held-out takes (each three times, at
 * ±3 dB) mix with sounds that must not select:
 *  - another person making the same sound, at the user's level and 6 dB below (a neighbour);
 *  - other people's other sounds; talkers (sentences and "mhm/yeah/okay"), at 0, -6 and -12 dB;
 *  - claps, knocks, coughs, laughs and other ESC-50 events, at 0 to +6 dB;
 *  - the user's own "uh-uh" (reported apart: it is nearly the same sound as "mm-hmm").
 * People in the bank and people in the scenes never overlap; nor do ESC-50 clips or voices.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RATE } from '../src/listen/features.ts';
import type { SoundEvent } from '../src/listen/events.ts';
import { eventsIn, mainEvent, takeEvents } from '../src/listen/takes.ts';
import { enroll, judge, judgeGeneric, sequenceOf, type Profile, type Template } from '../src/listen/matcher.ts';
import { decodeTemplate, encodeTemplate } from '../src/listen/store.ts';
import { activeDb, asTake, mswcBankFiles, mswcClips, readWav, speechCommandsBankFiles, speechCommandsBankSide } from './listen-audio.ts';

const args = process.argv.slice(2);
const DATA = args[0];
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const SOUND = opt('sound', 'confirm');
const SCALES = opt('scales', '1').split(',').map(Number);
const RATIO = Number(opt('ratio', '1'));
const NEGK = Number(opt('negk', '1'));
const AUG = args.includes('--augment');
const NOBANK = args.includes('--nobank');
/** TORGO (Rudzicz et al. 2012; free for academic, non-profit use): dysarthric speakers saying words. */
const TORGO = opt('torgo', '');
const TORGO_BANK = args.includes('--torgo-bank');
let summary = '';
const CNVVE_BANK = args.includes('--cnvve-bank');
const latencies: number[] = [];
const MAX_USERS = Number(opt('users', '99'));
const VERBOSE = args.includes('--verbose');
/** Speech Commands v0.02 (Warden 2018, CC BY 4.0): thousands of people saying "yes", "no"… */
const SC = opt('sc', '');
/** Multilingual Spoken Words (CC BY 4.0) "yeah"/"yes" clips: other people saying "yeah" in the scenes. */
const MSWC = opt('mswc', '');
/** AudioMNIST (Becker et al. 2018, MIT licence): 60 people saying each digit 50 times. */
const AUDIOMNIST = opt('audiomnist', '');
/** A learning curve: one listener column per number of teaching takes, on the same scenes. */
const CURVE = opt('takes', '').split(',').filter(Boolean).map(Number);
/** Held-out takes per person (one per enrolment) in the curve and Speech Commands runs. */
const FOLDS = Number(opt('folds', '3'));
/** The adaptive setup: after n takes, more (up to this many) while a take would be rejected. */
const [ADAPT_FROM, ADAPT] = opt('adapt', '0:0').split(':').map(Number);
/** The bank the Speech Commands run starts from, and what it adds to it in-process. */
const BANK_FILE = opt('bank', join(import.meta.dirname, '../public/listen/bank.json'));
const ADD_SC = Number(opt('add-sc', '0'));
const ADD_SC_WORDS = opt('add-sc-words', 'yes,no').split(',');
const ADD_MSWC = Number(opt('add-mswc', '0'));

// ---------- audio files ----------
const scaled = (x: Float32Array, db: number) => { const g = 10 ** ((db - activeDb(x)) / 20); return x.map((v) => v * g); };

// Deterministic randomness, so runs are comparable.
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- the sets ----------
type Clip = { file: string; kind: string; speaker: string };
const cnvve: Clip[] = readdirSync(join(DATA, 'cnvve')).filter((f) => f.endsWith('.wav')).map((f) => { const [kind, speaker] = f.split('_'); return { file: join(DATA, 'cnvve', f), kind, speaker }; });
const seen: Record<string, number> = {};
// Alternate clips of each category go to enrolment-time use and to the test scenes.
const escMeta = readFileSync(join(DATA, 'esc_pick.txt'), 'utf8').trim().split('\n').map((l) => { const [f, cat] = l.split(' '); seen[cat] = (seen[cat] ?? 0) + 1; return { file: join(DATA, 'esc16', f), cat, test: seen[cat] % 2 === 0 }; });
const BEDS = new Set(['rain', 'wind', 'engine', 'train', 'crackling_fire', 'vacuum_cleaner', 'washing_machine', 'helicopter', 'airplane', 'chirping_birds', 'water_drops']);
const escBeds = escMeta.filter((e) => BEDS.has(e.cat));
const escEvents = escMeta.filter((e) => !BEDS.has(e.cat));
const tts = readdirSync(join(DATA, 'tts')).filter((f) => f.endsWith('.wav')).map((f) => { const [type, voice] = f.split('_'); return { file: join(DATA, 'tts', f), type, voice }; });
const voices = [...new Set(tts.map((t) => t.voice))].sort();
const bankVoices = new Set(voices.filter((_, i) => i % 2 === 0));

const cache = new Map<string, Float32Array>();
const audio = (file: string) => { let a = cache.get(file); if (!a) { a = readWav(file); cache.set(file, a); } return a; };

// ---------- running the listener over audio ----------
const eventsOf = eventsIn;

/** A clip as recorded at enrolment: 0.5 s of a quiet room before it and after it. */
function inRoom(x: Float32Array, roomDb: number, room: Float32Array): Float32Array {
  const lead = 8000;
  const buf = new Float32Array(lead + x.length + 8000);
  const r = scaled(room, roomDb);
  for (let i = 0; i < buf.length; i++) buf[i] = r[i % r.length];
  for (let i = 0; i < x.length; i++) buf[lead + i] += x[i];
  return buf;
}
const enrolEvent = (x: Float32Array, roomDb: number, room: Float32Array) => mainEvent(inRoom(x, roomDb, room));

/** Today's detector (soundSelect.ts): band level vs a 2 s 20th-percentile floor. */
function legacyDetections(x: Float32Array): number[] {
  // 150 Hz high-pass and 3 kHz low-pass (RBJ biquads, Q 0.707), as the Web Audio graph does.
  const biquad = (y: Float32Array, f: number, high: boolean) => {
    const w = (2 * Math.PI * f) / RATE, al = Math.sin(w) / (2 * 0.7071), c = Math.cos(w);
    const b0 = high ? (1 + c) / 2 : (1 - c) / 2, b1 = high ? -(1 + c) : 1 - c, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    const o = new Float32Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = (b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; }
    return o;
  };
  const y = biquad(biquad(x, 150, true), 3000, false);
  const FRAME = 320, WIN = 341, out: number[] = [];
  const recent: number[] = [];
  let quietRun = 0, lastQuietRun = 0, sinceQuiet = 0, loudFor = 0, armed = true;
  for (let i = WIN; i < y.length; i += FRAME) {
    let s = 0; for (let j = i - WIN; j < i; j++) s += y[j] * y[j];
    const db = 10 * Math.log10(s / WIN + 1e-12);
    recent.push(db); if (recent.length > 100) recent.shift();
    const floor = [...recent].sort((a, b) => a - b)[Math.floor(recent.length * 0.2)];
    const loud = db > floor + 10 && db > -62, quiet = db < floor + 6;
    loudFor = loud ? loudFor + 20 : 0;
    if (quiet) { quietRun += 20; sinceQuiet = 0; } else { if (quietRun) lastQuietRun = quietRun; quietRun = 0; sinceQuiet += 20; }
    if (!armed) { if (quietRun >= 150) armed = true; continue; }
    if (loudFor >= 60 && lastQuietRun >= 150 && sinceQuiet <= loudFor + 120) { armed = false; lastQuietRun = 0; out.push(i / RATE); }
  }
  return out;
}

// ---------- scenes ----------
type Region = { start: number; end: number; label: string };
const USER_DB = -26; // a voice at about 50 cm from a laptop microphone, before any gain

function scene(parts: { x: Float32Array; db: number; label: string }[], bedDb: number): { audio: Float32Array; regions: Region[] } {
  const gap = () => Math.round((1.6 + rand() * 1.4) * RATE);
  const total = parts.reduce((s, p) => s + p.x.length, 0) + parts.length * 3 * RATE + RATE;
  const out = new Float32Array(total);
  const bedClips = shuffle(escBeds);
  let p = 0, k = 0;
  while (p < total) { const b = scaled(audio(bedClips[k++ % bedClips.length].file), bedDb); out.set(b.subarray(0, Math.min(b.length, total - p)), p); p += b.length; }
  const regions: Region[] = [];
  let at = RATE;
  for (const part of parts) {
    const x = scaled(part.x, part.db);
    for (let i = 0; i < x.length && at + i < total; i++) out[at + i] += x[i];
    regions.push({ start: at / RATE, end: (at + x.length) / RATE + 0.3, label: part.label });
    at += x.length + gap();
  }
  return { audio: out, regions };
}

type Tally = Record<string, { n: number; selected: number }>;
const add = (t: Tally, label: string, selected: boolean) => { t[label] ??= { n: 0, selected: 0 }; t[label].n++; if (selected) t[label].selected++; };

function attribute(times: number[], regions: Region[]): { hits: Map<Region, number>; stray: number } {
  const hits = new Map<Region, number>(); let stray = 0;
  for (const t of times) { const r = regions.find((g) => t >= g.start && t <= g.end + 0.4); if (r) hits.set(r, (hits.get(r) ?? 0) + 1); else stray++; }
  return { hits, stray };
}

// ---------- the run ----------
const bySpeaker = new Map<string, Clip[]>();
for (const c of cnvve) { const l = bySpeaker.get(c.speaker) ?? []; l.push(c); bySpeaker.set(c.speaker, l); }
const users = [...bySpeaker.keys()].sort().filter((s) => bySpeaker.get(s)!.filter((c) => c.kind === SOUND).length >= (CURVE.length ? Math.max(...CURVE, ADAPT) + 1 : 5)).slice(0, MAX_USERS);
const quietRoom = audio(escBeds.find((e) => e.cat === 'rain')!.file);

/** One listener under test: a profile and the scale it is judged at. */
type Column = { name: string; profile: Profile; scale: number };
const byScale = (profile: Profile): Column[] => SCALES.map((scale) => ({ name: `listener×${scale}`, profile, scale }));
const runNames = ['legacy', 'generic'];
const tallies: Record<string, Tally> = { legacy: {}, generic: {} };
const stray: Record<string, number> = { legacy: 0, generic: 0 };
const reasons: Record<string, number> = {};
/** Milliseconds to judge one sound event, per column. */
const judgeMs: number[] = [];
let seconds = 0;
const t0 = performance.now();

/** Mix a scene from the parts, run every detector over it and tally what each selected. */
function score(columns: Column[], parts: { x: Float32Array; db: number; label: string }[], tag: string): void {
  for (const c of columns) if (!runNames.includes(c.name)) { runNames.push(c.name); tallies[c.name] = {}; stray[c.name] = 0; }
  const profile = columns[0].profile;
  const { audio: mix, regions } = scene(shuffle(parts), USER_DB - 18);
  seconds += mix.length / RATE;
  const { events } = eventsOf(mix);
  const verdicts = events.map((e) => {
    const t = performance.now();
    const all = columns.map((c) => judge(c.profile, e, { scale: c.scale, ratio: RATIO, negK: NEGK }));
    judgeMs.push((performance.now() - t) / columns.length);
    return { e, v: all[0], g: judgeGeneric(e), all: all.map((v) => v.accept) };
  });
  for (const { v } of verdicts) if (!v.accept) reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
  const runs: Record<string, number[]> = {
    legacy: legacyDetections(mix),
    generic: verdicts.filter((x) => x.g.accept).map((x) => x.e.at),
    ...Object.fromEntries(columns.map((c, i) => [c.name, verdicts.filter((v) => v.all[i]).map((v) => v.e.at)])),
  };
  for (const r of regions.filter((g) => g.label === 'user')) { const t = runs[columns[0].name].find((x) => x >= r.start && x <= r.end + 0.4); if (t !== undefined) latencies.push(t - r.start); }
  for (const [name, times] of Object.entries(runs)) {
    const { hits, stray: s } = attribute(times, regions);
    stray[name] += s;
    for (const r of regions) add(tallies[name], r.label.startsWith('noise:') ? 'noise (claps, knocks, coughs, laughs…)' : r.label.startsWith('talker sentence') ? 'talker, sentence (0/-6/-12 dB)' : r.label, (hits.get(r) ?? 0) > 0);
  }
  if (VERBOSE) {
    const userRegions = regions.filter((r) => r.label === 'user');
    const missed = userRegions.filter((r) => !verdicts.some((x) => x.v.accept && x.e.at >= r.start && x.e.at <= r.end + 0.4));
    for (const r of missed) {
      const near = verdicts.filter((x) => x.e.at >= r.start && x.e.at <= r.end + 0.4);
      if (!near.length && args.includes('--debug')) {
        const fr = eventsOf(mix).frames.filter((f) => f.t >= r.start - 0.5 && f.t <= r.end);
        console.log('    levels', fr.filter((_, i) => i % 3 === 0).map((f) => f.db.toFixed(0)).join(' '));
        console.log('    events nearby', events.filter((e) => e.start > r.start - 3 && e.start < r.end + 1).map((e) => `${e.start.toFixed(2)}-${e.at.toFixed(2)}`).join(' '), 'region', r.start.toFixed(2), r.end.toFixed(2));
      }
      console.log(`  ${tag} missed take at ${r.start.toFixed(1)}s: ${near.map((x) => `${x.v.reason}${x.v.distance ? ` d=${x.v.distance.toFixed(2)}/${profile.threshold.toFixed(2)} neg=${x.v.nearestNegative?.toFixed(2) ?? ''}` : ''} peak=${x.e.stats.peakDb.toFixed(0)}/${profile.level.low.toFixed(0)}`).join('; ') || 'no event'}`);
    }
  }
}

/** How many takes the adaptive setup asked each person for. */
const adaptTakes: number[] = [];
/** Whether some take, judged by a profile taught from the others, would be rejected. */
function inconsistent(takes: SoundEvent[][], ownNeg: SoundEvent[], bank: Template[]): boolean {
  return takes.some((variants, i) => !judge(enroll(takes.filter((_, j) => j !== i), ownNeg, bank), variants[0], { scale: SCALES[0] }).accept);
}

/**
 * The listeners a person's scene is scored with. Without --takes, one profile from all of `pool`
 * at each scale; with it, one profile per number of teaching takes (the first n of `pool`) at the
 * first scale, and with --adapt n:cap the adaptive setup: n takes, then one more while a take
 * would be rejected, up to cap.
 */
function columnsFor(pool: SoundEvent[][], ownNeg: SoundEvent[], bank: Template[]): Column[] {
  if (!CURVE.length) return byScale(enroll(pool, ownNeg, bank));
  const columns = CURVE.map((n) => ({ name: `n=${n}`, profile: enroll(pool.slice(0, n), ownNeg, bank), scale: SCALES[0] }));
  if (ADAPT_FROM) {
    let n = ADAPT_FROM;
    while (n < Math.min(ADAPT, pool.length) && inconsistent(pool.slice(0, n), ownNeg, bank)) n++;
    adaptTakes.push(n);
    columns.push({ name: `adapt ${ADAPT_FROM}..${ADAPT}`, profile: enroll(pool.slice(0, n), ownNeg, bank), scale: SCALES[0] });
  }
  return columns;
}

if (!TORGO && !SC && !AUDIOMNIST) {
for (const user of users) {
  const own = bySpeaker.get(user)!;
  const takes = own.filter((c) => c.kind === SOUND).slice(0, CURVE.length ? undefined : 5);
  const others = [...bySpeaker.keys()].filter((s) => s !== user).sort();
  const bankPeople = new Set(others.filter((_, i) => i % 2 === 0));
  const scenePeople = others.filter((s) => !bankPeople.has(s));
  // The shipped bank: other people's vocal sounds and talkers, never the scene's.
  const bank: Template[] = [];
  for (const s of bankPeople) for (const c of bySpeaker.get(s)!.filter((c) => c.kind !== 'hush' && c.kind !== 'psst').slice(0, 6)) { const e = enrolEvent(scaled(audio(c.file), USER_DB), USER_DB - 30, quietRoom); if (e) bank.push({ seq: sequenceOf(e), stats: e.stats }); }
  for (const t of CNVVE_BANK ? [] : tts.filter((t) => bankVoices.has(t.voice)).slice(0, 40)) { const e = enrolEvent(scaled(audio(t.file), USER_DB), USER_DB - 30, quietRoom); if (e) bank.push({ seq: sequenceOf(e), stats: e.stats }); }

  // Two enrolments on three takes each, testing the other two; with --takes, one held-out take
  // per enrolment and the rest, in order, to teach from.
  for (const fold of CURVE.length ? [...Array(Math.min(FOLDS, takes.length)).keys()] : [0, 1]) {
    const enrolTakes = CURVE.length ? [...takes.slice(fold + 1), ...takes.slice(0, fold)] : fold === 0 ? takes.slice(0, 3) : takes.slice(2, 5);
    const testTakes = CURVE.length ? [takes[fold]] : fold === 0 ? takes.slice(3, 5) : takes.slice(0, 2);
    const enrolEvents = enrolTakes.map((c) => { const x = inRoom(scaled(audio(c.file), USER_DB + (rand() - 0.5) * 4), USER_DB - 30, quietRoom); return AUG ? takeEvents(x) : [mainEvent(x)].filter((e): e is SoundEvent => !!e); }).filter((v) => v.length);
    const ownNeg = own.filter((c) => c.kind === 'ahem' || c.kind === 'hush').slice(0, 4).map((c) => enrolEvent(scaled(audio(c.file), USER_DB), USER_DB - 30, quietRoom)).filter((e): e is SoundEvent => !!e);
    const columns = columnsFor(enrolEvents, ownNeg, NOBANK ? [] : bank);

    const parts: { x: Float32Array; db: number; label: string }[] = [];
    for (const c of testTakes) for (let r = 0; r < 3; r++) parts.push({ x: audio(c.file), db: USER_DB + (rand() - 0.5) * 6, label: 'user' });
    const neighbours = shuffle(scenePeople).slice(0, 4);
    for (const s of neighbours) {
      const same = bySpeaker.get(s)!.filter((c) => c.kind === SOUND);
      if (same.length) { parts.push({ x: audio(pick(same).file), db: USER_DB, label: 'neighbour, same sound, same distance' }); parts.push({ x: audio(pick(same).file), db: USER_DB - 6, label: 'neighbour, same sound, 2x distance' }); }
      const other = bySpeaker.get(s)!.filter((c) => c.kind !== SOUND);
      if (other.length) parts.push({ x: audio(pick(other).file), db: USER_DB, label: 'neighbour, other sounds' });
    }
    for (const c of own.filter((c) => c.kind === 'decline').slice(0, 2)) parts.push({ x: audio(c.file), db: USER_DB, label: "user's own uh-uh" });
    for (const c of own.filter((c) => c.kind === 'psst').slice(0, 1)) parts.push({ x: audio(c.file), db: USER_DB, label: "user's own psst" });
    const testVoices = tts.filter((t) => !bankVoices.has(t.voice));
    for (let i = 0; i < 3; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 's')).file), db: USER_DB - 6 * i, label: `talker sentence, ${-6 * i} dB` });
    for (let i = 0; i < 3; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 'b')).file), db: USER_DB - 3 * i, label: `talker "mhm/yeah/okay"` });
    const testEsc = escEvents.filter((e) => e.test);
    for (let i = 0; i < 6; i++) { const e = pick(testEsc); parts.push({ x: audio(e.file), db: USER_DB + rand() * 6, label: `noise: ${e.cat}` }); }

    score(columns, parts, `${user}/${fold}`);
  }
}
}


if (SC || AUDIOMNIST) {
  // People saying one word several times each. Speech Commands: <dir>/<word>/<speaker>_nohash_<n>.wav,
  // up to five distinct takes of "yes" (the nearest word to "yeah") from hundreds of people.
  // AudioMNIST: <digit>_<speaker>_<n>.wav, 60 people saying digits 50 times each (16 here), for
  // the long end of the learning curve.
  type Rec = { file: string; word: string; speaker: string; take: number };
  const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const takeOf = (f: string) => Number(/_(\d+)\.wav$/.exec(f)![1]);
  const listed: Rec[] = AUDIOMNIST
    ? readdirSync(AUDIOMNIST).filter((f) => f.endsWith('.wav')).map((f) => ({ file: join(AUDIOMNIST, f), word: DIGITS[Number(f.split('_')[0])], speaker: f.split('_')[1], take: takeOf(f) }))
    : readdirSync(SC).filter((d) => /^[a-z]+$/.test(d)).flatMap((word) => readdirSync(join(SC, word)).filter((f) => f.endsWith('.wav')).map((f) => ({ file: join(SC, word, f), word, speaker: f.split('_')[0], take: takeOf(f) })));
  // Some Speech Commands recordings are exact copies of another (119 of the "yes" files): a
  // person's takes count once each, or a held-out take would be its own copy.
  const seenAudio = new Set<string>();
  const recs = listed.sort((x, y) => x.word.localeCompare(y.word) || x.speaker.localeCompare(y.speaker) || x.take - y.take)
    .filter((r) => { const h = createHash('sha1').update(readFileSync(r.file)).digest('hex'); return !seenAudio.has(h) && !!seenAudio.add(h); });
  const takesOf = new Map<string, Rec[]>();
  for (const r of recs) { const k = `${r.speaker} ${r.word}`; const l = takesOf.get(k) ?? []; l.push(r); takesOf.set(k, l); }
  const yesTakes = (s: string) => takesOf.get(`${s} yes`)?.length ?? 0;
  const bankSide = (s: string) => !AUDIOMNIST && speechCommandsBankSide(s, yesTakes(s));
  const need = Number(opt('need', '0')) || (CURVE.length ? Math.max(...CURVE, ADAPT) + 1 : 9);
  const speakers = [...new Set(recs.map((r) => r.speaker))].sort();
  // Each person teaches one word: "yes" in Speech Commands, one of the digits in AudioMNIST.
  const AM_WORDS = [...new Set(recs.map((r) => r.word))].sort();
  const people = speakers.map((speaker, i) => ({ speaker, word: AUDIOMNIST ? AM_WORDS[i % AM_WORDS.length] : 'yes' }))
    .filter((p) => !bankSide(p.speaker) && (takesOf.get(`${p.speaker} ${p.word}`)?.length ?? 0) >= need).slice(0, MAX_USERS);
  const sceneRecs = recs.filter((r) => !bankSide(r.speaker));
  // The shipped bank, plus what an experiment adds: bank-side Speech Commands people and MSWC's
  // dev split, prepared exactly as `build-listen-bank.ts` prepares them.
  const asBank = (file: string) => { const e = mainEvent(asTake(audio(file))); return e ? decodeTemplate(encodeTemplate({ seq: sequenceOf(e), stats: e.stats })) : null; };
  const shipped = (JSON.parse(readFileSync(BANK_FILE, 'utf8')) as { templates: Parameters<typeof decodeTemplate>[0][] }).templates.map(decodeTemplate);
  const scBankFiles = SC && ADD_SC ? speechCommandsBankFiles(SC, ADD_SC, ADD_SC_WORDS) : [];
  const added = [...scBankFiles, ...(MSWC && ADD_MSWC ? mswcBankFiles(MSWC, ADD_MSWC) : [])].map(asBank).filter((t): t is Template => !!t);
  const bank = NOBANK ? [] : [...shipped, ...added];
  const mswcYeah = MSWC ? mswcClips(MSWC, 'test', 'yeah') : [];
  const ttsYeah = tts.filter((t) => t.type === 'b' && !bankVoices.has(t.voice) && t.file.endsWith('_3.wav'));
  let trials = 0;
  for (const { speaker: user, word } of people) {
    const takes = takesOf.get(`${user} ${word}`)!;
    const mine = shuffle(recs.filter((r) => r.speaker === user && r.word !== word));
    const others = [...new Set(sceneRecs.map((r) => r.speaker))].filter((s) => s !== user);
    for (let fold = 0; fold < Math.min(FOLDS, takes.length); fold++) {
      trials++;
      // One take held out; the others, in order from the one after it, to teach from.
      const held = takes[takes.length - 1 - fold];
      const pool = [...takes.slice(takes.length - fold), ...takes.slice(0, takes.length - 1 - fold)].slice(0, need - 1);
      const enrolEvents = pool.map((r) => { const x = inRoom(scaled(audio(r.file), USER_DB + (rand() - 0.5) * 4), USER_DB - 30, quietRoom); return AUG ? takeEvents(x) : [mainEvent(x)].filter((e): e is SoundEvent => !!e); }).filter((v) => v.length);
      // Their other words: some heard at the "anything but" step, the rest in the scene.
      const ownNeg = mine.slice(0, 3).map((r) => enrolEvent(scaled(audio(r.file), USER_DB), USER_DB - 30, quietRoom)).filter((e): e is SoundEvent => !!e);
      const columns = columnsFor(enrolEvents, ownNeg, bank);
      const parts: { x: Float32Array; db: number; label: string }[] = [];
      for (let k = 0; k < 3; k++) parts.push({ x: audio(held.file), db: USER_DB + (rand() - 0.5) * 6, label: 'user' });
      for (const r of mine.slice(3, 6)) parts.push({ x: audio(r.file), db: USER_DB, label: "user's own other words" });
      for (const s of shuffle(others).slice(0, 4)) {
        const theirs = sceneRecs.filter((r) => r.speaker === s);
        const same = theirs.filter((r) => r.word === word), other = theirs.filter((r) => r.word !== word);
        if (same.length) { parts.push({ x: audio(pick(same).file), db: USER_DB, label: 'neighbour, same word, same distance' }); parts.push({ x: audio(pick(same).file), db: USER_DB - 6, label: 'neighbour, same word, 2x distance' }); }
        if (other.length) parts.push({ x: audio(pick(other).file), db: USER_DB, label: 'neighbour, other words' });
      }
      for (let i = 0; i < 2 && mswcYeah.length; i++) parts.push({ x: audio(pick(mswcYeah).file), db: USER_DB, label: 'neighbour, "yeah" (MSWC), same distance' });
      parts.push({ x: audio(pick(ttsYeah).file), db: USER_DB, label: 'talker "yeah" (TTS), same distance' });
      const testVoices = tts.filter((t) => !bankVoices.has(t.voice));
      for (let i = 0; i < 3; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 's')).file), db: USER_DB - 6 * i, label: `talker sentence, ${-6 * i} dB` });
      for (let i = 0; i < 2; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 'b')).file), db: USER_DB - 3 * i, label: `talker "mhm/yeah/okay"` });
      for (let i = 0; i < 6; i++) { const e = pick(escEvents.filter((e) => e.test)); parts.push({ x: audio(e.file), db: USER_DB + rand() * 6, label: `noise: ${e.cat}` }); }
      score(columns, parts, `${user}/${word}/${fold}`);
    }
  }
  summary = `${AUDIOMNIST ? 'AudioMNIST digits' : 'Speech Commands "yes"'}: ${people.length} people with ≥ ${need} takes × ${trials / Math.max(1, people.length)} enrolments (one take held out each, ${need - 1} to teach from), bank: ${shipped.length} shipped + ${added.length} added (${scBankFiles.length} Speech Commands clips${ADD_MSWC ? `, ${ADD_MSWC} MSWC dev clips` : ''})`;
}

if (TORGO) {
  // index.tsv: speaker, session, wav path (relative to the TORGO dir), prompt; built by the fetch notes.
  type Rec = { speaker: string; file: string; word: string };
  const recs: Rec[] = readFileSync(join(TORGO, 'index.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'))
    .filter((r) => /^[a-z]+$/.test(r[3]) && r[3] !== 'xxx').map((r) => ({ speaker: r[0], file: join(TORGO, r[2]), word: r[3] }));
  const speakers = [...new Set(recs.map((r) => r.speaker))].sort();
  const dysarthric = speakers.filter((s) => !s.includes('C'));
  const bankSpeakers = new Set(speakers.filter((_, i) => i % 2 === 1));
  // The shipped bank (CNVVE) plus, with --torgo-bank, other TORGO speakers' words.
  const cnvveBank: Template[] = [];
  for (const [, clips] of [...bySpeaker].sort()) for (const c of clips.filter((c) => c.kind !== 'hush' && c.kind !== 'psst').slice(0, 6)) { const e = enrolEvent(scaled(audio(c.file), USER_DB), USER_DB - 30, quietRoom); if (e) cnvveBank.push({ seq: sequenceOf(e), stats: e.stats }); }
  let trials = 0;
  for (const user of dysarthric) {
    const mine = recs.filter((r) => r.speaker === user);
    const counts = new Map<string, number>();
    for (const r of mine) counts.set(r.word, (counts.get(r.word) ?? 0) + 1);
    const words = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([w]) => w);
    const others = speakers.filter((s) => s !== user);
    const bank = [...cnvveBank];
    if (TORGO_BANK) for (const r of shuffle(recs.filter((r) => r.speaker !== user && bankSpeakers.has(r.speaker))).slice(0, 150)) { const e = enrolEvent(scaled(audio(r.file), USER_DB), USER_DB - 30, quietRoom); if (e) bank.push({ seq: sequenceOf(e), stats: e.stats }); }
    const sceneSpeakers = others.filter((s) => !TORGO_BANK || !bankSpeakers.has(s));
    for (const word of words) {
      const takes = mine.filter((r) => r.word === word);
      const rest = shuffle(mine.filter((r) => r.word !== word));
      for (let held = 0; held < takes.length; held++) {
        const enrolEvents = takes.filter((_, i) => i !== held).map((r) => { const x = inRoom(scaled(audio(r.file), USER_DB + (rand() - 0.5) * 4), USER_DB - 30, quietRoom); return AUG ? takeEvents(x) : [mainEvent(x)].filter((e): e is SoundEvent => !!e); }).filter((v) => v.length);
        const ownNeg = rest.slice(0, 4).map((r) => enrolEvent(scaled(audio(r.file), USER_DB), USER_DB - 30, quietRoom)).filter((e): e is SoundEvent => !!e);
        if (CURVE.length && enrolEvents.length < Math.max(...CURVE)) continue;
        trials++;
        const columns = columnsFor(enrolEvents, ownNeg, NOBANK ? [] : bank);
        const parts: { x: Float32Array; db: number; label: string }[] = [];
        for (let k = 0; k < 3; k++) parts.push({ x: audio(takes[held].file), db: USER_DB + (rand() - 0.5) * 6, label: 'user' });
        for (const r of rest.slice(4, 8)) parts.push({ x: audio(r.file), db: USER_DB, label: "user's own other words" });
        const same = shuffle(recs.filter((r) => r.word === word && sceneSpeakers.includes(r.speaker)));
        same.slice(0, 2).forEach((r) => parts.push({ x: audio(r.file), db: USER_DB, label: 'neighbour, same word, same distance' }));
        same.slice(2, 4).forEach((r) => parts.push({ x: audio(r.file), db: USER_DB - 6, label: 'neighbour, same word, 2x distance' }));
        shuffle(recs.filter((r) => r.word !== word && sceneSpeakers.includes(r.speaker))).slice(0, 3).forEach((r) => parts.push({ x: audio(r.file), db: USER_DB, label: 'neighbour, other words' }));
        const testVoices = tts.filter((t) => !bankVoices.has(t.voice));
        for (let i = 0; i < 2; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 's')).file), db: USER_DB - 6 * i, label: `talker sentence, ${-6 * i} dB` });
        for (let i = 0; i < 2; i++) parts.push({ x: audio(pick(testVoices.filter((t) => t.type === 'b')).file), db: USER_DB - 3 * i, label: `talker "mhm/yeah/okay"` });
        for (let i = 0; i < 4; i++) { const e = pick(escEvents.filter((e) => e.test)); parts.push({ x: audio(e.file), db: USER_DB + rand() * 6, label: `noise: ${e.cat}` }); }
        score(columns, parts, `${user}/${word}/${held}`);
      }
    }
  }
  summary = `TORGO: ${dysarthric.length} dysarthric speakers, their most repeated words as the select sound, ${trials} enrolments (all takes but one; the held-out take tested), ${TORGO_BANK ? 'bank: CNVVE + other TORGO speakers' : 'bank: CNVVE'}`;
} else if (!SC && !AUDIOMNIST) summary = `${users.length} people × ${CURVE.length ? `${FOLDS} enrolments (one take held out each)` : '2 enrolments'}, select sound "${SOUND}"`;

const minutes = seconds / 60;
console.log(`${summary}, ${minutes.toFixed(1)} min of scenes, ${((performance.now() - t0) / 1000).toFixed(0)} s to run\n`);
const labels = [...new Set(Object.values(tallies).flatMap((t) => Object.keys(t)))].sort((a, b) => (a === 'user' ? -1 : b === 'user' ? 1 : a.localeCompare(b)));
const pct = (t: Tally, l: string) => (t[l] ? `${((100 * t[l].selected) / t[l].n).toFixed(0)}%` : '-');
const W = 12;
console.log(`${'selected (n per row in brackets)'.padEnd(44)}${runNames.map((n) => (n === 'legacy' ? 'today' : n).padEnd(W)).join('')}`);
for (const l of labels) console.log(`${`${l === 'user' ? "USER'S SOUND (should select)" : l} (${tallies.legacy[l]?.n ?? 0})`.padEnd(44)}${runNames.map((n) => pct(tallies[n], l).padEnd(W)).join('')}`);
console.log(`${'background bed (stray selections)'.padEnd(44)}${runNames.map((n) => String(stray[n]).padEnd(W)).join('')}`);
const wrong = (name: string, skipUhUh = false) => Object.entries(tallies[name]).filter(([l]) => l !== 'user' && !(skipUhUh && l === "user's own uh-uh")).reduce((s, [, v]) => s + v.selected, 0) + stray[name];
console.log(`${'wrong selections / min, always armed'.padEnd(44)}${runNames.map((n) => (wrong(n) / minutes).toFixed(2).padEnd(W)).join('')}`);
console.log(`${'  the same, without the user\'s own uh-uh'.padEnd(44)}${runNames.map((n) => (wrong(n, true) / minutes).toFixed(2).padEnd(W)).join('')}`);
latencies.sort((a, b) => a - b);
console.log(`\nlistener (first scale): selection after the sound begins (from the clip start, which may hold a little silence): median ${(latencies[latencies.length >> 1] * 1000).toFixed(0)} ms, p90 ${(latencies[Math.floor(latencies.length * 0.9)] * 1000).toFixed(0)} ms`);
console.log('listener rejections by reason (first scale):', JSON.stringify(reasons));
judgeMs.sort((a, b) => a - b);
console.log(`judge time per sound event and listener: mean ${(judgeMs.reduce((s, x) => s + x, 0) / judgeMs.length).toFixed(1)} ms, p90 ${judgeMs[Math.floor(judgeMs.length * 0.9)].toFixed(1)} ms, max ${judgeMs.at(-1)!.toFixed(1)} ms`);
if (adaptTakes.length) console.log(`adaptive setup: takes asked ${[...new Set(adaptTakes)].sort((a, b) => a - b).map((n) => `${n}: ${adaptTakes.filter((x) => x === n).length}`).join(', ')} (mean ${(adaptTakes.reduce((s, x) => s + x, 0) / adaptTakes.length).toFixed(1)})`);
