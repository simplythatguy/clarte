#!/usr/bin/env node
/**
 * Regression checks for council round 3:
 * 1. At 200% text, every card stays inside its rail (and so inside its quadrant) in every phase.
 * 2. Space after Tab focus, once the pointer (gaze) has moved, does not fire the focused card.
 * 3. Looking away from a dwelling card never lets it reach a preview or a selection.
 * Round 3 (Sol):
 * 4. A failed floor-holder while listening keeps the recording pill beside the error.
 * 5. At 200% text the calibration targets stay 28 px and concentric.
 * 6. A caption pill keeps one width while its text types.
 * 7. At 200% text the letter rows break into two lines and grow.
 * Round 4 (Opus):
 * 8. After the gaze leaves mid-dwell the arc never grows and never completes (sampled every 20 ms).
 * 9. Rings and labels line up across the top rail at 100% and 200%.
 * Round 4 (Sol):
 * 10. At 200% text the longest message still shows at least one whole line, at both viewports.
 * 11. A click that lands before the tracker catches up, then a still gaze, never fires the card
 *     that replaces the clicked one (Speak → Stop) in dwell mode, from nearby and from across the screen.
 * Round 5:
 * 12. Space in dwell mode never commits an unfinished dwell.
 * 13. Back from a glance away, the arc carries on from where it stood: no jump between samples.
 * 14. On a screen change the outgoing copy keeps its labels while it fades.
 * 15. Under reduced motion a cancelled dwell fades rather than vanishing.
 * 16. At 200% the calibration result shows whole, caution included.
 * 17. A typed glyph that changes letter fades out where it stood.
 * Round 6:
 * 17b. Overlays end: after typing a word whose first group showed a dot, the message is still.
 * 18. A dwell the engine gives up drains, even when the gaze is back by then.
 * 19. The incoming screen enters as one fade: its labels are not fading on their own.
 * 20. A muted End shows why, on the card, at readable contrast.
 *
 *   node scripts/verify.mjs http://localhost:5101
 */
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5101'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
let failures = 0;
const report = (ok, text) => { if (!ok) failures += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };

async function open(viewport, settings = {}, init) {
  const page = await browser.newPage({ viewport });
  if (init) await page.addInitScript(init);
  await page.goto(`${url}/?partner=script`);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); localStorage.setItem('clarte.style1.settings', JSON.stringify(s)); }, settings);
  await page.reload();
  await page.waitForFunction(() => window.clarteDebug);
  return page;
}

// 1. Cards inside their rails at 200%.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  const page = await open(viewport, { textScale: 2 });
  const phases = (await page.evaluate(() => window.clarteDebug.phases)).filter((p) => !p.startsWith('calib-') || p === 'calib-ready');
  for (const phase of phases) {
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(450);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const rail of document.querySelectorAll('.rail')) {
        const r = rail.getBoundingClientRect();
        for (const tile of rail.querySelectorAll('.tile')) {
          for (const part of [tile, ...tile.querySelectorAll('.content:not(.content--out), .instrument')]) {
            const t = part.getBoundingClientRect();
            if (t.height && (t.top < r.top - 1 || t.bottom > r.bottom + 1)) out.push(`${tile.getAttribute('aria-label')} ${Math.round(t.top)}–${Math.round(t.bottom)} outside ${Math.round(r.top)}–${Math.round(r.bottom)}`);
          }
        }
      }
      return out;
    });
    report(bad.length === 0, `200% ${viewport.width}x${viewport.height} ${phase}${bad.length ? `: ${bad[0]}` : ''}`);
  }
  await page.close();
}

// 2. A stale keyboard focus does not take the blink.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => document.querySelector('.message')?.textContent);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.mouse.move(700, 470); await page.mouse.move(705, 472);
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('.message')?.textContent);
  report(before === after, `Space after Tab focus on "${focused}" then gaze movement leaves the message unchanged`);
  await page.close();
}

// 3. Leaving a dwell before it completes never previews or selects it.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const look = async (x, y, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await page.mouse.move(x + Math.random() * 4, y); await page.waitForTimeout(30); } };
  await look(900, 760, 420); // O–S, most of the way through a 600 ms dwell
  const states = [];
  const end = Date.now() + 500;
  await page.mouse.move(900, 300);
  while (Date.now() < end) { states.push(await page.evaluate(() => window.clarteDebug.engine.snapshot.state + ':' + window.clarteDebug.engine.snapshot.action)); await page.waitForTimeout(25); }
  const message = await page.evaluate(() => document.querySelector('.in-progress') ? 'pending' : 'none');
  report(!states.some((s) => s.startsWith('previewed:G3')) && message === 'none', `looking away at ~70% of a dwell: no preview, no selection (${[...new Set(states)].join(' → ')})`);
  await page.close();
}

