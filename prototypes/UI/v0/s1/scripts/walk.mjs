#!/usr/bin/env node
/**
 * Walk the whole Style 1 user path in a real browser, the way a person would with the simulator:
 * the mouse is the gaze point (with webcam noise on), Space confirms a preview, Escape skips
 * calibration. Saves a screenshot at each step and a video of the run.
 *
 *   node scripts/walk.mjs http://localhost:5101 evidence/walk
 *
 * A second pass drives everything with keys only (digits 1–8, Space).
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5101', out = 'evidence/walk'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(out, { recursive: true });

const W = 1440, H = 900;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(out, 'video'), size: { width: 1280, height: 800 } } });
// Headless Chromium has no voices. The test harness (never the app) supplies a stand-in voice
// that starts, reports word boundaries and ends at a natural pace, so the flow can be walked.
await context.addInitScript(() => {
  const synth = window.speechSynthesis;
  let timers = [];
  synth.speak = (u) => {
    const words = [...u.text.matchAll(/\S+/g)];
    timers.push(setTimeout(() => u.onstart?.({}), 50));
    words.forEach((m, i) => timers.push(setTimeout(() => u.onboundary?.({ name: 'word', charIndex: m.index }), 60 + i * 320)));
    timers.push(setTimeout(() => u.onend?.({}), 80 + words.length * 320));
  };
  synth.cancel = () => { timers.forEach(clearTimeout); timers = []; };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const log = (...a) => console.log(...a);
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); log('shot', name, '·', await page.evaluate(() => window.clarteDebug.phase())); };
const phase = () => page.evaluate(() => window.clarteDebug.phase());

// Tile centres: quadrant column centre; rail centres from the CSS geometry.
const tileH = Math.min(212, Math.max(136, H * 0.225));
const topY = 40 + 16 + tileH / 2, bottomY = H - 24 - tileH / 2;
const q = (n) => ({ x: ((n - 1) % 4 + 0.5) * (W / 4), y: n <= 4 ? topY : bottomY });
// Reading the message: the middle band, top half (the row boundary itself is the engine's dead band).
const rest = { x: W * 0.36, y: H * 0.4 };

/** Look at a point for `ms` with small fixational jitter, sampling every 40 ms like a tracker. */
async function look(p, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.mouse.move(p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16);
    await page.waitForTimeout(40);
  }
}
/** Look at a quadrant until it previews, then confirm with Space (the default confirm mode). */
async function select(n, { dwell = 1250 } = {}) {
  await look(q(n), dwell);
  await page.keyboard.press('Space');
  await look(rest, 520); // gaze leaves long enough to re-arm (150 ms hold + 300 ms re-arm)
}
const group = { G1: 5, G2: 6, G3: 7, G4: 8 };
async function type(groups) { for (const g of groups) await select(group[g], { dwell: 950 }); }

// --- First run: calibration
await page.goto(url + '/?partner=script');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('clarte.style1.settings', JSON.stringify({ noise: 0.06 })); });
await page.reload();
await page.waitForFunction(() => window.clarteDebug);
await page.waitForTimeout(1800); await shot('01-calibration-position');
await page.waitForTimeout(7200); await shot('02-calibration-points');
await page.keyboard.press('Escape');
await page.waitForTimeout(400); await shot('03-idle');

// --- Listen
await select(1);
await page.waitForTimeout(3600); await shot('04-listening');
await select(1); // Pause
await shot('05-paused');
await select(1); // Respond
await page.waitForTimeout(500);

// --- Type "tired" (T–Z G–N O–S A–F A–F), with a dwell caught mid-fill on the way
await type(['G4', 'G2', 'G3']);
await look(q(5), 560); await shot('06-dwell-in-progress');
await look(q(5), 450); await page.keyboard.press('Space'); await look(rest, 520);
await type(['G1']);
await shot('07-composing-pending');
await select(2); // accept the candidate
await shot('08-after-decode');
await type(['G1', 'G4', 'G4']); await select(2);   // but
await type(['G2', 'G3', 'G3', 'G1']); await select(2); // good
await shot('09-message');

// --- Delete then reopen: the last word comes back at its next candidate
await select(3);
await shot('10-delete-reopened');
await select(2); // accept the other word
await shot('11-other-word');
await select(3); await select(3); // reopen, then remove the word
await type(['G2', 'G3', 'G3', 'G1']); await select(2); // good again
log('message', await page.evaluate(() => Array.from(document.querySelectorAll('.message .word')).map((w) => w.textContent).join(' ')));

// --- Page 2: Speak, Say again, One moment
await select(4);
await shot('12-page2');
await select(1); // Speak
await page.waitForTimeout(500); await shot('13-speaking');
await page.waitForFunction(() => window.clarteDebug.phase() === 'say-again', null, { timeout: 15000 });
await shot('14-say-again');
await select(2); // One moment
await page.waitForTimeout(300); await shot('15-one-moment');
await page.waitForFunction(() => !['speaking'].includes(window.clarteDebug.phase()), null, { timeout: 15000 });
log('after one moment', await phase());

// --- Menu: open, Selection, back, back
await select(4); await select(3);
await shot('16-menu');
await select(5); await shot('17-menu-selection');
await select(4); await select(4);
log('menu closed', await phase());

// --- End: speaks the message (already spoken, so it just clears) and returns to Listen
await select(1);
await page.waitForTimeout(600);
log('after End', await phase());
await shot('18-after-end');

// --- Recalibrate from the menu, then skip
await select(4); await select(3); await select(3);
await page.waitForTimeout(600); log('recalibrate', await phase());
await page.keyboard.press('Escape');

// --- Keys only: Listen, Pause, Respond, type "yes", accept, flip, speak
const key = async (k, wait = 260) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
await page.mouse.move(W / 2, H / 2 + 5); // park the pointer in the band
await key('1'); await page.waitForTimeout(2600); await key('1'); await key('1');
for (const k of ['8', '5', '7']) await key(k); // y e s → T–Z (Q8) A–F (Q5) O–S (Q7)
const keysCandidate = await page.evaluate(() => document.querySelector('[data-action^="autocomplete"]')?.textContent);
await key('2');
const keysMessage = await page.evaluate(() => Array.from(document.querySelectorAll('.message .word')).map((w) => w.textContent).join(' '));
await key('4'); await key('1'); await page.waitForTimeout(300);
const keysPhase = await phase();
await shot('19-keys-only-speaking');
log('keys only: candidate', keysCandidate, '· message', keysMessage, '· phase', keysPhase);

// Text at 200% while composing.
await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
await page.evaluate(() => { localStorage.setItem('clarte.style1.settings', JSON.stringify({ noise: 0.06, textScale: 2 })); });
await page.reload();
await page.waitForFunction(() => window.clarteDebug);
await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
await page.waitForTimeout(400); await shot('20-text-200');
log('errors', errors.length ? errors : 'none');

await context.close();
const videos = readdirSync(join(out, 'video'));
if (videos[0]) renameSync(join(out, 'video', videos[0]), join(out, 'walk.webm'));
await browser.close();
