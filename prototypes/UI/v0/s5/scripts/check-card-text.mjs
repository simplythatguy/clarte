import { createRequire } from 'node:module';
const require = createRequire('/Users/aamia/clarte/prototypes/UI/v0/s5/package.json');
const { chromium } = require('playwright');
const out = process.argv[2] ?? (await import('node:os')).tmpdir(); // screenshots of each phase at 200%, 1280×720
const b = await chromium.launch();
const ctx0 = await b.newContext(); const p0 = await ctx0.newPage();
await p0.goto('http://localhost:5105/'); await p0.waitForFunction(() => window.clarteDebug);
const phases = await p0.evaluate(() => window.clarteDebug.phases); await ctx0.close();
let bad = 0;
for (const vp of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) for (const scale of [1, 2]) {
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
  await p.goto('http://localhost:5105/');
  await p.evaluate((s) => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true, settings: { textScale: s } })), scale);
  for (const phase of phases) {
    await p.goto(`http://localhost:5105/#phase=${phase}`); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const issues = [];
      for (const card of document.querySelectorAll('.card:not(.card-gone)')) {
        const cr = card.getBoundingClientRect(); const cs = getComputedStyle(card);
        const box = { l: cr.left + parseFloat(cs.paddingLeft) - 2, r: cr.right - parseFloat(cs.paddingRight) + 2, t: cr.top + 2 - 2, b: cr.bottom + 2 };
        const count = card.querySelector('.count'); // the count glyph must sit inside the card's content box
        if (count && count.getBoundingClientRect().bottom > cr.bottom - parseFloat(cs.paddingBottom) + 4) issues.push(`count bar at the card edge (${card.textContent})`);
        for (const el of card.querySelectorAll('.card-label, .setting-name, .setting-value, .phrase, .card-hint, .letters')) {
          if (el.closest('.card-leaving')) continue;
          const er = el.getBoundingClientRect();
          const rng = document.createRange(); rng.selectNodeContents(el); const tr = rng.getBoundingClientRect();
          const track = parseFloat(getComputedStyle(el).letterSpacing) || 0; // trailing tracking is blank
          if (tr.left < box.l || tr.right - Math.max(0, track) > box.r || tr.top < cr.top || tr.bottom > cr.bottom) issues.push(`overflow "${el.textContent}"`);
          // mid-word break: any word whose rects span two lines
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n; (n = walker.nextNode());) {
            const re = /\S+/g; let m;
            while ((m = re.exec(n.data))) { const w = document.createRange(); w.setStart(n, m.index); w.setEnd(n, m.index + m[0].length);
              const tops = new Set([...w.getClientRects()].map((x) => Math.round(x.top))); if (tops.size > 1 && !el.classList.contains('letters')) issues.push(`broken "${m[0]}"`); }
          }
        }
      }
      return issues;
    });
    if (r.length) { bad++; console.log(`${vp.width}x${vp.height} @${scale * 100}% ${phase}:`, r.join('; ')); }
    if (scale === 2 && vp.width === 1280) await p.screenshot({ path: `${out}/${phase}.png` });
  }
  await ctx.close();
}
console.log(bad ? `${bad} phase(s) with issues` : 'all phases: no overflow, no mid-word break', `(${phases.length} phases × 4)`);
await b.close();
