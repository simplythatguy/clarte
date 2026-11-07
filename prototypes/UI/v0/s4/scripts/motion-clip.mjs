#!/usr/bin/env node
/**
 * A short recording made for frame-by-frame review against MOTION.md's acceptance list, with the
 * time of each event in the video logged, so a reviewer can scrub straight to it.
 *
 *   node scripts/motion-clip.mjs http://localhost:5104 evidence/motion
 *
 * Writes motion.webm, events.json (seconds into the video) and sheet-*.png contact sheets of
 * consecutive frames (one per 40 ms) around each event.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5104', outDir = 'evidence/motion'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(outDir, { recursive: true });
const videoDir = join(outDir, '.video');
mkdirSync(videoDir, { recursive: true });

const W = 1440, H = 900;
const REST = { x: 1180, y: 760 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
const page = await context.newPage();
// The video starts with the page; mark events against that moment.
const t0 = Date.now();
// Headless Chromium's synthesizer ends utterances at once and sends no word boundaries. The
// recording uses a test double with the same interface that starts, reports each word and ends
// at a speaking pace, so the app's real success path (API end event) is what the video shows.
await page.addInitScript(() => {
  let timers = [];
  let current = null;
  const fake = {
    speaking: false,
    getVoices: () => [],
    cancel() {
      timers.forEach(clearTimeout); timers = [];
      if (current) { const u = current; current = null; fake.speaking = false; u.onerror?.({ error: 'canceled' }); }
    },
    speak(u) {
      fake.cancel();
      current = u; fake.speaking = true;
      const text = u.text;
      let t = 60;
      timers.push(setTimeout(() => u.onstart?.({}), t));
      for (const m of text.matchAll(/\S+/g)) {
        const at = t;
        timers.push(setTimeout(() => u.onboundary?.({ name: 'word', charIndex: m.index }), at));
        t += (m[0].length + 1) * 68;
      }
      timers.push(setTimeout(() => { if (current === u) { current = null; fake.speaking = false; u.onend?.({}); } }, t + 150));
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
});
const events = [];
const mark = (name) => events.push({ name, at: +((Date.now() - t0) / 1000).toFixed(2) });

await page.goto(`${url}/?phase=idle&partner=script`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.mouse.move(REST.x, REST.y);
await page.waitForTimeout(600);
// A sync mark: the page goes black for 400 ms. The moment it ends is logged here and found again
// in the encoded video, and every event time is shifted by the difference, so the times in
// events.json are video times, not times since the page was created.
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'sync-mark';
  d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647';
  document.documentElement.append(d);
});
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('sync-mark').remove());
mark('sync');
await page.waitForTimeout(800);

mark('idle, nothing happening');
await page.waitForTimeout(1000);

mark('gaze arrives on G-N (commit expected at +0.60 s)');
await page.mouse.move(540, 225, { steps: 1 });
await page.waitForTimeout(1100);
mark('gaze leaves G-N (ring releases)');
await page.mouse.move(REST.x, REST.y, { steps: 1 });
await page.waitForTimeout(1000);

// The engine needs the new quadrant to hold 150 ms and then allows 150 ms of grace, so a look
// that leaves within about 300 ms of the commit still commits. Leave early enough to cancel.
mark('gaze arrives on A-F, leaves at +0.25 s (drain expected)');
await page.mouse.move(180, 225, { steps: 1 });
await page.waitForTimeout(250);
await page.mouse.move(REST.x, REST.y, { steps: 1 });
await page.waitForTimeout(1000);

mark('keyboard 6 selects T-Z (no motion expected)');
await page.keyboard.press('6');
await page.waitForTimeout(1000);

mark('gaze arrives on Q4 Delete (control: 250 ms intent, commit at +0.90 s)');
await page.mouse.move(1260, 225, { steps: 1 });
await page.waitForTimeout(1300);
await page.mouse.move(REST.x, REST.y, { steps: 1 });
await page.waitForTimeout(800);

await page.evaluate(() => window.clarteDebug.setPhase('idle'));
await page.waitForTimeout(800);
mark('gaze arrives on Q3 Listen (phase change at +0.90 s)');
await page.mouse.move(900, 225, { steps: 1 });
await page.waitForTimeout(1300);
await page.mouse.move(REST.x, REST.y, { steps: 1 });
await page.waitForTimeout(2600);

// Entering calibration the real way: Menu, then a look at Recalibrate (one cross-fade expected).
await page.evaluate(() => window.clarteDebug.setPhase('menu'));
await page.waitForTimeout(800);
mark('gaze arrives on Recalibrate (calibration entry at +0.90 s)');
await page.mouse.move(900, 225, { steps: 1 });
await page.waitForTimeout(2400);

// The nine-point run itself, opened directly (a debug jump, so its first frame is a cut).
mark('calibration points start');
await page.evaluate(() => window.clarteDebug.setPhase('calibration-points'));
await page.waitForTimeout(7600);
mark('end');

await context.close();
await browser.close();
const [video] = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
renameSync(join(videoDir, video), join(outDir, 'motion.webm'));
rmSync(videoDir, { recursive: true, force: true });

const viewer = await chromium.launch();
const sheetPage = await viewer.newPage({ viewport: { width: 1480, height: 1000 } });
const data = readFileSync(join(outDir, 'motion.webm')).toString('base64');
// Find the first frame after the black sync mark and align the event clock to it.
await sheetPage.setContent(`<video id=v muted src="data:video/webm;base64,${data}"></video>`);
const syncInVideo = await sheetPage.evaluate(async (around) => {
  const v = document.getElementById('v');
  await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
  const c = document.createElement('canvas'); c.width = 64; c.height = 40; const g = c.getContext('2d');
  const mean = async (t) => { v.currentTime = t; await new Promise((r) => v.addEventListener('seeked', r, { once: true })); g.drawImage(v, 0, 0, 64, 40); const d = g.getImageData(0, 0, 64, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 765; };
  let black = false;
  for (let t = Math.max(0, around - 1.5); t < around + 1.5; t += 0.02) {
    const m = await mean(t);
    if (m < 0.05) black = true;
    else if (black && m > 0.5) return t;
  }
  return null;
}, events[0].at);
if (syncInVideo === null) throw new Error('sync mark not found in the video');
const offset = syncInVideo - events[0].at;
for (const e of events) e.at = +(e.at + offset).toFixed(2);
writeFileSync(join(outDir, 'events.json'), JSON.stringify({ note: 'Seconds into motion.webm, aligned to the sync mark (the frame where the black screen ends).', clockOffsetS: +offset.toFixed(3), events }, null, 2));

// Contact sheets: consecutive frames, one per 40 ms (10% speed is 25 frames per real second).
const sheets = [
  ['commit', events[2].at + 0.05, 0.04, 24],
  ['drain', events[4].at + 0.1, 0.04, 16],
  ['keyboard', events[5].at - 0.04, 0.04, 8],
  ['phase', events[7].at + 0.8, 0.04, 16],
  ['calibration-entry', events[8].at + 0.8, 0.04, 16],
  ['calibration', events[9].at + 0.2, 0.25, 28],
];
for (const [name, start, every, count] of sheets) {
  await sheetPage.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,360px);gap:8px;padding:8px;font:12px system-ui;color:#fff}canvas{width:360px;height:225px;display:block}</style><video id=v muted src="data:video/webm;base64,${data}"></video>`);
  await sheetPage.evaluate(async ([start, every, count]) => {
    const v = document.getElementById('v');
    await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
    for (let i = 0; i < count; i++) {
      const t = start + i * every;
      v.currentTime = t;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      const c = document.createElement('canvas');
      c.width = 720; c.height = 450;
      c.getContext('2d').drawImage(v, 0, 0, 720, 450);
      const fig = document.createElement('div');
      fig.append(c, document.createTextNode(`t=${t.toFixed(2)} s`));
      document.body.append(fig);
    }
    v.remove();
  }, [start, every, count]);
  await sheetPage.screenshot({ path: join(outDir, `sheet-${name}.png`), fullPage: true });
}
await viewer.close();
console.log(JSON.stringify(events, null, 2));
