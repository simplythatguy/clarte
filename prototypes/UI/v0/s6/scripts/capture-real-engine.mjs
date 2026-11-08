#!/usr/bin/env node
/**
 * The evidence set for s6 on the real prediction engine: what the engine actually predicts for a
 * few partner lines, typing, the Other words chooser, the local fallback while no engine answers,
 * and the long-word worst cases, at 1440×900 (and 1280×720 and 200% text where it matters).
 *
 *   node scripts/capture-real-engine.mjs [--app http://localhost:5106] [--engine http://127.0.0.1:8765] [--out evidence/real-engine]
 *
 * Needs the s6 dev server and a healthy v1 engine. Prints the engine's words as it goes, so the
 * captions in DESIGN.md can quote them.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { silentBrowser } from './silent.mjs';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const APP = (args.app ?? 'http://localhost:5106').replace(/\/$/, '');
const ENGINE = (args.engine ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const OUT = args.out ?? 'evidence/real-engine';
mkdirSync(OUT, { recursive: true });

const GROUP_OF = (ch) => ('abcdef'.includes(ch) ? 1 : 'ghijklmn'.includes(ch) ? 2 : 'opqrs'.includes(ch) ? 3 : 'tuvwxyz'.includes(ch) ? 4 : 0);
const keysOf = (word) => [...word.toLowerCase()].map(GROUP_OF).filter(Boolean).map((g) => String(4 + g));
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

const browser = await silentBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const press = async (key, delay = 120) => { await page.keyboard.press(key); await sleep(delay); };
const type = async (word) => { for (const k of keysOf(word)) await press(k, 80); };
const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log(`  → ${name}.png`); };
const q = () => page.evaluate(() => ({
  q1: document.querySelector('.cell-q1 .card')?.innerText.trim(), q4: document.querySelector('.cell-q4 .card')?.innerText.trim(),
  words: window.clarteDebug.state().composition.words.map((w) => w.text).join(' '), source: window.clarteDebug.prediction().source,
  top: window.clarteDebug.prediction().words.slice(0, 5).map((w) => `${w.word} ${w.p.toFixed(2)}`).join(', '),
}));
const say = (label, v) => console.log(`${label}: Q1 "${v.q1}" · Q4 "${v.q4}" · ${v.source} · [${v.top}]${v.words ? ` · message "${v.words}"` : ''}`);
const settle = () => page.waitForFunction(() => window.clarteDebug.prediction().source === 'engine', null, { timeout: 4000 }).then(() => sleep(350), () => sleep(350));
const fresh = async () => { await page.evaluate(() => { window.clarteDebug.reset(); window.clarteDebug.settings({ textScale: 1, theme: 'light', partner: 'script' }); }); await sleep(300); };
const heard = async (text) => { await page.evaluate((t) => window.clarteDebug.heard(t), text); await settle(); };

// ── Fallback while the engine is absent (a cold start looks the same until the port binds) ──
await page.goto(`${APP}/?onboarding=off&engine=http://127.0.0.1:1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
await fresh();
await heard('Where would you like to go for dinner tonight?');
say('no engine (local fallback)', await q());
await shot('06a-fallback-no-engine');
await type('so');
await sleep(400);
say('no engine, typing "so"', await q());
await shot('06b-fallback-typing');

// ── The real engine ──
await page.goto(`${APP}/?onboarding=off&engine=${encodeURIComponent(ENGINE)}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
await page.waitForFunction(() => !window.clarteDebug.engineDown(), null, { timeout: 15000 });
await fresh();
await settle();
say('first word, empty conversation', await q());
await shot('01-first-word-empty');

for (const [i, line] of ['Where would you like to go for dinner tonight?', 'Are you cold?', 'Do you want tea or coffee?', 'How did you sleep?'].entries()) {
  await fresh();
  await heard(line);
  const v = await q();
  say(`"${line}"`, v);
  await shot(`02${'abcd'[i]}-partner-${line.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`);
  if (i === 0) {
    const chain = [];
    for (let n = 0; n < 5; n++) { chain.push((await q()).q1); await press('1', 150); await settle(); }
    say('five accepts', await q());
    await shot('02e-dinner-five-accepts');
    console.log(`  chain: ${chain.join(' → ')}`);
  }
}

await fresh();
await heard('Where would you like to go for dinner tonight?');
for (let n = 0; n < 2; n++) { await press('1', 150); await settle(); }
await type('some');
await settle();
say('typing "some" (O–S, O–S, G–N, A–F)', await q());
await shot('03a-typing-completion');
await press('1', 150); await settle();
await type('th');
await settle();
say('typing "th"', await q());
await shot('03b-typing-two-groups');

// ── Other words ──
await fresh();
await heard('Where would you like to go for dinner tonight?');
for (let n = 0; n < 5; n++) { await press('1', 150); await settle(); }
say('before Done', await q());
await press('4', 300);
await shot('05a-done-page');
await press('7', 500);
const pageWords = () => page.evaluate(() => [...document.querySelectorAll('.card[data-action^="other-"]')].map((c) => c.innerText.trim()).join(', '));
const chooser = () => page.evaluate(() => { const c = window.clarteDebug.chooser(); return c ? `${c.total} words, ${c.source}` : 'off'; });
console.log(`Other words page 1: ${await pageWords()} (${await chooser()})`);
await shot('05b-other-words-page-1');
await press('4', 400);
console.log(`Other words page 2: ${await pageWords()} (${await chooser()})`);
await shot('05c-other-words-page-2');
await press('1', 300); // Back, then open again on page 1 and pick its second word
await press('4', 300); await press('7', 500);
await press('6', 400);
say('picked the second word of page 1', await q());
await shot('05d-other-words-picked');

// ── Long words ──
await fresh();
await heard('What was the longest word you learned at school?');
await type('antidisestablishmentarianism');
await settle();
say('28 groups typed', await q());
await shot('08a-long-word-typing');
await press('1', 200);
for (const w of ['electroencephalography', 'physiotherapist']) { await type(w); await settle(); await press('1', 200); }
await settle();
say('three long words accepted', await q());
await shot('08b-long-words-message');
await press('4', 300);
await press('7', 500);
console.log(`Other words for physiotherapist: ${await pageWords()} (${await chooser()})`);
await shot('08c-long-words-chooser');
await press('1', 300);
await page.evaluate(() => window.clarteDebug.settings({ textScale: 2 }));
await sleep(500);
await shot('08d-long-words-1440-200pct');
await page.setViewportSize({ width: 1280, height: 720 });
await sleep(500);
await shot('08e-long-words-1280-200pct');
await page.evaluate(() => window.clarteDebug.settings({ textScale: 1 }));
await sleep(500);
await shot('08f-long-words-1280');
await page.setViewportSize({ width: 1440, height: 900 });
await type('antidisestablishmentarianism');
await settle();
await shot('08g-long-word-fourth');

await browser.close();
console.log('done');
