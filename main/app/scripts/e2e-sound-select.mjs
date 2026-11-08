// Look + sound on a fake microphone, against a running `./clarte ui`: a look arms a letter card, steady
// background noise never selects it, and a short voiced "ah" does.
//
//   node scripts/e2e-sound-select.mjs [http://localhost:5200]
//
// The microphone plays a generated file: 6 s of steady noise, a 300 ms "ah" (180 Hz with four harmonics), then noise.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ORIGIN = process.argv[2] ?? 'http://localhost:5200';
const RATE = 48000, SECONDS = 14, N = RATE * SECONDS;
const wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
let seed = 1;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 2 - 1; };
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  let v = 0.03 * noise();
  if (t >= 6 && t < 6.3) { const env = Math.min(1, (t - 6) / 0.02, (6.3 - t) / 0.02); for (const h of [1, 2, 3, 4, 5]) v += (env * 0.25 / h) * Math.sin(2 * Math.PI * 180 * h * t); }
  wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
}
const dir = path.join(os.tmpdir(), 'clarte-e2e');
await mkdir(dir, { recursive: true });
const file = path.join(dir, 'ah.wav');
await writeFile(file, wav);

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })).newPage();
const read = () => page.evaluate(() => ({ phase: window.clarteDebug.phase(), state: window.clarteDebug.engine.snapshot.state, action: window.clarteDebug.engine.snapshot.action }));
try {
  const started = Date.now();
  await page.goto(`${ORIGIN}/?input=mouse&onboarding=off`);
  await page.waitForTimeout(1200);
  await page.mouse.move(540, 650); // the G2 card, bottom row
  await page.waitForTimeout(2500);
  const armed = await read();
  check('a look arms the card and waits', armed.state === 'previewed' && armed.action === 'G2' && armed.phase === 'idle', JSON.stringify(armed));
  await page.waitForTimeout(1500);
  check('steady background noise does not select', (await read()).phase === 'idle');
  let after = await read();
  while (Date.now() - started < 10000 && after.phase === 'idle') { await page.waitForTimeout(100); after = await read(); }
  check('a short "ah" selects it', after.phase === 'composing-pending', JSON.stringify(after));
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
