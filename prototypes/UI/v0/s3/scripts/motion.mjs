#!/usr/bin/env node
/**
 * Records the motion MOTION.md's acceptance list asks to see, at real speed, with the mouse as gaze:
 *   A. the whole first-run calibration (position, nine points, check, Ready, Start);
 *   B. a dwell cancelled at about half, then the same tile completed;
 *   C. ten consecutive letter selections, logging how far each commit click (earcon) lands from the
 *      frame where the ring completes;
 *   D. reduced motion: one cancelled dwell and one commit;
 *   E. reduced motion with Controls at Slowest: a whole recalibration (rings fill over 1750 ms).
 * Writes evidence/motion.webm and evidence/motion.txt (segment times, so frames.mjs can scrub them).
 *
 *   node scripts/motion.mjs http://localhost:5103 evidence
 */
import { mkdirSync, renameSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out = 'evidence'] = process.argv.slice(2);
const W = 1440, H = 900;
const tmp = join(out, '.video-motion');
mkdirSync(tmp, { recursive: true });
const Q = (n) => [W * (((n - 1) % 4) + 0.5) / 4, H * (n > 4 ? 0.75 : 0.25)];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: 960, height: 600 } } });
await context.addInitScript(() => {
  // Log every earcon start and every ring completion, on the page clock.
  window.__clicks = []; window.__commits = [];
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    const ctx = this.context;
    window.__clicks.push(performance.now() + Math.max(0, (when ?? 0) - ctx.currentTime) * 1000 + ctx.outputLatency * 1000);
    return start.call(this, when);
  };
  // Every calibration ring fill: when it starts and how long it runs.
  window.__fills = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, opts) {
    // One entry per fill: the right blade (normal motion) or the track (reduced motion).
    if (this.closest?.('.cal-mark') && (this.matches('.ring') || this.closest('.arc-half--right')) && !this.closest('[data-leaving]') && typeof opts === 'object' && opts.duration > 1) {
      window.__fills.push({ t: Math.round(performance.now()), ms: Math.round(opts.duration), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
    return animate.call(this, frames, opts);
  };
  new MutationObserver((list) => {
    for (const m of list) if (m.target.dataset?.dwell === 'done' && m.oldValue !== 'done') window.__commits.push(performance.now());
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-dwell'], attributeOldValue: true });
});
const page = await context.newPage();
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2);
const log = [];
const mark = (label) => { log.push(`${at().padStart(6)} s  ${label}`); };
const wait = (ms) => page.waitForTimeout(ms);
const move = async (x, y) => page.mouse.move(x, y, { steps: 8 });
const look = async (n, ms) => { const [x, y] = Q(n); await move(x, y); await wait(ms); };
const rest = async (ms = 500) => { await move(W / 2, H * 0.12); await wait(ms); };
const phase = () => page.evaluate(() => window.clarteDebug.phase());
const typed = () => page.evaluate(() => document.querySelectorAll('.layer[data-live] .wip [data-typed]').length + document.querySelectorAll('.layer[data-live] .message .word').length * 100);
/** Look at a tile, then leave before the dwell completes; true when nothing was selected. */
const cancelled = async (n) => { const before = await typed(); await look(n, 300); await rest(900); return (await typed()) === before; };

// A. First-run calibration at its own pace.
await page.goto(`${url}/?partner=script`, { waitUntil: 'networkidle' });
await page.keyboard.press('Shift');          // a key press unlocks audio, as a first touch would
mark('A calibration starts (position)');
await move(W / 2, H * 0.12);
for (let i = 0; i < 120 && !(await phase()).startsWith('calibrate-ready'); i++) {
  const p = await phase();
  if (!log.some((l) => l.endsWith(p))) mark(p);
  await wait(500);
}
mark('calibrate-ready');
await wait(800);
await look(6, 1600);   // Start: the wide card owns Q5–Q8 (a still look on a grid line meets the dead band)
mark(`after Start: ${await phase()}`);
await page.evaluate(() => window.clarteDebug.setPhase('compose-pending'));
await rest(900);

// B. A cancelled dwell, then a completed one.
mark('B dwell on G–N, leave at about half');
const bCancelled = await cancelled(6);
mark(`B cancelled, nothing selected: ${bCancelled}`);
mark('B same tile, held to commit');
await look(6, 1300);
await rest(900);

// C. Ten consecutive letter selections.
await page.evaluate(() => { window.__clicks.length = 0; window.__commits.length = 0; });
mark('C ten letters in a row');
for (const n of [5, 6, 7, 8, 5, 6, 7, 8, 5, 6]) { await look(n, 1150); await rest(450); }
const sync = await page.evaluate(() => ({ clicks: window.__clicks, commits: window.__commits }));
mark(`C done: ${sync.commits.length} commits, ${sync.clicks.length} earcon oscillators`);
await page.evaluate(() => window.clarteDebug.setPhase('compose-pending'));
await rest(600);

// D. Reduced motion.
await page.emulateMedia({ reducedMotion: 'reduce' });
mark('D reduced motion: cancelled dwell');
const dCancelled = await cancelled(7);
mark(`D cancelled, nothing selected: ${dCancelled}`);
mark('D reduced motion: commit');
await look(7, 1300);
await rest(1200);

// E. Reduced motion with Controls at Slowest (2000 ms; its ring fills over 1750 ms): Recalibrate.
await page.keyboard.press('Shift');
await page.evaluate(() => window.clarteDebug.setPhase('menu-selection'));
await wait(500);
for (let i = 0; i < 3; i++) { await page.keyboard.press('5'); await wait(250); }
const controls = await page.locator('[data-action="control-speed"]').innerText();
await page.evaluate(() => window.clarteDebug.setPhase('menu-menu'));
await wait(500);
await move(W / 2, H * 0.12);
await page.keyboard.press('5');               // Recalibrate
mark(`E reduced motion, ${controls.replace(/\s+/g, ' ')}: recalibration starts`);
for (let i = 0; i < 160 && !(await phase()).startsWith('calibrate-ready'); i++) {
  const p = await phase();
  if (!log.some((l) => l.endsWith(`E ${p}`))) mark(`E ${p}`);
  await wait(500);
}
mark('E calibrate-ready');
const fills = await page.evaluate(() => window.__fills);
await wait(600);
mark('end');

await context.close();
await browser.close();
const video = readdirSync(tmp).find((f) => f.endsWith('.webm'));
renameSync(join(tmp, video), join(out, 'motion.webm'));
rmSync(tmp, { recursive: true, force: true });

// Pair each commit with the nearest click after it (commit earcons start at the select event).
const deltas = sync.commits.map((c) => {
  const k = sync.clicks.filter((t) => t >= c - 50).sort((a, b) => a - b)[0];
  return k === undefined ? null : Math.round(k - c);
});
const lines = [
  'Segments (seconds into evidence/motion.webm; the video starts a moment before t0):',
  ...log,
  '',
  'Commit click vs ring completion, ten consecutive letters (ms; positive = click after the ring completes, includes output latency):',
  `  ${deltas.map((d) => (d === null ? 'none' : d)).join(', ')}`,
  '',
  'Calibration ring fills (each target: fill duration in ms; the app ring at that Controls speed is dwell − 250 ms):',
  `  default motion: ${fills.filter((f) => !f.reduced).map((f) => f.ms).join(', ')}`,
  `  reduced motion, Slowest: ${fills.filter((f) => f.reduced).map((f) => f.ms).join(', ')}`,
];
writeFileSync(join(out, 'motion.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
