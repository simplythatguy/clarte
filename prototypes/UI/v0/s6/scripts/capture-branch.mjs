#!/usr/bin/env node
/**
 * One screenshot of the branch as the real engine calls it (`branch: true`): after "Where would
 * you like to go for dinner tonight?" and "some", the groups G–N G–N split between "kind" and
 * "nice". Searches a few two-group codes and keeps the first the engine branches on.
 *
 *   node scripts/capture-branch.mjs [--app http://localhost:5106] [--engine http://127.0.0.1:8765] [--out evidence/real-engine]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const APP = (args.app ?? 'http://localhost:5106').replace(/\/$/, '');
const ENGINE = (args.engine ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const OUT = args.out ?? 'evidence/real-engine';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The engine must be answering promptly, or every shot would show the local decoder: three predictions under 400 ms each. */
async function engineResponsive(origin) {
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const ok = await fetch(`${origin}/api/v1/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: i, history: [['partner', 'Where would you like to go for dinner tonight?']], message: ['i'], groups: '' }), signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
    if (!ok || Date.now() - t0 > 400) return false;
  }
  return true;
}
if (!(await engineResponsive(ENGINE))) { console.error(`the engine at ${ENGINE} is not answering within 400 ms (busy or down): nothing captured`); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${APP}/?onboarding=off&engine=${encodeURIComponent(ENGINE)}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
await page.waitForFunction(() => !window.clarteDebug.engineDown(), null, { timeout: 15000 });
const settle = () => page.waitForFunction(() => window.clarteDebug.prediction().source === 'engine', null, { timeout: 5000 }).then(() => sleep(350), () => sleep(350));
let done = false;
for (const code of ['66', '55', '56', '65', '67', '75']) {
  await page.evaluate(() => { window.clarteDebug.reset(); window.clarteDebug.settings({ textScale: 1, theme: 'light', partner: 'script' }); window.clarteDebug.heard('Where would you like to go for dinner tonight?'); });
  await settle();
  // "I", then "some" by typing O–S O–S G–N A–F, then the two groups under test.
  await page.keyboard.press('1'); await settle();
  for (const k of ['7', '7', '6', '5']) { await page.keyboard.press(k); await sleep(80); }
  await settle();
  await page.keyboard.press('1'); await settle();
  for (const k of code) { await page.keyboard.press(k); await sleep(120); }
  await settle();
  await sleep(700); // the lines finish drawing (480 ms)
  const v = await page.evaluate(() => ({ phase: window.clarteDebug.phase(), branch: window.clarteDebug.prediction().branch, q1: document.querySelector('.cell-q1 .card-swap:not(.card-leaving)')?.innerText.trim(), q4: document.querySelector('.cell-q4 .card-swap:not(.card-leaving)')?.innerText.trim(), words: window.clarteDebug.state().composition.words.map((w) => w.text).join(' ') }));
  console.log(code, JSON.stringify(v));
  if (v.phase === 'composing-branch' && v.branch === true) {
    await page.screenshot({ path: join(OUT, '04-branch-real-engine.png') });
    await page.keyboard.press('4'); await sleep(500);
    await page.screenshot({ path: join(OUT, '04b-branch-second-accepted.png') });
    console.log(`  → 04-branch-real-engine.png ("${v.words}" + ${v.q1} / ${v.q4}), 04b-branch-second-accepted.png`);
    done = true;
    break;
  }
}
await browser.close();
if (!done) { console.error('the engine branched on none of the codes tried'); process.exit(1); }
