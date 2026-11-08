// The first run end to end on a fake camera, against a running `./clarte ui` (or `npm run dev` plus the engine):
// Welcome → Get started → the real 8-dot calibration through the WebEyeTrack worker → training → the calibration
// saved → Voice → Continue → the conversation; then a reload goes straight to the conversation with the saved
// calibration restored, and typing in mouse mode shows the engine's word.
//
//   node scripts/e2e-first-run.mjs [http://localhost:5200] [path/to/face.y4m]
//
// The camera is Gaze Lab's photo fixture (`cd "prototypes/Gaze Lab" && npm run fixture`). A photo cannot move its
// eyes, so this proves the plumbing, not gaze accuracy. Screenshots go to evidence/first-run/.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.argv[2] ?? 'http://localhost:5200';
const CAMERA = process.argv[3] ?? path.resolve(HERE, '../../../prototypes/Gaze Lab/fixtures/face.y4m');
const OUT = path.resolve(HERE, '../evidence/first-run');
const CALIBRATION_KEY = 'still.local-calibration.v1';
await mkdir(OUT, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA}`, '--use-fake-ui-for-media-stream', '--use-gl=angle'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
const phase = () => page.evaluate(() => window.clarteDebug?.phase());
const eyes = () => page.evaluate(() => window.clarteDebug?.eyes());
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const until = async (what, fn, ms) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await page.waitForTimeout(250); } throw new Error(`timed out waiting for ${what}`); };

try {
  await page.goto(`${ORIGIN}/`);
  await page.getByRole('button', { name: 'Get started' }).waitFor();
  check('a first run opens on Welcome', (await phase()) === 'welcome');
  await shot('1-welcome');

  await page.getByRole('button', { name: 'Get started' }).click();
  await until('the dots', async () => (await eyes())?.kind === 'calibrating' && (await eyes()).startedAt !== null, 120_000);
  check('Get started opens calibration and the dots start once a face is in view', (await phase()) === 'calibration');
  await page.waitForTimeout(2000 + 1900 * 2 + 1200); // the intro, two dots, then the third dot collecting
  await shot('2-calibration-dot');
  await until('training', async () => (await eyes())?.kind !== 'calibrating', 30_000);
  const labels = await page.evaluate(() => window.clarteDebug?.eyes());
  await shot('3-calibrating');

  // The photo's fixed gaze drives the app once tracking starts and may dwell on Continue by itself, so the screens
  // the run passes through are recorded rather than caught at one moment.
  await page.evaluate(() => { const seen = (window.__phases = []); const poll = () => { const p = window.clarteDebug?.phase(); if (p && seen.at(-1) !== p) seen.push(p); }; setInterval(poll, 50); });
  await until('tracking', async () => (await eyes())?.kind === 'tracking' || (await eyes())?.kind === 'uncalibrated', 180_000);
  await page.waitForTimeout(300);
  const visited = await page.evaluate(() => window.__phases);
  check('calibration leads to the voice page', visited.includes('voice'), visited.join(' → '));
  const status = await eyes();
  check('training puts the new calibration in use', status.kind === 'tracking', JSON.stringify(status));
  const saved = await page.evaluate((key) => localStorage.getItem(key), CALIBRATION_KEY);
  check('the calibration is saved on this browser', Boolean(saved && JSON.parse(saved).learned), `${saved?.length ?? 0} characters`);
  await shot('4-voice');
  console.log('last calibrating status seen:', JSON.stringify(labels));

  const gaze = await page.evaluate(() => window.clarteDebug?.engine.snapshot);
  console.log('the photo\'s gaze is on', gaze?.quadrant, gaze?.looked);
  // The voice page (NAT-32): no voice is made here, so Not now goes on to the conversation.
  if ((await phase()).startsWith('voice')) await page.getByRole('button', { name: 'Not now' }).click();
  const reached = await until('the conversation', async () => { const p = await phase(); return !p.startsWith('voice') && !['welcome', 'calibration'].includes(p) && p; }, 10_000).catch(() => null);
  check('Not now on the voice page opens the conversation', Boolean(reached), await phase());
  await page.mouse.move(-1, -1);
  await page.waitForTimeout(1500);
  const samples = await page.evaluate(() => window.clarteDebug?.engine.snapshot);
  // The pointer has left the page, so a point here can only have come from the tracker.
  check('the tracker drives the gaze engine', Boolean(samples?.point), JSON.stringify({ point: samples?.point, quadrant: samples?.quadrant }));
  await shot('5-conversation');

  // Every status after the reload is recorded: a restore that silently failed would show a calibration run.
  const firstSaved = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), CALIBRATION_KEY)).savedAt;
  await page.reload();
  await until('the app', () => page.evaluate(() => Boolean(window.clarteDebug)), 10_000);
  await page.evaluate(() => { const seen = (window.__eyes = []); setInterval(() => { const e = window.clarteDebug?.eyes(); const k = e && (e.reason ? `${e.kind}(${e.reason})` : e.kind); if (k && seen.at(-1) !== k) seen.push(k); }, 50); });
  check('a returning person goes straight to the conversation', !(await phase()).startsWith('voice') && !['welcome', 'calibration'].includes(await phase()), await phase());
  await until('the restored calibration', async () => (await eyes())?.kind === 'tracking', 120_000);
  const afterReload = await page.evaluate(() => window.__eyes);
  const restored = await eyes();
  check('the saved calibration is restored at launch, with no new run', restored.calibratedAt === firstSaved && !afterReload.includes('calibrating'), afterReload.join(' → '));

  // Menu › Recalibrate over a restored calibration: a fresh run collects labels, trains and replaces the saved one.
  const menuButton = page.getByRole('button', { name: 'Menu' });
  if (await menuButton.count()) await menuButton.first().click(); else await page.keyboard.press('1');
  await page.getByRole('button', { name: 'Recalibrate' }).click();
  await until('the recalibration dots', async () => (await eyes())?.kind === 'calibrating' && (await eyes()).labels > 10, 60_000);
  check('Recalibrate collects labels over a restored calibration', (await eyes()).labels > 10, JSON.stringify(await eyes()));
  await until('the new calibration', async () => (await eyes())?.kind === 'tracking', 180_000);
  const second = await eyes();
  const secondSaved = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), CALIBRATION_KEY)).savedAt;
  check('the new calibration replaces the saved one', second.calibratedAt !== firstSaved && secondSaved === second.calibratedAt, `${firstSaved} → ${secondSaved}`);
  await until('the conversation after recalibrating', async () => (await phase()) !== 'calibration', 10_000);

  // Escape during a recalibration keeps the calibration in use.
  if (await menuButton.count()) await menuButton.first().click(); else await page.keyboard.press('1');
  await page.getByRole('button', { name: 'Recalibrate' }).click();
  await until('the dots', async () => (await eyes())?.kind === 'calibrating' && (await eyes()).startedAt !== null, 60_000);
  await page.keyboard.press('Escape');
  await until('the calibration in use', async () => (await eyes())?.kind === 'tracking', 60_000);
  check('Escape keeps the calibration in use', (await eyes()).calibratedAt === secondSaved && (await phase()) !== 'calibration', JSON.stringify(await eyes()));

  // Typing, with the mouse standing in for the eyes so the photo's fixed gaze cannot select anything.
  await page.goto(`${ORIGIN}/?input=mouse`);
  await until('the app', () => page.evaluate(() => Boolean(window.clarteDebug)), 10_000);
  await page.mouse.move(720, 120); // the rest zone between the two top cards
  await until('the engine', () => page.evaluate(async () => { for (const p of [8765, 8766, 8767, 8768, 8769]) { try { const r = await fetch(`http://127.0.0.1:${p}/api/v1/health`); if (r.ok && (await r.json()).ok) return true; } catch {} } return false; }), 180_000);
  await page.waitForTimeout(2500); // the client's health probe runs every 2 s
  // A cold engine can miss the client's 250 ms race, and then the local decoder's word stands; warm it first.
  await page.evaluate(async () => { for (const groups of ['2', '21', '212', '2122', '21223']) for (const p of [8765, 8766]) await fetch(`http://127.0.0.1:${p}/api/v1/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history: [], message: [], groups, offset: 0 }) }).catch(() => {}); });
  for (const key of ['6', '5', '6', '6', '7']) { await page.keyboard.press(key); await page.waitForTimeout(400); } // h e l l o
  await page.waitForTimeout(800);
  const words = await page.evaluate(() => window.clarteDebug?.words());
  console.log('after typing:', await page.evaluate(() => JSON.stringify({ phase: window.clarteDebug?.phase(), eyes: window.clarteDebug?.eyes(), snap: window.clarteDebug?.engine.snapshot, focus: document.activeElement?.tagName, text: document.body.innerText.slice(0, 120) })));
  check('typing shows the engine\'s word', words.prediction.source === 'engine' && words.prediction.words.length > 0, `${words.prediction.source}: ${words.prediction.words.slice(0, 3).map((w) => w.word).join(', ')}`);
  await shot('6-typing');
} catch (error) {
  failures.push(String(error));
  console.error(error);
  console.error('state:', JSON.stringify(await page.evaluate(() => ({ phase: window.clarteDebug?.phase(), eyes: window.clarteDebug?.eyes(), seen: window.__phases })).catch(() => null)));
  await shot('failure').catch(() => {});
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
