// Reading safety: thread content inside Q2–Q3; live line never silently clipped; gazing at the
// text never selects; incremental typing of a long unknown word stays fitted.
import { createRequire } from 'node:module';
const require = createRequire('/Users/aamia/clarte/prototypes/UI/v0/s5/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch();
const URL = 'http://localhost:5105/';
let bad = 0; const log = (...a) => console.log(...a);
const open = async (vp, scale, phase) => {
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
  await p.goto(URL);
  await p.evaluate((s) => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true, settings: { textScale: s } })), scale);
  await p.goto(`${URL}#phase=${phase}`); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  return { ctx, p };
};
const audit = (p) => p.evaluate(() => {
  const W = innerWidth, H = innerHeight; const out = [];
  const t = document.querySelector('.thread:not(.thread-title)'); if (!t) return out;
  for (const sel of ['.state-row', '.history', '.now']) {
    const el = t.querySelector(sel); if (!el) continue; const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    if (r.left < W / 4 - 0.5 || r.right > 3 * W / 4 + 0.5 || r.top < -0.5 || r.bottom > H / 2 + 0.5) out.push(`${sel} outside Q2–Q3 (bottom ${r.bottom.toFixed(1)} > ${H / 2})`);
  }
  const now = t.querySelector('.now'); const inner = now?.querySelector(':scope > span > .now-text');
  if (now && inner && inner.offsetHeight > now.clientHeight + 1) out.push(`live line clipped ${inner.offsetHeight}px in ${now.clientHeight}px${now.hasAttribute('data-overflow') ? ' (masked)' : ' UNMARKED'}`);
  return out;
});
const ctx0 = await b.newContext(); const p0 = await ctx0.newPage(); await p0.goto(URL); await p0.waitForFunction(() => window.clarteDebug);
const phases = (await p0.evaluate(() => window.clarteDebug.phases)).filter((n) => !n.startsWith('calibrate')); await ctx0.close();
for (const vp of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) for (const scale of [1, 2]) {
  for (const phase of phases) {
    const { ctx, p } = await open(vp, scale, phase);
    const r = await audit(p);
    if (r.length) { if (r.some((x) => !x.includes('(masked)') || !phase.startsWith('worst'))) bad++; log(`${vp.width}x${vp.height} @${scale * 100}% ${phase}: ${r.join('; ')}`); }
    await ctx.close();
  }
}
// Incremental typing of an unknown word after "Ask" (Sol R5 #2): delete all groups, retype by key.
const GROUP = { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5, g: 6, h: 6, i: 6, j: 6, k: 6, l: 6, m: 6, n: 6, o: 7, p: 7, q: 7, r: 7, s: 7, t: 8, u: 8, v: 8, w: 8, x: 8, y: 8, z: 8 };
for (const vp of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) for (const scale of [1, 2]) {
  const { ctx, p } = await open(vp, scale, 'worst-nomatch');
  for (let i = 0; i < 13; i++) { await p.keyboard.press('4'); await p.waitForTimeout(40); }
  const steps = [];
  for (const ch of 'wojciechowski') {
    await p.keyboard.press(String(GROUP[ch])); await p.waitForTimeout(60);
    const r = await audit(p); if (r.length) steps.push(`${ch}: ${r.join('; ')}`);
  }
  const glyphs = await p.evaluate(() => document.querySelectorAll('.now .glyph:not(.leaving)').length);
  if (steps.some((s) => s.includes('UNMARKED'))) bad++;
  log(`typing ${vp.width}x${vp.height} @${scale * 100}%: ${glyphs} glyphs, ${steps.length ? steps.join(' | ') : 'fitted at every step'}`);
  await ctx.close();
}
// Gaze on text: dwell 2 s on the last visible word of the live line and of the newest turn.
for (const vp of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) for (const scale of [1, 2]) for (const phase of ['composing-ready', 'worst-case', 'suggested']) {
  const { ctx, p } = await open(vp, scale, phase);
  const targets = await p.evaluate(() => {
    const pts = [];
    for (const sel of ['.now .now-text', '.history .turn:last-child']) {
      const el = document.querySelector(sel); if (!el) continue;
      const clip = (el.closest('.now') ?? el.closest('.history')).getBoundingClientRect();
      const rects = [...el.getClientRects()].length ? (() => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()]; })() : [];
      const vis = rects.filter((x) => x.width > 4 && x.bottom <= clip.bottom + 1 && x.top >= clip.top - 1);
      const last = vis.sort((a, b2) => a.bottom - b2.bottom || a.right - b2.right).at(-1);
      if (last) pts.push({ sel, x: last.right - 6, y: last.top + last.height / 2 });
    }
    return pts;
  });
  for (const t of targets) {
    const before = await p.evaluate(() => [window.clarteDebug.phase(), document.querySelector('.thread')?.textContent]);
    await p.mouse.move(t.x, t.y, { steps: 4 }); await p.waitForTimeout(2000);
    const after = await p.evaluate(() => [window.clarteDebug.phase(), document.querySelector('.thread')?.textContent]);
    const same = before[0] === after[0] && before[1] === after[1];
    if (!same) bad++;
    log(`gaze ${vp.width}x${vp.height} @${scale * 100}% ${phase} ${t.sel} at (${t.x.toFixed(0)},${t.y.toFixed(0)}): ${same ? 'no selection' : `CHANGED ${before[0]} → ${after[0]}`}`);
  }
  await ctx.close();
}
log(bad ? `${bad} failure(s)` : 'reading safety: all thread content inside Q2–Q3; no unmarked clipping; gaze on text selects nothing');
await b.close();
