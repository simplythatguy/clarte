#!/usr/bin/env node
/**
 * Evidence walk for style 2: drives the real user path with the mouse as gaze (noise on), saves the
 * screenshots under evidence/ and a video of the loop, then repeats the core path with keys only.
 *
 *   node scripts/walk.mjs http://localhost:5102 evidence
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5102', out = 'evidence'] = process.argv.slice(2);
const W = 1440, H = 900;
mkdirSync(out, { recursive: true });
const videoDir = join(out, '.video');
rmSync(videoDir, { recursive: true, force: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H } });
const page = await context.newPage();
const log = (...a) => console.log(...a);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Quadrant centres (tile centres) in reading order, and a point in the rest zone.
const Q = (n) => ({ x: ((n - 1) % 4 + 0.5) * (W / 4), y: (n <= 4 ? 0.5 : 1.5) * (H / 2) });
const REST = { x: W / 2, y: H * 0.3 };
const wait = (ms) => page.waitForTimeout(ms);
const phase = () => page.evaluate(() => window.clarteDebug.phase());
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const shot = async (name) => { await wait(350); await page.screenshot({ path: join(out, `${name}.png`) }); log('shot', name, await phase()); };

/** Look at a quadrant long enough to select it (hold + dwell + margin), then rest. */
async function look(n, { dwell = 900, rest = true } = {}) {
  const p = Q(n);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await wait(150 + dwell + 650);   // margin for noise excursions that restart a dwell; the latch prevents repeats
  if (rest) { await page.mouse.move(REST.x, REST.y, { steps: 6 }); await wait(420); }
}
const group = (n) => look(n, { dwell: 600 });
const QUAD = { G1: 1, G2: 4, G3: 5, G4: 8 };

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// First run: calibration plays on its own; let it run, then skip with Escape.
await wait(2600); await shot('calib-position');
await wait(5200); await shot('calib-points');
await page.keyboard.press('Escape'); await wait(500);
await page.mouse.move(REST.x, REST.y); await wait(300);
await shot('idle');

// Menu → Demo page: gaze noise on, scripted partner (headless has no microphone).
await look(7);                       // Menu
await shot('menu');
await look(7); await look(7);        // More → Display
await look(7); await look(7);        // Selection → Demo
await look(1);                       // Gaze noise on
await look(4);                       // Partner: Script
await shot('menu-demo');
await look(6);                       // Done

// Listen.
await look(6);                       // Listen
await wait(3800);
await shot('listening');
await look(6);                       // Stop
log('partner:', await text('.partner'));

// Type "yes": T–Z, A–F, O–S. Candidate is "was"; accept, Delete reopens at "yes", accept.
await group(QUAD.G4); await group(QUAD.G1); await group(QUAD.G3);
log('candidate after T-Z A-F O-S:', await text('[data-action="primary"] .candidate'));
await shot('compose-pending-first');
await look(6);                       // accept "was"
log('message:', await text('.message'));
await look(7);                       // nothing pending: Q7 is Menu
await shot('menu-with-message');
await look(5);                       // Other word: reopen "was" at its next candidate
log('reopened candidate:', await text('[data-action="primary"] .candidate'));
await shot('delete-reopen');
await look(6);                       // accept "yes"
log('message:', await text('.message'));

// "after": A–F A–F T–Z A–F O–S (the double A–F needs a look away and back).
for (const g of ['G1', 'G1', 'G4', 'G1', 'G3']) await group(QUAD[g]);
log('candidate:', await text('[data-action="primary"] .candidate'));
await look(6);
for (const g of ['G2', 'G4', 'G2', 'G1', 'G2']) await group(QUAD[g]);
await look(6);
for (const g of ['G3', 'G2', 'G1', 'G1', 'G3', 'G1']) await group(QUAD[g]);
await look(6);
log('message:', await text('.message'));
await shot('compose-words');

// Speak, catch it mid-sentence, then Say again appears.
await look(6, { rest: true });
await wait(500);
await shot('speaking');
await page.waitForFunction(() => window.clarteDebug.phase() === 'said', null, { timeout: 20000 });
log('after speaking:', await phase(), await text('[data-action="primary"]'));
await shot('said');

