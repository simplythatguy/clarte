// MOTION item 4: the commit click sounds in the same frame as the ring's commit (solid ring + bloom).
import { createRequire } from 'node:module';
const require = createRequire('/Users/aamia/clarte/prototypes/UI/v0/s5/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.addInitScript(() => {
  window.__ev = [];
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when = 0) {
    const ctx = this.context;
    window.__ev.push({ kind: 'osc', t: performance.now(), freq: window.__lastFreq, lead: (when - ctx.currentTime) * 1000, state: ctx.state, base: (ctx.baseLatency ?? 0) * 1000, out: (ctx.outputLatency ?? 0) * 1000 });
    return start.call(this, when);
  };
  const setV = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function (v, t) { if (v > 50) window.__lastFreq = v; return setV.call(this, v, t); };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (k, o) {
    if (this.classList?.contains('ring-bloom')) window.__ev.push({ kind: 'bloom', t: performance.now() });
    return animate.call(this, k, o);
  };
  new MutationObserver((ms) => { for (const m of ms) if (m.target.getAttribute?.('data-gaze') === 'done') window.__ev.push({ kind: 'done', t: performance.now() }); })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-gaze'] });
  const raf = () => { window.__frames = window.__frames ?? []; window.__frames.push(performance.now()); requestAnimationFrame(raf); }; requestAnimationFrame(raf);
});
await p.goto('http://localhost:5105/');
await p.evaluate(() => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true, settings: {} })));
await p.goto('http://localhost:5105/#phase=idle'); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
const state = await p.evaluate(async () => { const c = new AudioContext(); await c.resume(); const s = c.state; await c.close(); return s; });
const rest = { x: 720, y: 300 };
const results = [];
for (const q of ['.cell-q5', '.cell-q6', '.cell-q7', '.cell-q8', '.cell-q4']) {
  await p.mouse.move(rest.x, rest.y, { steps: 3 }); await p.waitForTimeout(400);
  await p.evaluate(() => { window.__ev = []; });
  const box = await p.locator(`${q} .card`).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 }); await p.waitForTimeout(1300);
  const r = await p.evaluate(() => {
    const ev = window.__ev; const osc = ev.find((e) => e.kind === 'osc'); const bloom = ev.find((e) => e.kind === 'bloom'); const done = ev.find((e) => e.kind === 'done');
    if (!osc || !bloom) return { missing: ev.map((e) => e.kind) };
    const frame = window.__frames.find((f) => f >= Math.max(bloom.t, done?.t ?? 0)); // first frame that paints the commit
    return { freq: osc.freq, state: osc.state, call: +(osc.t - bloom.t).toFixed(2), doneVsBloom: done ? +(done.t - bloom.t).toFixed(2) : null, scheduledLead: +osc.lead.toFixed(2), latency: +(osc.base + osc.out).toFixed(1), commitFrame: +(frame - osc.t).toFixed(2) };
  });
  results.push({ q, ...r });
}
console.log('AudioContext state with autoplay allowed:', state);
console.table(results);
await b.close();
