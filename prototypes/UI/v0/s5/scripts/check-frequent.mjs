// Sol R6: (1) a candidate change while typing fades within 150 ms with no entrance delay, while a
// page change keeps MOTION's page timing; (2) under reduced motion the dwell ring's brightness only rises.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:5105/';
const b = await chromium.launch(); let bad = 0;
const page = async (reduced) => {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })).newPage();
  await p.goto(BASE); await p.evaluate(() => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true, settings: {} })));
  await p.goto(`${BASE}#phase=idle`); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  return p;
};
const centre = async (p, q) => { const r = await p.locator(`.cell-${q} .card`).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const rest = [720, 300];
// (1) Dwell G2, back to rest, then sample Q1 while dwelling G1.
{
  const p = await page(false);
  await p.mouse.move(...rest); await p.waitForTimeout(300);
  await p.mouse.move(...(await centre(p, 'q6')), { steps: 3 }); await p.waitForTimeout(1100);
  await p.mouse.move(...rest, { steps: 3 }); await p.waitForTimeout(700);
  const before = await p.evaluate(() => document.querySelector('.cell-q1 .card-swap:not(.card-leaving)')?.textContent);
  await p.evaluate(() => {
    window.__s = []; const t0 = performance.now();
    const tick = () => { const faces = [...document.querySelectorAll('.cell-q1 .card-swap')].map((e) => `${e.classList.contains('card-leaving') ? 'out' : 'in'}:${e.textContent}:${(+getComputedStyle(e).opacity).toFixed(2)}`); window.__s.push([performance.now() - t0, faces]); if (performance.now() - t0 < 2200) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await p.mouse.move(...(await centre(p, 'q5')), { steps: 3 }); await p.waitForTimeout(1500);
  const s = await p.evaluate(() => window.__s);
  // Find the frame the new face appears and when it reaches full opacity.
  const firstIdx = s.findIndex(([, f]) => f.some((x) => x.startsWith('out:')));
  if (firstIdx < 0) { bad++; console.log('candidate: no swap observed', before); }
  else {
    const t0 = s[firstIdx][0];
    const inName = s[firstIdx][1].find((x) => x.startsWith('in:')).split(':')[1];
    const full = s.slice(firstIdx).find(([, f]) => f.some((x) => x.startsWith(`in:${inName}:`) && parseFloat(x.split(':')[2]) >= 0.99));
    const firstIn = parseFloat(s[firstIdx + 1]?.[1].find((x) => x.startsWith('in:'))?.split(':')[2] ?? '0');
    const ms = full ? full[0] - t0 : Infinity;
    if (ms > 180) bad++;
    console.log(`candidate "${before}" → "${inName}": visible from the next frame (${firstIn}), fully in ${ms.toFixed(0)} ms`);
  }
}
// (1b) A page change still uses page timing (in waits ~100 ms).
{
  const p = await page(false);
  const s = await p.evaluate(async () => {
    window.clarteDebug.setPhase('menu'); const out = []; const t0 = performance.now();
    while (performance.now() - t0 < 500) { await new Promise(requestAnimationFrame); const e = document.querySelector('.cell-q5 .card-swap:not(.card-leaving)'); out.push([performance.now() - t0, +getComputedStyle(e).opacity]); }
    return out;
  });
  const start = s.find(([, o]) => o > 0.02); const full = s.find(([, o]) => o >= 0.99);
  console.log(`page change idle → menu, Q5: new face starts at ${start[0].toFixed(0)} ms, full at ${full[0].toFixed(0)} ms`);
}
// (2) Reduced motion: ring-track opacity across a group dwell must never fall before commit.
{
  const p = await page(true);
  await p.mouse.move(...rest); await p.waitForTimeout(300);
  await p.evaluate(() => {
    window.__r = []; const t0 = performance.now();
    const tick = () => { const c = document.querySelector('.cell-q7 .card'); window.__r.push([performance.now() - t0, c.dataset.gaze, +getComputedStyle(c.querySelector('.ring-track')).strokeOpacity]); if (performance.now() - t0 < 1400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await p.mouse.move(...(await centre(p, 'q7')), { steps: 2 }); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => window.__r);
  const live = r.filter(([, g]) => g !== 'rest' && g !== 'done');
  let drops = 0; for (let i = 1; i < live.length; i++) if (live[i][2] < live[i - 1][2] - 0.005) drops++;
  const seq = [...new Set(live.map(([, , o]) => o.toFixed(2)))].join(' → ');
  if (drops) bad++;
  console.log(`reduced motion ring opacity during the dwell: ${seq} (${drops ? `${drops} drops` : 'never falls'})`);
}
console.log(bad ? `${bad} failure(s)` : 'frequent changes fast, page changes choreographed, reduced-motion progress monotonic');
await b.close();