// One moment while listening.
await page.waitForFunction(() => window.clarteDebug.phase() === 'idle', null, { timeout: 20000 }); // Say again window ends
await look(6); await wait(1200);
log('listening?', await phase());
await look(7);                       // One moment
await wait(300);
log('status during one moment:', await text('.status'));
await look(6);                       // Stop
log('stopped?', await phase());

// Dark theme through the menu, then back.
await look(7); await look(7); await look(7);   // Menu → More → Display
await look(4);                                  // Theme: Dark
await shot('menu-display-dark');
await look(6);
await page.mouse.move(REST.x, REST.y); await wait(400);
await shot('dark-idle');
await look(7); await look(7); await look(7); await look(4); await look(6); // back to light
log('after dark and back:', await phase());

// Recalibrate from the menu.
await look(7); log('menu?', await phase()); await look(1);
await wait(800);
log('recalibrate →', await phase());
await page.keyboard.press('Escape'); await wait(400);

await context.close();

// Short demo of the core loop, recorded: listen, type "yes" (decodes "was"), Delete reopens it at
// "yes", accept, speak with read-along, Say again. Noise on, scripted partner.
{
  const dctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: 720, height: 450 } } });
  const dp = await dctx.newPage();
  await dp.goto(url, { waitUntil: 'networkidle' });
  await dp.evaluate(() => { localStorage.setItem('clarte-style2-calibrated', '1'); localStorage.setItem('clarte-style2-settings', JSON.stringify({ partner: 'script', noise: true })); });
  await dp.reload({ waitUntil: 'networkidle' });
  const at = async (n, dwell = 900) => { const p = Q(n); await dp.mouse.move(p.x, p.y, { steps: 6 }); await dp.waitForTimeout(150 + dwell + 250); await dp.mouse.move(REST.x, REST.y, { steps: 6 }); await dp.waitForTimeout(380); };
  // One click on the rest zone (not actionable): browsers allow speech only after a user activation.
  await dp.mouse.click(REST.x, REST.y); await dp.waitForTimeout(700);
  await at(6); await dp.waitForTimeout(3200); await at(6);          // listen, stop
  // A cancelled dwell: look at A–F for 450 ms, then away; the arc drains back.
  { const p = Q(1); await dp.mouse.move(p.x, p.y, { steps: 6 }); await dp.waitForTimeout(450); await dp.mouse.move(REST.x, REST.y, { steps: 6 }); await dp.waitForTimeout(600); }
  for (const n of [8, 1, 5]) await at(n, 600);                      // T–Z A–F O–S
  await at(6); await at(7); await at(5); await at(6);               // was → Menu → Other word → yes
  for (const n of [1, 1, 8, 1, 5]) await at(n, 600);                // after
  await at(6);
  await at(6); await dp.waitForTimeout(3000);                       // speak, with the read-along
  await at(6); await dp.waitForTimeout(2500);                       // Say again
  await dctx.close();
  const video = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  if (video) { renameSync(join(videoDir, video), join(out, 'demo-loop.webm')); rmSync(videoDir, { recursive: true, force: true }); log('video', join(out, 'demo-loop.webm')); }
}

// Keys only: no mouse at all.
const kctx = await browser.newContext({ viewport: { width: W, height: H } });
const kp = await kctx.newPage();
await kp.goto(url, { waitUntil: 'networkidle' });
await kp.evaluate(() => { localStorage.setItem('clarte-style2-calibrated', '1'); localStorage.setItem('clarte-style2-settings', JSON.stringify({ partner: 'script' })); });
await kp.reload({ waitUntil: 'networkidle' });
const key = async (k, ms = 250) => { await kp.keyboard.press(k); await kp.waitForTimeout(ms); };
await key('6', 2500); await key('6');                 // listen, stop
for (const k of ['8', '1', '3', '5']) await key(k);  // T–Z, A–F, Q3 (rest: nothing), O–S
await key('6');                                        // accept
const kmsg = await kp.evaluate(() => document.querySelector('.message')?.textContent);
await key('7'); await key('5'); await key('6');        // Menu, Other word (reopens), accept
const kmsg2 = await kp.evaluate(() => document.querySelector('.message')?.textContent);
await key('Tab', 100); await key('Tab', 100);
const focus = await kp.evaluate(() => ({ el: document.activeElement?.getAttribute('aria-label'), outline: getComputedStyle(document.activeElement).outlineStyle }));
await kp.keyboard.press('Escape'); await kp.evaluate(() => document.activeElement?.blur());
await key('6', 300);                                   // speak
const kphase = await kp.evaluate(() => window.clarteDebug.phase());
log('keys:', { afterAccept: kmsg, afterDeleteAccept: kmsg2, phaseAfterSpeak: kphase, focus });
await kctx.close();

