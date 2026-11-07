#!/usr/bin/env node
/**
 * Walks the Style 3 user path in a real browser and saves the evidence screenshots.
 * Mouse as gaze (held still, no clicks), keys only, and gaze noise on.
 *
 *   node scripts/walk.mjs http://localhost:5103 evidence
 *
 * Asserts the behaviours the brief and DESIGN.md name and exits non-zero if one fails.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

let [url = 'http://localhost:5103', out = 'evidence'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = 1440, H = 900;
const Q = {
  Q1: [W * 0.125, H * 0.25], Q2: [W * 0.375, H * 0.25], Q3: [W * 0.625, H * 0.25], Q4: [W * 0.875, H * 0.25],
  Q5: [W * 0.125, H * 0.75], Q6: [W * 0.375, H * 0.75], Q7: [W * 0.625, H * 0.75], Q8: [W * 0.875, H * 0.75],
};
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const wait = (ms) => page.waitForTimeout(ms);
const phase = () => page.evaluate(() => window.clarteDebug.phase());
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
/** Look at a quadrant: move there in a few steps, then hold still. */
async function look(q, holdMs) {
  await page.mouse.move(Q[q][0], Q[q][1], { steps: 6 });
  if (holdMs) await wait(holdMs);
}
const key = (k) => page.keyboard.press(k);