// 4. Recording truth through a voice failure.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => { window.speechSynthesis.speak = (u) => setTimeout(() => u.onerror?.({ error: 'synthesis-failed' }), 30); });
  await page.evaluate(() => window.clarteDebug.setPhase('idle'));
  await page.keyboard.press('1'); await page.waitForTimeout(400);           // Listen
  await page.keyboard.press('4'); await page.waitForTimeout(300);           // More
  await page.keyboard.press('2'); await page.waitForTimeout(800);           // One moment → fails
  const pills = await page.evaluate(() => [...document.querySelectorAll('.pill')].map((p) => p.textContent).join(' + '));
  const flow = await page.evaluate(() => document.querySelector('.app')?.getAttribute('data-flow'));
  report(flow !== 'listening' || pills.includes('Listening'), `voice failure while listening shows: ${pills} (flow ${flow})`);
  await page.close();
}

// 5. Calibration targets at 200% text.
{
  const page = await open({ width: 1440, height: 900 }, { textScale: 2 });
  await page.evaluate(() => window.clarteDebug.setPhase('calib-points'));
  await page.waitForTimeout(500);
  const geometry = await page.evaluate(() => { const t = document.querySelector('.target').getBoundingClientRect(); const r = document.querySelector('.target .ring-box').getBoundingClientRect(); return { t: Math.round(t.width), r: Math.round(r.width), dx: Math.round(Math.abs((t.left + t.width / 2) - (r.left + r.width / 2))) }; });
  report(geometry.t === 28 && geometry.r === 28 && geometry.dx === 0, `calibration target at 200%: target ${geometry.t}px, ring ${geometry.r}px, offset ${geometry.dx}px`);
  await page.close();
}

// 6. Caption width stays put while typing.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.removeItem('clarte.style1.calibrated'); });
  await page.reload();
  await page.waitForSelector('.line');
  // Measured once the face has loaded; the swap from the fallback face is a separate, one-time event.
  await page.evaluate(() => document.fonts.ready);
  const widths = [];
  for (let i = 0; i < 6; i++) { widths.push(await page.evaluate(() => Math.round(document.querySelector('.line').getBoundingClientRect().width))); await page.waitForTimeout(180); }
  report(new Set(widths).size === 1, `caption pill width while typing: ${widths.join(', ')} px`);
  await page.close();
}

// 7. Letter rows at 200%.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  const sizes = [];
  for (const scale of [1, 2]) {
    const page = await open(viewport, { textScale: scale });
    await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
    await page.waitForTimeout(450);
    sizes.push(await page.evaluate(() => { const l = document.querySelector('[data-action="G2"] .letters'); return { px: parseFloat(getComputedStyle(l).fontSize), lines: Math.round(l.getBoundingClientRect().height / (parseFloat(getComputedStyle(l).fontSize) * 1.1)) }; }));
    await page.close();
  }
  report(sizes[1].px > sizes[0].px && sizes[1].lines === 2 && sizes[1].px >= 24, `G–N letters ${viewport.width}x${viewport.height}: ${sizes[0].px.toFixed(1)}px × ${sizes[0].lines} line → ${sizes[1].px.toFixed(1)}px × ${sizes[1].lines} lines at 200%`);
}

// 8. The arc after leaving, sampled every 20 ms.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const end = Date.now() + 420;
  while (Date.now() < end) { await page.mouse.move(900 + Math.random() * 4, 760); await page.waitForTimeout(30); }
  const angle = () => page.evaluate(() => {
    const deg = (el) => { const m = getComputedStyle(el).transform; if (!m || m === 'none') return 0; const [a, b] = m.slice(7, -1).split(',').map(Number); const d = Math.atan2(b, a) * 180 / Math.PI; return d < -1 ? d + 360 : d; };
    const tile = document.querySelector('[data-action="G3"]');
    return Math.round(deg(tile.querySelector('.half--r .sweep')) + deg(tile.querySelector('.half--l .sweep')));
  });
  const atLeave = await angle();
  await page.mouse.move(900, 196); // Delete's quadrant
  const samples = [];
  const stopAt = Date.now() + 600;
  while (Date.now() < stopAt) { samples.push(await angle()); await page.waitForTimeout(20); }
  const peak = Math.max(...samples);
  // The tracker's point is smoothed, so it reaches the new quadrant a few samples after the eye
  // does; the arc may advance that far (≤ 40°) and must then hold, drain, and never complete.
  report(peak <= atLeave + 40 && peak < 340 && samples.at(-1) < atLeave, `arc after leaving at ${atLeave}°: peak ${peak}°, last ${samples.at(-1)}° (holds within the tracker's lag, drains, never completes)`);
  await page.close();
}

