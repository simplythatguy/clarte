#!/usr/bin/env node
/**
 * Regression checks for the defects the council found in rounds 1 and 2. Each prints ok or FAIL.
 *   node scripts/regress.mjs http://localhost:5102
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5102';
const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const Q = (n, W = 1440, H = 900) => ({ x: ((n - 1) % 4 + 0.5) * (W / 4), y: (n <= 4 ? 0.5 : 1.5) * (H / 2) });

async function fresh(opts = {}, settings = {}, phase = 'compose-words', viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, ...opts });
  const page = await context.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem('clarte-style2-calibrated', '1');
    localStorage.setItem('clarte-style2-settings', JSON.stringify(s));
  }, settings);
  await page.goto(`${url}/?phase=${phase}`, { waitUntil: 'networkidle' });
  return { context, page };
}
const look = async (page, n, ms = 1300) => { const p = Q(n); await page.mouse.move(p.x, p.y, { steps: 4 }); await page.waitForTimeout(ms); };
const rest = async (page, ms = 450) => { await page.mouse.move(720, 270, { steps: 4 }); await page.waitForTimeout(ms); };

// 1. No stale "selected" ring after a menu round trip (round 2, both members).
{
  const { context, page } = await fresh({}, { partner: 'script' });
  await rest(page);
  await look(page, 7); await rest(page);   // Menu
  await look(page, 5); await rest(page);   // Other word: back to compose
  await look(page, 6); await rest(page);   // accept
  const stale = await page.evaluate(() => [...document.querySelectorAll('[data-dwell]')].map((e) => e.dataset.action));
  check('no dwell state left on any card after a menu round trip', stale.length === 0, JSON.stringify(stale));
  await context.close();
}

// 2. A resting look does not chain into the next occupant of the quadrant.
{
  const { context, page } = await fresh({}, { partner: 'script' });
  await rest(page);
  await look(page, 7, 3500);
  check('resting on Menu for 3.5 s opens Menu once', await page.evaluate(() => window.clarteDebug.phase()) === 'menu');
  await context.close();
}

// 3. Speech that cannot start keeps the message and explains (round 2, both members).
{
  const { context, page } = await fresh({}, { partner: 'script' });
  await page.evaluate(() => {
    const Real = window.SpeechSynthesisUtterance;
    window.speechSynthesis.speak = (u) => setTimeout(() => u.onerror?.({ error: 'not-allowed' }), 30);
    void Real;
  });
  await rest(page);
  await look(page, 6); await rest(page, 300);
  const r = await page.evaluate(() => ({ phase: window.clarteDebug.phase(), message: document.querySelector('.message')?.textContent, status: document.querySelector('.status')?.textContent }));
  check('failed speech keeps the message', r.message === 'Yes after lunch', JSON.stringify(r));
  check('failed speech says what is blocked', /blocked|did not start/i.test(r.status ?? ''), r.status);
  await context.close();
}

// 4. An armed candidate is not accepted after the composition changed under it (round 2, Sol).
{
  const { context, page } = await fresh({}, { partner: 'script' }, 'compose-pending');
  await rest(page);
  const p = Q(6);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(500);
  await page.keyboard.press('8');            // T–Z typed while the gaze is armed on "outside"
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ words: [...document.querySelectorAll('.message > .word')].map((w) => w.textContent), text: document.querySelector('.message')?.textContent }));
  check('a stale armed candidate commits nothing', r.words.length === 1 && !/G\d/.test(r.text ?? ''), JSON.stringify(r));
  await context.close();
}

// 5. 200% text through the real setting: no text leaves its card or the screen (round 2, Sol, Opus).
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  const { context, page } = await fresh({}, { partner: 'script', textScale: 2 }, 'idle', viewport);
  const phases = await page.evaluate(() => window.clarteDebug.phases.filter((p) => !p.startsWith('calib-') || p === 'calib-ready'));
  const bad = [];
  for (const phase of phases) {
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(250);
    const out = await page.evaluate(() => {
      const issues = [];
      for (const el of document.querySelectorAll('.tile .letters span, .tile .clabel, .tile .candidate, .tile .sname, .tile .svalue, .tile .phrase')) {
        const range = document.createRange(); range.selectNodeContents(el);
        const r = range.getBoundingClientRect(); const t = el.closest('.tile').getBoundingClientRect();
        if (r.width && (r.left < t.left - 1 || r.right > t.right + 1 || r.top < t.top - 1 || r.bottom > t.bottom + 1 || r.left < 0 || r.right > innerWidth)) issues.push(el.closest('.tile').dataset.action + ':' + el.textContent);
      }
      return issues;
    });
    if (out.length) bad.push(`${phase} ${out.join(',')}`);
  }
  // No word breaks inside itself: every label word is one line box (round 3).
  const broken = [];
  for (const phase of phases) {
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(200);
    broken.push(...(await page.evaluate(() => [...document.querySelectorAll('.tile .fw, .tile .letters span')].filter((w) => w.getClientRects().length > 1).map((w) => w.textContent))).map((w) => `${phase}:${w}`));
  }
  const fit = await page.evaluate(() => { window.clarteDebug.setPhase('compose-words'); return new Promise((r) => setTimeout(() => {
    const box = document.querySelector('.message-box'); const lh = parseFloat(getComputedStyle(box).lineHeight);
    r({ font: getComputedStyle(document.querySelector('.message')).fontSize, fits: box.scrollHeight - lh <= box.clientHeight + 1, hidden: document.querySelectorAll('.message .is-clipped').length });
  }, 300)); });
  check(`200% text (setting) at ${viewport.width}: no text outside its card`, bad.length === 0, bad.join(' | '));
  check(`200% text at ${viewport.width}: no word breaks inside itself`, broken.length === 0, broken.join(', '));
  check(`200% text at ${viewport.width}: the three-word message fits whole by shrinking toward 100%`, fit.fits && fit.hidden === 0, JSON.stringify(fit));
  await context.close();
}

// 6. Reduced motion: cancelling a dwell never rotates the arc (round 2, Sol).
{
  const { context, page } = await fresh({ reducedMotion: 'reduce' }, { partner: 'script' });
  await rest(page);
  const p = Q(1); await page.mouse.move(p.x, p.y, { steps: 3 }); await page.waitForTimeout(500);
  await rest(page, 0);
  const samples = [];
  for (let i = 0; i < 6; i++) { samples.push(await page.evaluate(() => getComputedStyle(document.querySelector('[data-action="G1"] .arc-a')).transform)); await page.waitForTimeout(30); }
  check('reduced motion: the arc does not rotate while cancelling', new Set(samples).size === 1, JSON.stringify([...new Set(samples)]));
  await context.close();
}

// 7. Microphone: cumulative transcript, no duplication; a session that ends restarts (round 2, Sol).
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('clarte-style2-calibrated', '1');
    localStorage.setItem('clarte-style2-settings', JSON.stringify({ partner: 'microphone' }));
    window.__sessions = 0;
    class FakeRecognition {
      start() {
        const n = ++window.__sessions;
        const say = (i, text) => setTimeout(() => this.onresult?.({ resultIndex: i, results: Object.assign([...Array(i + 1)].map((_, j) => ({ isFinal: true, 0: { transcript: j === i ? text : 'x' } })), {}) }), 40 * (i + 1));
        if (n === 1) { say(0, 'Hello'); say(1, 'world'); setTimeout(() => this.onend?.(), 200); }
      }
      stop() { setTimeout(() => this.onend?.(), 10); }
    }
    window.webkitSpeechRecognition = FakeRecognition;
    window.SpeechRecognition = FakeRecognition;
  });
  await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
  await page.keyboard.press('6');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ partner: document.querySelector('.partner')?.textContent, phase: window.clarteDebug.phase(), sessions: window.__sessions, status: document.querySelector('.status')?.textContent }));
  check('microphone transcript is not duplicated', r.partner === 'Hello world', JSON.stringify(r));
  check('a microphone session that ends restarts while listening', r.phase === 'listening' && r.sessions >= 2, JSON.stringify(r));
  await context.close();
}

// 8. One moment: a blocked or silent synthesis releases holding, resumes, and says so (round 3).
for (const mode of ['blocked', 'silent']) {
  const { context, page } = await fresh({}, { partner: 'script' }, 'listening');
  await page.evaluate((m) => {
    window.speechSynthesis.speak = (u) => { if (m === 'blocked') setTimeout(() => u.onerror?.({ error: 'not-allowed' }), 30); };
  }, mode);
  await page.keyboard.press('7');
  await page.waitForTimeout(mode === 'blocked' ? 400 : 2000);
  const r = await page.evaluate(() => ({ status: document.querySelector('.status')?.textContent, second: document.querySelector('[data-action="second"]')?.disabled }));
  check(`One moment ${mode}: not stuck, says it was not spoken`, r.second === false && /blocked|not spoken/i.test(r.status ?? ''), JSON.stringify(r));
  await context.close();
}

// 9. Microphone silence never becomes the script (round 3).
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('clarte-style2-calibrated', '1');
    localStorage.setItem('clarte-style2-settings', JSON.stringify({ partner: 'microphone' }));
    window.__sessions = 0;
    class Silent { start() { window.__sessions++; setTimeout(() => { this.onerror?.({ error: 'no-speech' }); this.onend?.(); }, 20); } stop() { setTimeout(() => this.onend?.(), 5); } }
    window.webkitSpeechRecognition = Silent; window.SpeechRecognition = Silent;
  });
  await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
  await page.keyboard.press('6');
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => ({ status: document.querySelector('.status')?.textContent, partner: document.querySelector('.partner')?.textContent ?? '', sessions: window.__sessions }));
  check('a silent partner keeps the microphone (no script)', r.status === 'Listening' && r.partner === '' && r.sessions > 3, JSON.stringify(r));
  await context.close();
}

// 10. Calibration captions: inside the screen at 200%, and clear of every guide path (round 3).
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  for (const scale of [1, 2]) {
    const { context, page } = await fresh({}, { textScale: scale }, 'idle', viewport);
    const NINE = [[8, 12], [50, 12], [92, 12], [8, 50], [50, 50], [92, 50], [8, 88], [50, 88], [92, 88]];
    const FOUR = [[30, 30], [70, 30], [30, 70], [70, 70]];
    const problems = [];
    for (const [phase, path] of [['calib-position', []], ['calib-points', [[50, 50], ...NINE]], ['calib-validate', [[92, 88], ...FOUR]]]) {
      await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
      await page.waitForTimeout(300);
      const cap = await page.evaluate(() => { const r = document.querySelector('.caption')?.getBoundingClientRect(); return r && { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
      if (!cap) { problems.push(`${phase}: no caption`); continue; }
      if (cap.l < 0 || cap.t < 0 || cap.r > viewport.width || cap.b > viewport.height) problems.push(`${phase}: off screen ${JSON.stringify(cap)}`);
      // Sample every leg of the guide path (10 px dot) and every 28 px target.
      for (let i = 0; i + 1 < path.length; i++) {
        for (let k = 0; k <= 40; k++) {
          const x = (path[i][0] + (path[i + 1][0] - path[i][0]) * k / 40) * viewport.width / 100;
          const y = (path[i][1] + (path[i + 1][1] - path[i][1]) * k / 40) * viewport.height / 100;
          const m = k === 0 || k === 40 ? 14 : 5;
          if (x + m > cap.l && x - m < cap.r && y + m > cap.t && y - m < cap.b) { problems.push(`${phase}: leg ${i} crosses the caption`); break; }
        }
      }
    }
    check(`calibration captions at ${viewport.width} ${scale * 100}%: on screen, clear of the guide`, problems.length === 0, problems.join(' | '));
    await context.close();
  }
}

// 11. The commit cue survives a selection that changes the screen (round 4).
{
  const { context, page } = await fresh({}, { partner: 'script' }, 'compose-words');
  await rest(page);
  const p = Q(7); await page.mouse.move(p.x, p.y, { steps: 4 });
  let seen = 0;
  for (let i = 0; i < 40; i++) { seen = Math.max(seen, await page.evaluate(() => document.querySelectorAll('[data-action] .commit-cue, .tile .commit-cue').length)); await page.waitForTimeout(40); }
  check('Menu (a screen change) shows its commit cue and bloom', seen > 0 && await page.evaluate(() => window.clarteDebug.phase()) === 'menu', `cue seen: ${seen}`);
  await context.close();
}

// 12. A long accepted word at 200% fits the message box's width (round 4, Sol).
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  const { context, page } = await fresh({}, { partner: 'script', textScale: 2 }, 'idle', viewport);
  const KEY = { G1: '1', G2: '4', G3: '5', G4: '8' };
  const sig = await page.evaluate(() => [...'uncomfortable'].map((c) => 'abcdef'.includes(c) ? 'G1' : 'ghijklmn'.includes(c) ? 'G2' : 'opqrs'.includes(c) ? 'G3' : 'G4'));
  for (const g of sig) { await page.keyboard.press(KEY[g]); await page.waitForTimeout(60); }
  await page.waitForTimeout(200);
  const cand = await page.evaluate(() => document.querySelector('[data-action="primary"]')?.getAttribute('aria-label'));
  await page.keyboard.press('6'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const box = document.querySelector('.message-box'); const widest = Math.max(...[...box.querySelectorAll('.message > .word')].map((w) => w.getBoundingClientRect().width)); return { widest: Math.round(widest), box: box.clientWidth, font: getComputedStyle(box).fontSize, text: document.querySelector('.message')?.textContent }; });
  check(`a long accepted word at 200% fits the width at ${viewport.width}`, r.widest <= r.box + 1, `${cand}; ${JSON.stringify(r)}`);
  await context.close();
}

// 13. After a reopen, Delete names what it does (round 4, Opus).
{
  const { context, page } = await fresh({}, { partner: 'script' }, 'compose-words');
  await page.keyboard.press('7'); await page.waitForTimeout(250);   // Menu
  await page.keyboard.press('5'); await page.waitForTimeout(250);   // Other word: reopens "lunch"
  const name = await page.evaluate(() => document.querySelector('[data-action="second"]')?.getAttribute('aria-label'));
  check('after a reopen, Q7 is "Delete the word"', name === 'Delete the word', name ?? '');
  await context.close();
}

// 14. Control labels on one screen share one size at 200% (round 4, Opus).
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  const { context, page } = await fresh({}, { partner: 'script', textScale: 2 }, 'menu', viewport);
  await page.waitForTimeout(300);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.tile .xf-layer:not(.xf-out) .clabel')].map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))));
  check(`Menu labels at 200% share one size at ${viewport.width}`, new Set(sizes).size === 1, JSON.stringify(sizes));
  await context.close();
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all regression checks passed');
process.exit(failures ? 1 : 0);