try {
  // The scripted partner, chosen explicitly: automated browsers expose recognition that never answers.
  url = `${url}/?partner=script`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // First run: calibration opens the app.
  check((await phase()) === 'calibrate-position', 'first run opens on calibration');
  await wait(4400);
  check((await phase()) === 'calibrate-points', 'calibration moves to the nine points');
  await wait(2600);
  await shot('walk-01-calibration-points');
  await key('Escape');
  await wait(600);
  check((await phase()) === 'compose-empty', 'Escape skips calibration into Compose');

  // Mouse as gaze: Q1 reads Listen while the message is empty. Dwell 900 ms on a control.
  await look('Q2', 300);
  await look('Q1', 1300);
  check((await phase()) === 'listen', 'dwelling on Listen opens the Listen stage');
  await page.mouse.move(Q.Q2[0], Q.Q2[1] - 60, { steps: 4 });
  await wait(9000);
  const heard = await text('.transcript');
  check(heard.split(' ').length >= 6, `partner words arrive while listening ("${heard.slice(0, 40)}…")`);
  await shot('walk-02-listen-transcript');
  await wait(1500);

  // Done: the whole bottom row. The look stays on Q6 after the stage change.
  await look('Q6', 1300);
  check((await phase()) === 'compose-empty', 'Done ends listening');
  await wait(1600);
  const pendingAfterDone = await page.evaluate(() => window.clarteDebug.phase());
  check(pendingAfterDone === 'compose-empty', 'the look that pressed Done does not type G–N (lockout + guard)');

  // Reopen Listen: the transcript appends.
  await look('Q2', 400);
  await look('Q1', 1300);
  await page.waitForFunction(() => window.clarteDebug.phase() === 'listen', null, { timeout: 4000 });
  await page.mouse.move(Q.Q2[0], Q.Q2[1] - 60, { steps: 4 });
  await wait(8500);
  const appended = await text('.transcript');
  check(appended.startsWith(heard.slice(0, 20)) && appended.length > heard.length, 'Listen reopened after Done appends to the transcript');
  await look('Q7', 1300);
  await page.waitForFunction(() => window.clarteDebug.phase().startsWith('compose'), null, { timeout: 4000 });
  await look('Q2', 500);

  // Type "yes" by gaze: T–Z, A–F, O–S (letter dwell 600 ms).
  await look('Q8', 900); await look('Q5', 900); await look('Q7', 900);
  await look('Q3', 400);
  const firstGuess = await text('[data-action="accept"]');
  check((await page.locator('.wip [data-typed]').count()) === 3, 'three typed glyphs after three group looks');
  await shot('walk-03-compose-pending');

  // Accept the first decode, then Delete reopens it at the next candidate, Accept again.
  await look('Q1', 1300); await look('Q2', 400);
  const afterAccept = await text('.message');
  await look('Q4', 1300); await look('Q3', 400);
  const reopened = await text('[data-action="accept"]');
  check(reopened !== firstGuess, `Delete reopens "${firstGuess}" at the next candidate "${reopened}"`);
  await look('Q1', 1300); await look('Q2', 120);
  await shot('walk-04-compose-decoded-crossfade');
  await wait(500);
  check((await text('.message')).trim().startsWith('Yes'), `the reopened word is accepted (${afterAccept.trim()} → ${(await text('.message')).trim()})`);

  // Keys only from here: i (G2), would (G4 G3 G4 G2 G1), love, that.
  const typeWord = async (digits) => { for (const d of digits) { await key(d); await wait(80); } await key('1'); await wait(120); };
  await typeWord('6');
  await typeWord('87865');
  await typeWord('6785');
  await typeWord('8658');
  await wait(300);
  const message = (await text('.message')).trim();
  check(message === 'Yes I would love that', `keys type the reply ("${message}")`);
  await wait(400);
  await shot('walk-05-compose-message');

  // Done → Speak stage. One moment speaks without touching the message.
  await key('1'); await wait(700);
  check((await phase()) === 'speak', 'Done opens the Speak stage');
  await shot('walk-06-speak');
  await key('1'); await wait(300);
  check((await page.locator('.band').getAttribute('data-state')) === 'speaking', 'One moment (Q1, as in Menu) shows Speaking on the band');
  check((await text('.sentence')).trim() === 'Yes I would love that', 'One moment leaves the message intact');
  await wait(2600);

  // Speak: highlighted word, then Spoken.
  await key('7'); await wait(1100);
  check((await phase()) === 'speaking', 'Speak reads the message aloud');
  await shot('walk-07-speaking');
  await page.waitForFunction(() => window.clarteDebug.phase() === 'spoken', null, { timeout: 15000 });
  check(true, 'Speaking ends in Spoken');
  await wait(500);
  await shot('walk-08-spoken');

  // Menu (Q4, as on Compose and Speak), step pages, toggle noise in Demo, back.
  await key('4'); await wait(600);
  check((await phase()) === 'menu-menu', 'Menu opens with One moment first');
  check((await text('[data-at="Q1"]')).includes('One moment'), 'One moment is the first entry (Q1)');
  await shot('walk-09-menu');
  await key('7'); await wait(450);
  check((await phase()) === 'menu-selection', 'Menu opens the Selection page directly');
  await key('8'); await wait(200);
  check((await text('[data-action="noise"]')).includes('On'), 'gaze noise switches on');
  await key('4'); await wait(600);
  check((await phase()) === 'menu-menu', 'Back returns to the Menu root');
  await key('4'); await wait(600);
  check((await phase()) === 'spoken', 'Back again returns to Spoken');

  // With noise on: Add more (Q5, where Edit is on Speak), then type one group by gaze.
  await key('5'); await wait(600);
  check((await phase()) === 'compose-message', 'Add more returns to Compose with the message');
  await look('Q2', 400);
  await look('Q5', 1400); await look('Q2', 500);
  check((await page.locator('.wip [data-typed]').count()) >= 1, 'a group is typed by gaze with noise on');
  await shot('walk-10-compose-noise');
  await key('Escape');

  // The deciding look never selects on the next screen, with noise on, on wide tiles whose centre
  // sits on a grid line: Listen → Done held still on its label, three times.
  let stray = 0;
  for (let trial = 0; trial < 3; trial += 1) {
    await page.evaluate(() => window.clarteDebug.setPhase('listen'));
    await page.mouse.move(720, 560, { steps: 4 });
    await page.mouse.move(720, 680, { steps: 4 });
    await page.waitForFunction(() => window.clarteDebug.phase() !== 'listen', null, { timeout: 8000 });
    await wait(2500);
    stray += await page.locator('.wip [data-typed]').count();
  }
  check(stray === 0, `noisy gaze held on Done types nothing on Compose (${stray} stray groups in 3 trials)`);
  await key('Escape');
  await page.mouse.move(720, 120, { steps: 4 });

  // Recalibrate from Menu, then Start by gaze, held still: Compose must stay empty.
  await page.evaluate(() => window.clarteDebug.setPhase('menu-menu'));
  await wait(300);
  await key('5'); await wait(700);
  check((await phase()).startsWith('calibrate'), 'Recalibrate opens calibration');
  await page.evaluate(() => window.clarteDebug.setPhase('calibrate-ready'));
  await page.mouse.move(400, 560, { steps: 4 });
  await page.mouse.move(400, 680, { steps: 4 });
  await page.waitForFunction(() => window.clarteDebug.phase() === 'compose-empty', null, { timeout: 8000 });
  await wait(2500);
  check((await page.locator('.wip [data-typed]').count()) === 0, 'the look that pressed Start types nothing');
  await page.mouse.move(720, 120, { steps: 4 });

  // End of speech with the eyes still on Speak: Spoken must not select Say again.
  await page.evaluate(() => window.clarteDebug.setPhase('speak'));
  await page.mouse.move(1080, 560, { steps: 4 });
  await page.mouse.move(1080, 680, { steps: 4 });
  await page.waitForFunction(() => window.clarteDebug.phase() === 'spoken', null, { timeout: 20000 });
  await wait(2500);
  check((await phase()) === 'spoken', 'the look resting on Speak does not fire Say again when speech ends');
  await page.mouse.move(720, 120, { steps: 4 });
  await page.evaluate(() => window.clarteDebug.engine.configure({ noiseSigma: 0 }));

  // Lockout length: targets come back 400 ms after a stage change, not on a polling timer.
  const lockouts = [];
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.clarteDebug.setPhase('menu-menu'));
    await wait(200);
    lockouts.push(await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '8' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '8' }));
      const poll = () => {
        const n = window.clarteDebug.engine && document.querySelectorAll('[data-action]').length;
        const layer = document.querySelector('.layer[data-live]');
        const live = layer && !layer.hasAttribute('inert') && n > 0;
        if (live && performance.now() - t0 > 50) resolve(Math.round(performance.now() - t0)); else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    })));
  }
  check(lockouts.every((ms) => ms >= 390 && ms <= 470), `lockout lasts 400 ms every time (${lockouts.join(', ')} ms)`);

  // Looking off screen cancels a dwell: hold on Add more, then leave the window.
  await page.evaluate(() => window.clarteDebug.setPhase('spoken'));
  await page.mouse.move(180, 300, { steps: 3 });
  await page.mouse.move(180, 680, { steps: 3 });
  await wait(450);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerleave')));
  await wait(1200);
  check((await phase()) === 'spoken', 'leaving the window mid-dwell cancels it');
  await page.mouse.move(720, 120, { steps: 3 });

  // A semantic click (assistive technology, element.click()) activates a tile.
  await page.evaluate(() => window.clarteDebug.setPhase('compose-empty'));
  await wait(200);
  await page.evaluate(() => document.querySelector('[data-action="accept"]').click());
  await wait(700);
  check((await phase()) === 'listen', 'a semantic click on Listen opens Listen');

  // A phrase in the message: the highlight counts spoken words, not message entries.
  await page.evaluate(() => window.clarteDebug.setPhase('menu-message'));
  await wait(300);
  await key('6'); await wait(700);
  await key('1'); await wait(700);
  const spans = await page.locator('.sentence .word').count();
  check(spans === 7, `"Yes I would love that Yes, please." renders 7 spoken words (${spans})`);

  // Speech that fails is shown, with Speak still there to try again.
  await page.evaluate(() => { window.speechSynthesis.speak = (u) => setTimeout(() => u.onerror?.({ error: 'synthesis-failed' }), 60); });
  await key('7');
  await page.waitForFunction(() => window.clarteDebug.phase() === 'speak', null, { timeout: 8000 });
  await wait(500);
  check((await page.locator('.problem').count()) === 1, 'failed speech returns to Speak and says so');
  await shot('walk-12-speech-failed');

  // Reduced motion and 200% text.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.clarteDebug.setPhase('menu-display'));
  await wait(300);
  for (let i = 0; i < 4; i += 1) { await key('1'); await wait(150); }
  check((await text('[data-action="text-size"]')).includes('200%'), 'Text size steps to 200%');
  await page.evaluate(() => window.clarteDebug.setPhase('compose-pending'));
  await wait(400);
  await shot('walk-11-compose-200pct');
  const overlaps = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.tile__label, .message, .partner, .band__label')].map((e) => e.getBoundingClientRect());
    const tiles = [...document.querySelectorAll('.tile')].map((e) => e.getBoundingClientRect());
    const labelsOut = [...document.querySelectorAll('.tile')].filter((t) => { const l = t.querySelector('.tile__text').getBoundingClientRect(); const r = t.getBoundingClientRect(); return l.left < r.left || l.right > r.right; }).length;
    return { labelsOut, tiles: tiles.length, rects: rects.length };
  });
  check(overlaps.labelsOut === 0, `at 200% every tile label fits its tile (${JSON.stringify(overlaps)})`);

  // 200% at 1280 × 720: a long pending word's tokens and a long sentence stay inside their rest zone.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.clarteDebug.setPhase('compose-message'));
  for (const d of '7887655') { await key(d); await wait(60); }   // o u t s i d e
  await wait(400);
  const fit = await page.evaluate(() => {
    const zone = document.querySelector('.layer[data-live] .rest').getBoundingClientRect();
    const t = document.querySelector('.layer[data-live] .wip').getBoundingClientRect();
    return { zone: [zone.left, zone.right, zone.bottom].map(Math.round), tokens: [t.left, t.right, t.bottom].map(Math.round) };
  });
  check(fit.tokens[0] >= fit.zone[0] - 1 && fit.tokens[1] <= fit.zone[1] + 1 && fit.tokens[2] <= fit.zone[2] + 1, `200% tokens stay inside the rest zone ${JSON.stringify(fit)}`);
  await shot('walk-13-1280-200pct-tokens');
  await key('1'); await wait(300); await key('1'); await wait(700);
  const said = await page.evaluate(() => {
    const zone = document.querySelector('.layer[data-live] .rest').getBoundingClientRect();
    const win = document.querySelector('.layer[data-live] .text-window').getBoundingClientRect();
    return { zoneBottom: Math.round(zone.bottom), windowBottom: Math.round(win.bottom) };
  });
  check(said.windowBottom <= said.zoneBottom + 1, `200% Speak text stays inside its rest zone ${JSON.stringify(said)}`);
  // The reading window holds whole lines and its last word is fully visible (Sol r3: 50 px window
  // for a 116 px line once the partner line was added to Speak).
  const lines = () => page.evaluate(() => {
    const w = document.querySelector('.layer[data-live] .text-window'); const t = w.firstElementChild;
    const r = w.getBoundingClientRect(); const line = parseFloat(getComputedStyle(t).lineHeight);
    const last = [...t.querySelectorAll('.word')].at(-1)?.getBoundingClientRect() ?? t.getBoundingClientRect();
    return { window: Math.round(r.height), line: Math.round(line), lastIn: last.top >= r.top - 1 && last.bottom <= r.bottom + 1 };
  });
  const big = await lines();
  check(big.window >= big.line && big.lastIn, `200% Speak shows at least one whole line with its last word in view ${JSON.stringify(big)}`);
  await shot('walk-14-1280-200pct-speak');
  // Resizing refits the window (100% text, 1440 → 1280).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.clarteDebug.setPhase('menu-display'));
  await wait(300);
  await key('1'); await wait(150);
  check((await text('[data-action="text-size"]')).includes('100%'), 'Text size back to 100%');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.clarteDebug.setPhase('speak'));
  await wait(400);
  await page.setViewportSize({ width: 1280, height: 720 });
  await wait(300);
  const resized = await lines();
  check(resized.window >= resized.line && resized.lastIn, `after a resize Speak refits with its last word in view ${JSON.stringify(resized)}`);
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  await browser.close();
}
if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
console.log('walk ok');