// 9. Top-rail alignment.
for (const scale of [1, 2]) {
  for (const phase of ['composing-pending', 'menu-selection', 'menu-display']) {
    const page = await open({ width: 1440, height: 900 }, { textScale: scale });
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(500);
    const centres = await page.evaluate(() => [...document.querySelectorAll('.rail--top .tile:not([data-vis="hidden"]) .ring-box')].map((r) => { const b = r.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }));
    report(Math.max(...centres) - Math.min(...centres) <= 1, `top-rail ring centres, ${phase} at ${scale * 100}%: ${centres.join(', ')}`);
    await page.close();
  }
}

// 10. The message keeps at least one whole line at 200%.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  const page = await open(viewport, { textScale: 2 });
  await page.evaluate(() => window.clarteDebug.setPhase('worst-long'));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const scroller = document.querySelector('.middle-scroll');
    const line = parseFloat(getComputedStyle(scroller.firstElementChild).lineHeight);
    return { height: Math.round(scroller.getBoundingClientRect().height), line: Math.round(line) };
  });
  report(m.height >= m.line - 1, `worst-long at 200% ${viewport.width}x${viewport.height}: message shows ${m.height}px for a ${m.line}px line`);
  await page.close();
}

// 11. Quick click on Speak, then a still gaze: Stop must not fire.
{
  const voice = () => {
    window.speechSynthesis.speak = (u) => { setTimeout(() => u.onstart?.({}), 50); window.__end = setTimeout(() => u.onend?.({}), 5000); };
    window.speechSynthesis.cancel = () => clearTimeout(window.__end);
  };
  for (const [sx, sy] of [[720, 470], [1260, 760]]) {
  const page = await open({ width: 1440, height: 900 }, { mode: 'dwell' }, voice);
  await page.evaluate(() => window.clarteDebug.setPhase('page2'));
  await page.mouse.move(sx, sy); await page.waitForTimeout(500);
  // Speak (or Say again) is the first card of page 2; Stop takes its place while the voice plays.
  // Click it straight from the middle of the screen, before the tracker has caught up.
  const first = await page.evaluate(() => { const e = document.querySelector('[data-action="speak"], [data-action="again"]'); const r = e.getBoundingClientRect(); return { id: e.dataset.action, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(first.x, first.y, { steps: 1 });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2600); // well past the 900 ms control dwell
  const phase = await page.evaluate(() => window.clarteDebug.phase());
  report(phase === 'speaking', `click ${first.id} from (${sx}, ${sy}) then hold still in dwell mode: ${phase} after 2.6 s (${phase === 'speaking' ? 'Stop did not fire' : 'Stop fired'})`);
  await page.close();
  }
}

const centre = (page, action) => page.evaluate((a) => { const r = document.querySelector(`[data-action="${a}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, action);
const angleOf = (page, action) => page.evaluate((a) => {
  const deg = (el) => { const m = getComputedStyle(el).transform; if (!m || m === 'none') return 0; const [p, q] = m.slice(7, -1).split(',').map(Number); const d = Math.atan2(q, p) * 180 / Math.PI; return d < -1 ? d + 360 : d; };
  const tile = document.querySelector(`[data-action="${a}"]`);
  return Math.round(deg(tile.querySelector('.half--r .sweep')) + deg(tile.querySelector('.half--l .sweep')));
}, action);

// 12. Space in dwell mode, part-way through a dwell.
{
  const page = await open({ width: 1440, height: 900 }, { mode: 'dwell' });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const g1 = await centre(page, 'G1');
  await page.mouse.move(g1.x, g1.y); await page.waitForTimeout(270);
  await page.keyboard.press('Space'); await page.waitForTimeout(60);
  const pending = await page.evaluate(() => !!document.querySelector('.in-progress'));
  await page.mouse.move(720, 300); await page.waitForTimeout(300);
  report(!pending, `Space 270 ms into a dwell in dwell mode: ${pending ? 'committed' : 'nothing committed'}`);
  await page.close();
}

// 13. A glance away and back: the arc never jumps.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const g3 = await centre(page, 'G3');
  await page.mouse.move(g3.x, g3.y);
  const samples = [];
  const t0 = Date.now();
  let glanced = false;
  while (Date.now() - t0 < 900) {
    const t = Date.now() - t0;
    if (!glanced && t > 330) { glanced = true; await page.mouse.move(g3.x, 196); await page.waitForTimeout(100); await page.mouse.move(g3.x, g3.y); }
    samples.push(await angleOf(page, 'G3'));
    await page.waitForTimeout(8);
  }
  let jump = 0;
  for (let i = 1; i < samples.length; i++) jump = Math.max(jump, samples[i] - samples[i - 1]);
  report(jump <= 45, `glance away and back mid-dwell: largest step between samples ${jump}° (peak ${Math.max(...samples)}°)`);
  await page.close();
}

// 14. The outgoing copy keeps its labels.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('page2'));
  await page.waitForTimeout(500);
  const menu = await centre(page, 'menu');
  await page.mouse.click(menu.x, menu.y);
  await page.waitForTimeout(40);
  const copy = await page.evaluate(() => {
    const out = document.querySelector('.screen--out');
    if (!out) return null;
    const labels = [...out.querySelectorAll('.content:not(.content--out)')].map((c) => Number(getComputedStyle(c).opacity));
    return { copy: Number(getComputedStyle(out).opacity).toFixed(2), minLabel: Math.min(...labels), committed: !!out.querySelector('[data-gaze="latched"]') };
  });
  report(copy && copy.minLabel === 1 && copy.committed, `screen change at +40 ms: copy ${copy?.copy}, its labels at least ${copy?.minLabel}, chosen card shown committed: ${copy?.committed}`);
  await page.close();
}

// 15. Reduced motion: a cancelled dwell fades.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`${url}/?partner=script`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); });
  await page.reload(); await page.waitForFunction(() => window.clarteDebug);
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const g3 = await centre(page, 'G3');
  await page.mouse.move(g3.x, g3.y); await page.waitForTimeout(500);
  const opacity = () => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-action="G3"] .arc')).opacity).toFixed(2));
  await page.mouse.move(g3.x, 196);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 700) { seen.push(await opacity()); await page.waitForTimeout(15); }
  const between = seen.filter((o) => o > 0 && o < 0.99 && seen.indexOf(o) > 0);
  const firstZero = seen.indexOf('0.00');
  report(firstZero > 0 && seen.slice(0, firstZero).some((o, i) => i > 0 && Number(o) < Number(seen[0])), `reduced motion, leaving mid-dwell: arc opacity ${[...new Set(seen)].slice(0, 8).join(' → ')}`);
  await page.close();
}

// 16. The calibration result at 200%.
{
  const page = await open({ width: 1280, height: 720 }, { textScale: 2 });
  await page.evaluate(() => window.clarteDebug.setPhase('calib-ready'));
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const p = document.querySelector('.ready-result'); return { whole: p.scrollHeight <= p.clientHeight + 1, lines: Math.round(p.clientHeight / parseFloat(getComputedStyle(p).lineHeight)) }; });
  report(r.whole, `calibration result at 200% 1280x720: ${r.whole ? 'shown whole' : 'cut'} on ${r.lines} line(s)`);
  await page.close();
}

// 17. A changed letter fades out where it stood.
{
  const page = await open({ width: 1440, height: 900 }, { mode: 'dwell' });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const outs = [];
  // G2 then G3 ("ho" → letters change as the decode moves), each a gaze dwell.
  for (const g of ['G2', 'G3', 'G3']) {
    const c = await centre(page, g);
    await page.mouse.move(c.x, c.y); await page.waitForTimeout(800);
    const before = await page.evaluate(() => [...document.querySelectorAll('.glyph--typed')].map((e) => e.textContent).join(''));
    await page.mouse.move(720, 300);
    const t0 = Date.now();
    while (Date.now() - t0 < 200) { outs.push(await page.evaluate(() => document.querySelectorAll('.glyph-out').length)); await page.waitForTimeout(10); }
    outs.push(before);
  }
  const typed = await page.evaluate(() => [...document.querySelectorAll('.glyph--typed')].map((e) => e.textContent).join(''));
  const overlays = Math.max(...outs.filter((o) => typeof o === 'number'));
  report(overlays > 0, `typed glyphs over three groups: ${outs.filter((o) => typeof o === 'string').join(' → ')} → ${typed}; overlays seen: ${overlays}`);
  await page.close();
}

// 17b. Overlays end and the message is still after typing (Opus round 6: a dot overlay looped).
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.waitForTimeout(400);
  // Typed by clicks, which count as gaze (digit keys get no motion, so no overlays to loop).
  for (const g of ['G4', 'G2', 'G3', 'G1', 'G1']) { const c = await centre(page, g); await page.mouse.click(c.x, c.y); await page.mouse.move(720, 470); await page.waitForTimeout(350); }
  const ac = await page.evaluate(() => document.querySelector('[data-action^="autocomplete:"]')?.getAttribute('data-action'));
  if (ac) { const c = await centre(page, ac); await page.mouse.click(c.x, c.y); await page.mouse.move(720, 470); }
  await page.waitForTimeout(600);
  const count = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const mo = new MutationObserver((list) => { for (const m of list) n += m.addedNodes.length + m.removedNodes.length; });
    mo.observe(document.querySelector('.message'), { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve({ n, left: document.querySelectorAll('.glyph-out').length, text: document.querySelector('.message').textContent }); }, 1500);
  }));
  report(count.n === 0 && count.left === 0, `idle 1.5 s after typing "${count.text}": ${count.n} message mutations, ${count.left} overlays left`);
  await page.close();
}

// 18. The engine gives a dwell up while the gaze is coming back: the arc drains.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  await page.mouse.move(720, 300); await page.waitForTimeout(400);
  const g2 = await centre(page, 'G2');
  await page.mouse.move(g2.x, g2.y); await page.waitForTimeout(450);
  await page.mouse.move(g2.x, 196); await page.waitForTimeout(250);   // long enough for the engine to switch
  await page.mouse.move(g2.x, g2.y);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 500) { samples.push(await angleOf(page, 'G2')); await page.waitForTimeout(15); }
  const low = Math.min(...samples);
  report(low <= 20, `glance of 250 ms then back: the arc goes down to ${low}° before refilling (${samples.slice(0, 12).join(', ')}…)`);
  await page.close();
}

// 19. The incoming screen's labels ride its fade.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('page2'));
  await page.waitForTimeout(500);
  const menu = await centre(page, 'menu');
  await page.mouse.click(menu.x, menu.y);
  await page.waitForTimeout(110);
  const m = await page.evaluate(() => {
    const incoming = document.querySelector('.screen:not(.screen--out)');
    const labels = [...incoming.querySelectorAll('.content:not(.content--out)')].map((c) => Number(getComputedStyle(c).opacity));
    return { screen: Number(getComputedStyle(incoming).opacity).toFixed(2), minLabel: Math.min(...labels) };
  });
  report(m.minLabel === 1, `incoming Menu at +110 ms: screen ${m.screen}, its labels at least ${m.minLabel} (one fade, not two)`);
  await page.close();
}

// 20. Muted End says why.
{
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.tile')].find((t) => t.getAttribute('aria-label')?.startsWith('End'));
    const reason = tile?.querySelector('.blocked');
    if (!reason) return null;
    const style = getComputedStyle(reason);
    const box = reason.getBoundingClientRect(); const card = tile.getBoundingClientRect();
    return { text: reason.textContent, opacity: Number(getComputedStyle(tile).opacity) * Number(style.opacity), colour: style.color, inside: box.top >= card.top && box.bottom <= card.bottom };
  });
  const cut = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) for (const scale of [1, 2]) {
    const p2 = await open(viewport, { textScale: scale });
    await p2.evaluate(() => window.clarteDebug.setPhase('composing-pending')); await p2.waitForTimeout(450);
    if (await p2.evaluate(() => { const b = document.querySelector('.blocked'); return b.scrollWidth > b.clientWidth + 1; })) cut.push(`${viewport.width} at ${scale * 100}%`);
    await p2.close();
  }
  report(r && r.opacity === 1 && r.inside && cut.length === 0, `cut by an ellipsis: ${cut.join(', ') || 'never'}; muted End shows "${r?.text}" at opacity ${r?.opacity} in ${r?.colour}, inside its card: ${r?.inside}`);
  await page.close();
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
