/**
 * Builds the bank of other people's sounds that every profile rejects against
 * (`public/listen/bank.json`). Measured with `listen-eval.ts`: with it, wrong selections per
 * minute fall from 2.27 to 0.56; without it, a stranger's sounds are judged only against the
 * person's own takes.
 *
 *   node scripts/build-listen-bank.ts <CNVVE clean audio dir> [--torgo <TORGO dir>]
 *
 * Source: CNVVE (Hedeshy et al., Interspeech 2023, doi:10.18419/darus-3898), CC BY 4.0. Up to six
 * sounds per person ("mm-hmm", "uh-uh", humming, "ahem"), each placed in a quiet room exactly as
 * an enrolment take is. The three people in the test fixtures are left out.
 *
 * With --torgo, it also adds TORGO (Rudzicz et al. 2012; speakers with dysarthria from cerebral
 * palsy or ALS, and controls): the 20 single words said by the most different people, at most one
 * recording of each word per speaker (head microphone). TORGO's terms: "free for academic
 * (non-profit) purposes". Measured on TORGO with speakers kept apart (listen-eval.ts --torgo):
 * a neighbour saying the person's word selected 7 % of the time instead of 13 %, and wrong
 * selections fell from 0.69 to 0.50 a minute. Rebuild without --torgo if those terms do not fit.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainEvent } from '../src/listen/takes.ts';
import { sequenceOf } from '../src/listen/matcher.ts';
import { encodeTemplate } from '../src/listen/store.ts';
import { asTake, mswcBankFiles, readWav, speechCommandsBankFiles } from './listen-audio.ts';

const dir = process.argv[2];
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const torgo = arg('torgo');
const speechCommands = arg('speechcommands');
const mswc = arg('mswc');
if (!dir) { console.error('usage: node scripts/build-listen-bank.ts <CNVVE clean audio dir>'); process.exit(1); }

/** How much of Speech Commands and MSWC goes in (see the header for the measurement). */
const SC_PEOPLE = 0, SC_WORDS = ['yes', 'no'], MSWC_CLIPS = 0;
const KINDS = new Set(['confirm', 'decline', 'continuous', 'ahem']);
// The people in `fixtures/listen` stay out of the bank, so the end-to-end check meets them as
// strangers, as a real user and their neighbours would be.
const FIXTURE_PEOPLE = new Set(['08f2e6f3', '066ec67b', '13013a67']);
const byPerson = new Map<string, string[]>();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.wav')).sort()) {
  const [kind, person] = f.split('_');
  if (!KINDS.has(kind) || FIXTURE_PEOPLE.has(person)) continue;
  const list = byPerson.get(person) ?? [];
  list.push(f);
  byPerson.set(person, list);
}
const templates = [];
for (const [, files] of [...byPerson].sort()) {
  // Round-robin over the kinds, so each person contributes a mix of their sounds.
  const picked = [...KINDS].flatMap((k) => files.filter((f) => f.startsWith(`${k}_`)).slice(0, 2)).slice(0, 6);
  for (const f of picked) {
    const e = mainEvent(asTake(readWav(join(dir, f))));
    if (e) templates.push(encodeTemplate({ seq: sequenceOf(e), stats: e.stats }));
  }
}
const cnvveCount = templates.length;
let torgoCount = 0, torgoSpeakers = 0;
if (torgo) {
  // speaker/Session*/prompts/NNNN.txt holds what speaker/Session*/wav_headMic/NNNN.wav says.
  const recs: { speaker: string; file: string; word: string }[] = [];
  for (const speaker of readdirSync(torgo).filter((d) => /^[FM]C?\d+$/.test(d)).sort()) {
    for (const session of readdirSync(join(torgo, speaker)).filter((d) => d.startsWith('Session')).sort()) {
      const wavs = join(torgo, speaker, session, 'wav_headMic');
      if (!existsSync(wavs)) continue;
      for (const f of readdirSync(wavs).filter((f) => f.endsWith('.wav')).sort()) {
        const prompt = join(torgo, speaker, session, 'prompts', f.replace('.wav', '.txt'));
        if (!existsSync(prompt)) continue;
        const word = readFileSync(prompt, 'utf8').trim().toLowerCase();
        if (/^[a-z]+$/.test(word) && word !== 'xxx') recs.push({ speaker, file: join(wavs, f), word });
      }
    }
  }
  const speakersOf = new Map<string, Set<string>>();
  for (const r of recs) { const set = speakersOf.get(r.word) ?? new Set(); set.add(r.speaker); speakersOf.set(r.word, set); }
  const words = [...speakersOf].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 20).map(([w]) => w);
  const used = new Set<string>();
  for (const word of words) {
    for (const speaker of [...speakersOf.get(word)!].sort()) {
      const r = recs.find((x) => x.word === word && x.speaker === speaker)!;
      const e = mainEvent(asTake(readWav(r.file)));
      if (e) { templates.push(encodeTemplate({ seq: sequenceOf(e), stats: e.stats })); used.add(speaker); torgoCount++; }
    }
  }
  torgoSpeakers = used.size;
  console.log(`TORGO words: ${words.join(', ')}`);
}
const fromFiles = (files: string[]) => files.map((f) => mainEvent(asTake(readWav(f)))).filter((e) => e !== null).map((e) => encodeTemplate({ seq: sequenceOf(e), stats: e.stats }));
const scTemplates = speechCommands ? fromFiles(speechCommandsBankFiles(speechCommands, SC_PEOPLE, SC_WORDS)) : [];
const mswcTemplates = mswc ? fromFiles(mswcBankFiles(mswc, MSWC_CLIPS)) : [];
templates.push(...scTemplates, ...mswcTemplates);
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/listen/bank.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  source: [
    `CNVVE, Hedeshy et al. (Interspeech 2023), doi:10.18419/darus-3898, CC BY 4.0: ${cnvveCount} sounds from ${byPerson.size} people.`,
    ...(torgo ? [`TORGO, Rudzicz, Namasivayam & Wolff (2012), Language Resources and Evaluation 46(4), free for academic (non-profit) use: ${torgoCount} words from ${torgoSpeakers} speakers.`] : []),
    ...(speechCommands ? [`Speech Commands v0.02, Warden (2018), arXiv:1804.03209, CC BY 4.0: ${scTemplates.length} words (${SC_WORDS.join(', ')}) from ${SC_PEOPLE} speakers.`] : []),
    ...(mswc ? [`Multilingual Spoken Words Corpus, Mazumder et al. (NeurIPS 2021), CC BY 4.0, from Common Voice: ${mswcTemplates.length} clips of "yeah" and "yes" (dev split), one per speaker.`] : []),
    'Derived features only (cepstra, level, pitch), no audio.',
  ],
  templates,
}));
console.log(`${templates.length} templates (${cnvveCount} CNVVE from ${byPerson.size} people${torgo ? `, ${torgoCount} TORGO from ${torgoSpeakers} speakers` : ''}${speechCommands ? `, ${scTemplates.length} Speech Commands` : ''}${mswc ? `, ${mswcTemplates.length} MSWC` : ''}) → ${out}`);
