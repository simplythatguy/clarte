// Hearing the partner end to end (NAT-49), in headless Chromium on a fake microphone that plays a spoken
// sentence. Playwright's Chromium has no Google speech service, the case that used to put the demo partner's
// lines in the conversation: Listen must hand over to the engine's Whisper and show what was really said.
//
// Privacy (NAT-55, audit C1): the Stop card must say "Via Google" while the browser's recognition (Google's
// service in Chrome) listens, and not once Whisper has taken over. A stand-in for Chrome's recognition checks
// the first.
//
//   node scripts/e2e-partner-listen.mjs [app origin] [engine origin]
//   node scripts/e2e-partner-listen.mjs http://localhost:5200 http://127.0.0.1:8765
//
// Needs the app's dev server, an engine started with its transcriber (the default), and macOS `say` to speak
// the sentence. Run it in Playwright's Chromium: Google Chrome's own recognition listens to the computer's real
// microphone, not the fake one, so with PLAYWRIGHT_CHANNEL=chrome it hears the room instead of the sentence.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGIN = process.argv[2] ?? 'http://localhost:5200';
const ENGINE = process.argv[3] ?? 'http://127.0.0.1:8765';
const SENTENCE = 'Do you want to go outside for a bit? It is sunny today.';
const RATE = 16000;

// The microphone: a second of room, the sentence, three seconds of room, looped.
const dir = mkdtempSync(path.join(os.tmpdir(), 'clarte-partner-'));
const spoken = path.join(dir, 'spoken.wav');
try { execFileSync('say', ['-o', spoken, '--data-format=LEI16@16000', SENTENCE]); } catch { console.log('skip: macOS say is needed to speak the sentence'); process.exit(0); }
const raw = readFileSync(spoken);
const at = raw.indexOf('data') + 8;
const speech = new Int16Array(raw.buffer.slice(raw.byteOffset + at, raw.byteOffset + raw.length - ((raw.length - at) % 2)));
const n = RATE + speech.length + RATE * 3;
const wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
let seed = 7;
for (let i = 0; i < n; i++) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  const room = Math.round(((seed / 2147483648) * 2 - 1) * 30);
  const s = i >= RATE && i < RATE + speech.length ? speech[i - RATE] : 0;
  wav.writeInt16LE(Math.max(-32767, Math.min(32767, s + room)), 44 + i * 2);
}
const mic = path.join(dir, 'mic.wav');
writeFileSync(mic, wav);

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

// The engine loads Whisper after it opens its port; wait until it can hear.
for (let i = 0; ; i++) {
  const state = await fetch(`${ENGINE}/api/v1/health`).then((r) => r.json()).then((h) => h.transcriber?.state).catch(() => null);
  if (state === 'ready') break;
  if (state === 'failed' || state === 'off' || i > 300) { console.log(`FAIL the engine at ${ENGINE} cannot hear (transcriber ${state})`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1000));
}

// A stand-in for Chrome's recognition (Google's service): counts starts and "hears" a fixed line.
const FAKE_GOOGLE = () => {
  window.__googleStarts = 0;
  class FakeGoogle {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = ''; this.onresult = this.onstart = this.onend = this.onerror = null; }
    start() {
      window.__googleStarts += 1;
      setTimeout(() => this.onstart?.(), 10);
      setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'words sent to google' }], { isFinal: true })] }), 300);
    }
    stop() { setTimeout(() => this.onend?.(), 10); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeGoogle;
  window.webkitSpeechRecognition = FakeGoogle;
};

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push(`pageerror ${e.message}`));
await page.goto(`${ORIGIN}/?onboarding=off&input=mouse&engine=${encodeURIComponent(ENGINE)}`);
await page.waitForFunction(() => window.clarteDebug?.phase() === 'idle', null, { timeout: 30000 });
await page.waitForTimeout(1500); // the app finds the engine

const listenedAt = Date.now();
await page.keyboard.press('4'); // Listen
await page.waitForFunction(() => window.clarteDebug.phase() === 'listening', null, { timeout: 5000 });
const heard = await page.waitForFunction(() => /outside/i.test(document.querySelector('.thread')?.textContent ?? ''), null, { timeout: 40000 }).then(() => true, () => false);
console.log(`     first words after ${((Date.now() - listenedAt) / 1000).toFixed(1)} s (the sentence starts within 1 s of the microphone opening and loops every ${(n / RATE).toFixed(1)} s)`);
await page.waitForTimeout(4000); // the utterance's final transcription
const shown = await page.evaluate(() => document.querySelector('.thread')?.textContent ?? '');
check('the partner\'s real words appear while listening', heard, shown.slice(0, 160));
check('no demo line was shown', !/how are you feeling|nurse said|are you hungry/i.test(shown));
const handover = logs.find((l) => l.startsWith('[listen]'));
console.log(`     recognition: ${handover ?? 'the browser\'s own'}`);
check('the Stop card does not say Google once Whisper listens', !/via google/i.test(await page.evaluate(() => document.body.textContent ?? '')));

await page.keyboard.press('4'); // Stop
await page.waitForFunction(() => window.clarteDebug.phase() !== 'listening', null, { timeout: 5000 });
const thread = await page.evaluate(() => document.querySelector('.thread')?.textContent ?? '');
check('Stop keeps what the partner said in the conversation', /outside/i.test(thread));
check('no page errors', !logs.some((l) => l.startsWith('pageerror')), logs.filter((l) => l.startsWith('pageerror')).join('; '));

// A browser whose recognition works (Chrome): it listens first, and the card says where the speech goes.
const page2 = await context.newPage();
await page2.addInitScript(FAKE_GOOGLE);
await page2.goto(`${ORIGIN}/?onboarding=off&input=mouse&engine=${encodeURIComponent(ENGINE)}`);
await page2.waitForFunction(() => window.clarteDebug?.phase() === 'idle', null, { timeout: 30000 });
await page2.waitForTimeout(1500);
await page2.keyboard.press('4'); // Listen
await page2.waitForFunction(() => window.clarteDebug.phase() === 'listening', null, { timeout: 5000 });
const google = await page2.waitForFunction(() => /words sent to google/i.test(document.querySelector('.thread')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false);
check('the browser\'s recognition listens first where it works', google);
check('the Stop card says "Via Google" while it does', /via google/i.test(await page2.evaluate(() => document.body.textContent ?? '')));
await page2.keyboard.press('4'); // Stop

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nPartner listening passed end to end.');
process.exit(failures.length ? 1 : 0);