// Q2 and Q3 hold no action in any phase.
const rctx = await browser.newContext({ viewport: { width: W, height: H } });
const rp = await rctx.newPage();
await rp.goto(url, { waitUntil: 'networkidle' });
const rest = await rp.evaluate(async () => {
  const out = [];
  for (const p of window.clarteDebug.phases) {
    window.clarteDebug.setPhase(p);
    await new Promise((r) => setTimeout(r, 120));
    const owners = (q) => {
      const col = q === 'Q2' ? 1 : 2;
      const x0 = innerWidth / 4 * col, x1 = x0 + innerWidth / 4, y1 = innerHeight / 2;
      return [...document.querySelectorAll('[data-action]')].filter((el) => {
        if (el.disabled) return false;
        const r = el.getBoundingClientRect();
        return Math.min(r.right, x1) - Math.max(r.left, x0) >= 2 && Math.min(r.bottom, y1) - Math.max(r.top, 0) >= 2;
      }).map((el) => el.dataset.action);
    };
    out.push({ phase: p, Q2: owners('Q2'), Q3: owners('Q3') });
  }
  return out;
});
const bad = rest.filter((r) => r.Q2.length || r.Q3.length);
log(bad.length ? `REST VIOLATION ${JSON.stringify(bad)}` : `Q2 and Q3 are rest in all ${rest.length} phases`);
await rctx.close();

// Stills: greyscale (groups must read without colour), 200% text at the small viewport, dark compose.
const sctx = await browser.newContext({ viewport: { width: W, height: H } });
const sp = await sctx.newPage();
await sp.goto(url, { waitUntil: 'networkidle' });
const still = async (phase, name, setup = '') => {
  await sp.evaluate(([p, js]) => { window.clarteDebug.setPhase(p); if (js) eval(js); }, [phase, setup]);
  await sp.waitForTimeout(450);
  await sp.screenshot({ path: join(out, `${name}.png`) });
  log('still', name);
};
await still('compose-pending', 'compose-pending');
await still('compose-nomatch', 'compose-nomatch');
await still('compose-pending', 'greyscale-compose', "document.documentElement.style.filter = 'grayscale(1)'");
await sp.evaluate(() => { document.documentElement.style.filter = ''; });
await sp.setViewportSize({ width: 1280, height: 720 });
await still('compose-words', 'text-200-compose-1280', "document.documentElement.style.setProperty('--text-scale', '2')");
await still('listening', 'text-200-listening-1280');
await still('menu-selection', 'text-200-menu-1280');
const overlap = await sp.evaluate(() => {
  const rest = document.querySelector('.rest')?.getBoundingClientRect();
  const tiles = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
  const clipped = [...document.querySelectorAll('.tile .stack')].filter((s) => { const r = s.getBoundingClientRect(), t = s.closest('.tile').getBoundingClientRect(); return r.left < t.left || r.right > t.right || r.top < t.top || r.bottom > t.bottom; }).length;
  return { restOverlapsTile: rest ? tiles.some((t) => t.left < rest.right && t.right > rest.left && t.top < rest.bottom && t.bottom > rest.top) : false, clippedLabels: clipped };
});
log('200% text check:', overlap);
await sp.evaluate(() => document.documentElement.style.setProperty('--text-scale', '1'));
await sp.setViewportSize({ width: W, height: H });
await still('compose-pending', 'dark-compose', "document.documentElement.dataset.theme = 'dark'");
await sctx.close();

await browser.close();
log(errors.length ? `page errors: ${JSON.stringify(errors)}` : 'no page errors');
