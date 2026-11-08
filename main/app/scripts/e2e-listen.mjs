// The person's own sound, end to end in headless, muted Chromium on a fake microphone (DEC-128), against a
// running `./clarte ui`:
//  1. Menu › Settings › My sound: the room, eight takes of one person's "mm-hmm" (CNVVE fixtures, six
//     distinct takes), then their own "ahem" and "shh" as sounds that are not theirs.
//  2. Try your sound: two held-out takes of theirs match; two other men's "mm-hmm" and a clap do not.
//  3. Look + sound on the conversation: with a card armed, a neighbour's "mm-hmm" does not select it, and the
//     person's own (held out) does.
//
//   node scripts/e2e-listen.mjs [http://localhost:5200]
//
// The microphone file is built here from `fixtures/listen` and plays from the moment the microphone opens; the
// script times its clicks by `window.clarteMic.startedAt`.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = process.argv[2] ?? 'http://localhost:5200';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '../fixtures/listen');
const RATE = 16000, SECONDS = 48, N = RATE * SECONDS;

async function clip(name) {
  const b = await readFile(path.join(FIX, `${name}.wav`));
  let p = 12;
  while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
  const n = b.readUInt32LE(p + 4) / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
  // The loud part at -26 dB, about a voice half a metre from a laptop.
  const e = []; for (let i = 0; i + 160 <= n; i += 160) { let s = 0; for (let j = 0; j < 160; j++) s += x[i + j] ** 2; e.push(s / 160); }
  e.sort((a, c) => c - a); const top = e.slice(0, Math.max(1, Math.round(e.length * 0.3)));
  const g = 10 ** ((-26 - 10 * Math.log10(top.reduce((s, v) => s + v, 0) / top.length)) / 20);
  return x.map((v) => v * g);
}

// The timeline, in seconds after the microphone opens.
const TEACH_AT = 2.0;
const TAKES = [0, 1, 2, 3, 4, 5, 0, 1].map((k, i) => ({ at: 6.2 + i * 1.5, name: `user-mmhmm-${k}` }));
const OTHER = [{ at: 19.2, name: 'user-ahem' }, { at: 21.0, name: 'user-hush' }];
const TRIES = [
  { at: 26.0, name: 'user-mmhmm-6', theirs: true },
  { at: 28.0, name: 'neighbour-mmhmm-0', theirs: false },
  { at: 30.0, name: 'clap', theirs: false },
  { at: 32.0, name: 'user-mmhmm-7', theirs: true },
  { at: 34.0, name: 'neighbour-mmhmm-2', theirs: false },
];
const ARM_AT = 36.0;
const SELECT = [{ at: 39.5, name: 'neighbour-mmhmm-1', selects: false }, { at: 42.5, name: 'user-mmhmm-6', selects: true }];

const mic = new Float32Array(N);
let seed = 3;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 2 - 1; };
for (let i = 0; i < N; i++) mic[i] = 0.002 * noise(); // a quiet room, about -57 dB
const place = (x, at) => { const o = Math.round(at * RATE); for (let i = 0; i < x.length && o + i < N; i++) mic[o + i] += x[i]; };
const clap = Float32Array.from({ length: 1600 }, (_, i) => 0.6 * noise() * Math.exp(-i / 160));
for (const s of [...TAKES, ...OTHER, ...TRIES, ...SELECT]) place(s.name === 'clap' ? clap : await clip(s.name), s.at);
const wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mic[i] * 32767))), 44 + i * 2);
const EVIDENCE = path.join(HERE, '../evidence/listen');
await mkdir(EVIDENCE, { recursive: true });
const shot = (name) => page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
const dir = path.join(os.tmpdir(), 'clarte-e2e');
await mkdir(dir, { recursive: true });
const file = path.join(dir, 'listen.wav');
await writeFile(file, wav);

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const micTime = () => page.evaluate(() => (window.clarteMic ? (performance.now() - window.clarteMic.startedAt) / 1000 : -1));
const until = async (t) => { while ((await micTime()) < t) await page.waitForTimeout(50); };
const rest = () => page.mouse.move(720, 250); // the rest zone at the top centre, so no card dwells
const press = async (action) => { await page.click(`[data-action="${action}"]`); await rest(); };
const read = () => page.evaluate(() => ({ phase: window.clarteDebug.phase(), state: window.clarteDebug.engine.snapshot.state, action: window.clarteDebug.engine.snapshot.action, listen: window.clarteListen ? { step: window.clarteListen.step, takes: window.clarteListen.takes, tries: window.clarteListen.tries } : null }));
try {
  await page.goto(`${ORIGIN}/?onboarding=off`);
  await rest();
  await page.waitForFunction(() => Boolean(window.clarteMic), null, { timeout: 15000 });
  const settings = await page.evaluate(() => window.clarteMic.settings);
  check('the microphone opens raw: no echo cancellation, noise suppression or automatic gain', settings && settings.echoCancellation === false && settings.noiseSuppression === false && settings.autoGainControl === false, JSON.stringify(settings));
  await until(TEACH_AT);
  await press('delete'); // Menu
  await press('open-settings');
  await page.waitForTimeout(700);
  await shot('1-settings-page');
  await press('teach-sound');
  check('My sound opens on Stay quiet', (await read()).listen?.step === 'room', JSON.stringify((await read()).listen));
  await until(TAKES[4].at + 1.0);
  await shot('2-make-your-sound');
  await until(TAKES.at(-1).at + 1.2);
  const taught = await read();
  check('all eight takes are heard', taught.listen?.takes === 8, JSON.stringify(taught.listen));
  await until(TRIES[0].at - 0.5);
  check('after the other sounds the profile is in use', (await read()).listen?.step === 'ready', JSON.stringify((await read()).listen));
  await until(TRIES[0].at + 1.0);
  await shot('3-that-was-your-sound');
  await until(TRIES[1].at + 1.0);
  await shot('4-not-your-sound');
  await until(TRIES.at(-1).at + 1.5);
  const tried = (await read()).listen?.tries ?? [];
  // Each scheduled sound against what was heard within half a second of it (one sound may be heard as two).
  for (const t of TRIES) {
    const heard = tried.filter((h) => Math.abs(h.at - t.at) < 0.5);
    check(`${t.name} ${t.theirs ? 'matches' : 'does not match'}`, heard.length > 0 && heard.some((h) => h.accept) === t.theirs, JSON.stringify(heard));
  }
  check('the profile is saved on this browser', await page.evaluate(() => Boolean(localStorage.getItem('clarte.listen.profile'))));
  await press('teach-done');
  await press('back'); await press('back');
  check('Done leads back to the conversation', (await read()).phase === 'idle', (await read()).phase);
  await until(ARM_AT);
  await page.mouse.move(540, 650); // the G2 card, bottom row
  await until(SELECT[0].at - 0.3);
  const armed = await read();
  check('a look arms the card and waits', armed.state === 'previewed' && armed.action === 'G2', JSON.stringify(armed));
  await until(SELECT[0].at + 1.5);
  check("a neighbour's mm-hmm does not select it", (await read()).phase === 'idle', (await read()).phase);
  await until(SELECT[1].at + 1.5);
  check('the person\'s own mm-hmm selects it', (await read()).phase.startsWith('composing'), (await read()).phase);
  check('no page errors', errors.length === 0, errors.join('; '));
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
