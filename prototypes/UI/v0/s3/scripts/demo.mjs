#!/usr/bin/env node
/**
 * Records a short demo of the full loop with the mouse as gaze (no clicks), and measures one stage
 * transition frame by frame to prove it is opacity only.
 *
 *   node scripts/demo.mjs http://localhost:5103 evidence
 */
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out = 'evidence'] = process.argv.slice(2);
const W = 1440, H = 900;
const tmp = join(out, '.video');
mkdirSync(tmp, { recursive: true });
const Q = (n) => [W * (((n - 1) % 4) + 0.5) / 4, H * (n > 4 ? 0.75 : 0.25)];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: 960, height: 600 } } });
await context.addInitScript(() => localStorage.setItem('clarte.style3.calibrated', '1'));
const page = await context.newPage();
const videoStart = Date.now();
const wait = (ms) => page.waitForTimeout(ms);
const look = async (n, ms) => { const [x, y] = Q(n); await page.mouse.move(x, y, { steps: 8 }); await wait(ms); };
const rest = async (ms = 400) => { await page.mouse.move(W / 2, H * 0.12, { steps: 8 }); await wait(ms); };

await page.goto(`${url}/?partner=script`, { waitUntil: 'networkidle' });
await rest(900);

// Transition 1, measured: Compose → Listen. Sample every frame for 600 ms after the dwell fires.
await page.evaluate(() => {
  window.__samples = [];
  const layers = () => [...document.querySelectorAll('.layer')];
  const tileBox = () => [...document.querySelectorAll('.layer[data-live] .tile')].map((t) => { const r = t.getBoundingClientRect(); return `${t.dataset.action}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`; }).join(' ');
  const start = performance.now();
  let started = null;
  const loop = (t) => {
    const ls = layers();
    const moved = [...document.querySelectorAll('.layer, .tile, .rest, .transcript, .message')].some((el) => { const c = getComputedStyle(el); return c.transform !== 'none' || c.translate !== 'none' || c.scale !== 'none'; });
    if (ls.length > 1 && started === null) { started = t; window.__startedWall = Date.now(); }
    if (started !== null) window.__samples.push({
      t: Math.round(t - started),
      layers: ls.map((l) => `${l.dataset.live ? 'in' : 'out'}:${l.dataset.stage}:${Number(getComputedStyle(l).opacity).toFixed(2)}`).join(' '),
      moved,
      boxes: tileBox(),
      kind: document.querySelector('.layer[data-live]').dataset.stage,
    });
    if (started === null ? t - start < 4000 : t - started < 500) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await look(1, 1500);
const samples = await page.evaluate(() => window.__samples);
const transitionAt = (await page.evaluate(() => window.__startedWall)) - videoStart;

await rest(6500);                      // the partner speaks
await look(6, 1400);                   // Transition 2: Done → Compose
await rest(700);
for (const n of [8, 5, 7]) await look(n, 950);   // y e s: T–Z, A–F, O–S
await rest(900);
await look(1, 1400);                   // accept "Was"
await rest(500);
await look(4, 1400);                   // Delete reopens at "Yes"
await rest(700);
await look(1, 1400);                   // accept "Yes"
await rest(900);
await look(1, 1500);                   // Transition 3: Done → Speak
await rest(900);
await look(7, 1500);                   // Speak
await rest(3500);                      // highlighted words, then Spoken
await wait(800);

await context.close();
await browser.close();

const video = readdirSync(tmp).find((f) => f.endsWith('.webm'));
renameSync(join(tmp, video), join(out, 'demo-loop.webm'));
rmSync(tmp, { recursive: true, force: true });

const opacityOnly = samples.every((s) => !s.moved);
const kinds = [...new Set(samples.map((s) => s.kind))];
const boxes = new Set(samples.map((s) => s.boxes));
console.log('transition samples (ms after the change: layer, stage, opacity):');
for (const s of samples) console.log(`  ${String(s.t).padStart(3)} ms  ${s.layers}`);
console.log(`stages seen ${kinds.join(' → ')}; incoming tile boxes constant through the fade: ${boxes.size <= 1}`);
console.log(`opacity only (no transform, translate or scale on layers, tiles or text): ${opacityOnly}`);
console.log(`first transition starts ≈ ${(transitionAt / 1000).toFixed(2)} s into the video`);
console.log(`video → ${join(out, 'demo-loop.webm')}`);
