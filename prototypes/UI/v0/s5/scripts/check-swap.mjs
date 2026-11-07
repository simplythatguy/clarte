// Card swaps, frame by frame (MOTION: nothing changes layout on a state change; one cross-fade).
// For each screen change: every surviving card's ring must not move, the outgoing face must keep
// its on-screen font size on its first frame, and no frame may show both faces above 0.15.
// Also: a hint is never larger than its label.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:5105/';
const PAIRS = [['idle', 'menu'], ['menu', 'menu-settings'], ['menu-settings', 'menu'], ['menu', 'menu-phrases'], ['composing-pending', 'composing-ready'], ['composing-ready', 'speaking'], ['suggested', 'composing-pending'], ['menu', 'idle']];
const b = await chromium.launch(); let bad = 0;
for (const vp of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) for (const scale of [1, 2]) {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  await p.goto(BASE);
  await p.evaluate((s) => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true, settings: { textScale: s } })), scale);
  for (const [from, to] of PAIRS) {
    await p.goto(`${BASE}#phase=${from}`); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(700);
    const r = await p.evaluate(async (to) => {
      const cells = ['q1', 'q4', 'q5', 'q6', 'q7', 'q8'];
      const ring = (q) => document.querySelector(`.cell-${q} > .card:not(.card-gone) .ring`)?.getBoundingClientRect();
      const label = (q) => document.querySelector(`.cell-${q} .card-swap:not(.card-leaving) :is(.card-label, .setting-value, .phrase)`);
      const before = Object.fromEntries(cells.map((q) => [q, { ring: ring(q)?.top, size: label(q) ? getComputedStyle(label(q)).fontSize : null }]));
      window.clarteDebug.setPhase(to);
      const out = { moved: [], resized: [], doubled: [] };
      const t0 = performance.now(); let frame = 0;
      while (performance.now() - t0 < 450) {
        await new Promise(requestAnimationFrame); frame++;
        for (const q of cells) {
          const r = ring(q); const was = before[q].ring;
          if (r && was != null && Math.abs(r.top - was) > 0.5) out.moved.push(`${q} ${(r.top - was).toFixed(1)}px @f${frame}`);
          const leaving = document.querySelector(`.cell-${q} .card-leaving :is(.card-label, .setting-value, .phrase)`);
          if (frame === 1 && leaving && before[q].size && getComputedStyle(leaving).fontSize !== before[q].size) out.resized.push(`${q} ${before[q].size}→${getComputedStyle(leaving).fontSize}`);
          const faces = [...document.querySelectorAll(`.cell-${q} .card-swap`)].map((e) => +getComputedStyle(e).opacity);
          // Page changes stagger (out 150, in from 100) so the faces never overlap; a change within one
          // screen is MOTION's 150 ms label cross-fade, which overlaps by design (data-fast).
          const page = !document.querySelector(`.cell-${q} .card-swap[data-fast]`);
          if (page && faces.length > 1 && faces.filter((o) => o > 0.15).length > 1) out.doubled.push(`${q} @f${frame}`);
        }
      }
      const hints = [...document.querySelectorAll('.card:not(.card-gone) .card-swap:not(.card-leaving) .card-hint')].map((h) => {
        const l = h.parentElement.querySelector('.card-label'); return l && parseFloat(getComputedStyle(h).fontSize) > parseFloat(getComputedStyle(l).fontSize) ? `"${h.textContent}" over "${l.textContent}"` : null;
      }).filter(Boolean);
      return { ...out, hints };
    }, to);
    const issues = [...new Set(r.moved.map((m) => m.split(' @')[0]))].map((m) => `ring moved ${m}`).concat(r.resized.map((x) => `outgoing resized ${x}`), r.doubled.length ? [`doubled ${r.doubled[0]}`] : [], r.hints.map((h) => `hint ${h}`));
    if (issues.length) { bad++; console.log(`${vp.width}x${vp.height} @${scale * 100}% ${from} → ${to}: ${issues.join('; ')}`); }
  }
  await p.context().close();
}
console.log(bad ? `${bad} transition(s) with issues` : `swaps: rings still, outgoing faces keep their size, page changes never doubled, hints under labels (${PAIRS.length} transitions × 2 viewports × 2 text sizes)`);
await b.close();
