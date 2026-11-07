#!/usr/bin/env node
/**
 * The user path with the mouse as gaze, then keys only, then with gaze noise on, recorded.
 *
 *   node scripts/walkthrough.mjs http://localhost:5104 evidence
 *
 * Every selection is a real dwell: the pointer moves to a quadrant and stays. Screenshots are
 * named after what they show; the video is the whole path. Asserts each step's phase.
 */
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5104', outDir = 'evidence'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const W = 1440, H = 900;
const centre = (q) => { const i = Number(q.slice(1)) - 1; return { x: (i % 4 + 0.5) * W / 4, y: (Math.floor(i / 4) + 0.5) * H / 2 }; };
const REST = { x: W * 0.82, y: H * 0.8 };

mkdirSync(outDir, { recursive: true });
const videoDir = join(outDir, '.video');
mkdirSync(videoDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: 640, height: 400 } } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
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
const log = [];
const step = (msg) => { log.push(msg); console.log(msg); };
const phase = () => page.evaluate(() => window.clarteDebug.phase());
const expectPhase = async (want) => {
  const got = await phase();
  if (got !== want) throw new Error(`expected phase ${want}, got ${got}`);
  step(`  phase ${got}`);
};
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });

async function glide(to, steps = 12) { await page.mouse.move(to.x, to.y, { steps }); }
/** Look at a quadrant until the dwell completes, then look at the rest zone. */
async function look(q, ms = 1300) { await glide(centre(q)); await page.waitForTimeout(ms); await glide(REST, 6); await page.waitForTimeout(380); }
async function key(k, pause = 260) { await page.keyboard.press(k); await page.waitForTimeout(pause); }

try {
  // Headless Chromium has speech recognition that never hears anything: use the scripted partner.
  await page.goto(`${url}/?partner=script`, { waitUntil: 'networkidle' });
  await page.mouse.move(REST.x, REST.y);

  // First run: calibration opens on its own.
  await expectPhase('calibration-position');
  await page.waitForTimeout(1400);
  await shot('calibration-position');
  step('calibration shown (the full sequence is in the motion clip); Escape skips it');
  await key('Escape', 500);
  await expectPhase('idle');
  await shot('idle');

  // Listen (mouse as gaze). Recognition is unavailable headless, so the scripted partner speaks.
  await look('Q3');
  await expectPhase('listening');
  await page.waitForFunction(() => document.querySelector('.transcript')?.textContent?.endsWith('later.'), null, { timeout: 12000 });
  await shot('listening');
  await look('Q4'); // More, while the partner is still talking
  await expectPhase('more-idle');
  await look('Q5'); // One moment: spoken, nothing else changes
  await look('Q3'); // Stop listening (Q3 is Stop on More too)
  await look('Q4'); // Back
  await expectPhase('idle');

  // Type "not" with the groups: G-N, O-S, T-Z. Catch the ring half-way on the first one.
  await glide(centre('Q2'));
  await page.waitForTimeout(560);
  await shot('dwell-ring');
  await page.waitForTimeout(700);
  await glide(REST, 6); await page.waitForTimeout(380);
  await look('Q5', 1000);
  await look('Q6', 1000);
  await expectPhase('composing-pending');
  await shot('composing-pending');
  const candidate = await page.locator('[data-action="primary"] .content-in .label').textContent();
  step(`  candidate shows "${candidate}"`);
  await look('Q3'); // accept "now" (the partner said it)
  await shot('after-decode');
  await look('Q4'); // More: the word to fix is marked, its next candidate waits in Q1
  await expectPhase('more');
  const next = await page.locator('[data-action="G1"] .content-in .label').textContent();
  step(`  More, other word offers "${next}"`);
  await shot('more');
  await look('Q1'); // Other word: "now" becomes "not"
  await expectPhase('composing-ready');

  // Keys only: "now maybe later" with digits, accept with 3.
  for (const k of ['2', '5', '6', '3']) await key(k);         // now
  for (const k of ['2', '1', '6', '1', '1', '3']) await key(k); // maybe
  for (const k of ['2', '1', '6', '1', '5', '3']) await key(k); // later
  const message = await page.locator('.message').textContent();
  step(`  message "${message}"`);
  await expectPhase('composing-ready');
  await shot('composing-ready');

  // Speak (gaze), see the word highlight, then Say again.
  await look('Q3', 1250);
  await expectPhase('speaking');
  await page.waitForTimeout(600);
  await shot('speaking');
  await page.waitForFunction(() => window.clarteDebug.phase() === 'spoken', null, { timeout: 15000 });
  await page.waitForTimeout(450);
  await shot('spoken');
  step('  spoken; Say again offered');

  // Menu (through More, available while Say again is offered), Settings, back out; Demo, noise on.
  await look('Q4');
  await expectPhase('more-idle');
  await look('Q6');
  await expectPhase('menu');
  await shot('menu');
  await look('Q5'); // Settings
  await expectPhase('menu-settings');
  await shot('menu-settings');
  await look('Q3'); // Next, 2 of 3
  await look('Q3'); // Next, 3 of 3: Demo
  await expectPhase('menu-demo');
  await look('Q1'); // Gaze noise on
  await shot('menu-demo-noise-on');
  await look('Q4'); // Back to Menu
  await look('Q4'); // Close
  await expectPhase('idle');

  // With noise on: type "yes" (T-Z, A-F, O-S) by gaze and accept.
  await look('Q6', 1500); await look('Q1', 1500); await look('Q5', 1500);
  await expectPhase('composing-pending');
  const noisy = await page.locator('[data-action="primary"] .content-in .label').textContent();
  step(`  with noise, candidate "${noisy}"`);
  await key('4'); await key('4'); // clear via Delete twice (pending groups)
  await key('4');

  // Overlay on, pointer wandering over the Q1/Q2 line: the current quadrant must not flicker.
  // Confirm mode for this test, so lingering on the line previews A–F instead of typing it.
  await page.evaluate(() => window.clarteDebug.engine.configure({ noiseSigma: 0, mode: 'confirm' }));
  await key('`', 200);
  await glide({ x: 330, y: 230 });
  await page.waitForTimeout(400);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(360 + Math.sin(i * 0.9) * 22, 230 + Math.cos(i * 0.7) * 30);
    await page.waitForTimeout(25);
    seen.push(await page.evaluate(() => window.clarteDebug.engine.snapshot.quadrant));
  }
  const flips = seen.filter((q, i) => i && q !== seen[i - 1]).length;
  step(`  dead band: ${seen.length} samples across x=360±22, quadrant ${[...new Set(seen)].join('/')} with ${flips} flips`);
  await shot('overlay-dead-band');
  await key('`', 200);
  await key('Escape', 100);
  await page.evaluate(() => window.clarteDebug.engine.configure({ mode: 'dwell' }));
  await glide(REST, 6); await page.waitForTimeout(400);
  await expectPhase('idle');

  // Recalibrate from the menu.
  await look('Q4'); // More
  await look('Q6'); // Menu
  await look('Q3'); // Recalibrate
  await expectPhase('calibration-position');
  await key('Escape', 400);
  await expectPhase('idle');
  step('walkthrough complete');
} finally {
  await context.close();
  await browser.close();
  const [video] = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  if (video) renameSync(join(videoDir, video), join(outDir, 'walkthrough.webm'));
  rmSync(videoDir, { recursive: true, force: true });
}
