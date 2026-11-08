#!/usr/bin/env node
/**
 * The hostile demo, automated: everything a tester would do to make the conversation screen show
 * an error, "loading", a blank card or no word in Q1, run against the real prediction engine
 * through a small proxy that can refuse, fail, lie or hang on command.
 *
 *   node scripts/hostile.mjs [--app http://localhost:5106] [--engine http://127.0.0.1:8765] [--out evidence/real-engine/hostile] [--only '^(18|19) ']
 *
 * Needs the s6 dev server (`npm run dev`) and a healthy v1 engine. Every case ends with the same
 * checks (`sane`): a word in Q1 (on the talk screen), no error, loading or offline text anywhere,
 * no empty card, no clipped message line, no Backend Quadrant violation, no uncaught page error.
 * Prints one line per case and exits non-zero if any failed. Screenshots go to `--out`.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const APP = (args.app ?? 'http://localhost:5106').replace(/\/$/, '');
const ENGINE = (args.engine ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const OUT = args.out ?? 'evidence/real-engine/hostile';
mkdirSync(OUT, { recursive: true });

// ── The engine, through a proxy that can misbehave ──

/** @type {'ok' | 'refuse' | 'error500' | 'garbage' | 'hang' | 'slow' | 'branch'} */
let mode = 'ok';
/** Extra latency on every /predict, for the timing cases (0, 300, 700 and 3000 ms). */
let delayMs = 0;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'cache-control': 'no-store' };
/** Forward to the engine; one retry, because a kept-alive socket the engine closed fails once. */
async function forward(method, url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const upstream = await fetch(ENGINE + url, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? body : undefined });
      return { status: upstream.status, text: await upstream.text() };
    } catch (error) {
      if (attempt) throw error;
    }
  }
}
const proxy = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
    if (mode === 'refuse') { req.socket.destroy(); return; }
    if (mode === 'error500') { res.writeHead(500, { ...CORS, 'content-type': 'application/json' }).end('{"error":"Prediction failed"}'); return; }
    if (mode === 'garbage') { res.writeHead(200, { ...CORS, 'content-type': 'application/json' }).end('<html>not json at all'); return; }
    if (mode === 'hang') { await new Promise((r) => setTimeout(r, 10000)); }
    // Slower than the 250 ms race, faster than a dwell: the local word stands, the engine's follows.
    if (mode === 'slow') { await new Promise((r) => setTimeout(r, 700)); }
    if (delayMs && req.url.endsWith('/predict')) { await new Promise((r) => setTimeout(r, delayMs)); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { status, text: sent } = await forward(req.method, req.url, Buffer.concat(chunks));
    let text = sent;
    if (mode === 'branch' && req.url.endsWith('/predict')) {
      try { const b = JSON.parse(text); if (b.groups && Array.isArray(b.words) && b.words.length > 1) { b.branch = true; text = JSON.stringify(b); } } catch { /* leave as is */ }
    }
    res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(text);
  } catch (error) {
    // The browser gave up on this request (its own 4 s limit, or a reload): nothing to answer.
    if (error?.code === 'ECONNRESET') return;
    try { res.writeHead(502, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) })); } catch { /* gone */ }
  }
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const PROXY = `http://127.0.0.1:${proxy.address().port}`;

const health = await fetch(`${ENGINE}/api/v1/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) { console.error(`no healthy engine at ${ENGINE}: ${JSON.stringify(health)}`); process.exit(2); }
console.log(`engine ${ENGINE} (${health.model}, ${health.rescorer}) through proxy ${PROXY}`);

/** The engine must be answering promptly, or every shot would show the local decoder: three predictions under 400 ms each. */
async function engineResponsive(origin) {
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const ok = await fetch(`${origin}/api/v1/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: i, history: [['partner', 'Where would you like to go for dinner tonight?']], message: ['i'], groups: '' }), signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
    if (!ok || Date.now() - t0 > 400) return false;
  }
  return true;
}
if (!(await engineResponsive(ENGINE))) { console.error(`the engine at ${ENGINE} is not answering within 400 ms (busy): the engine cases would not mean anything`); proxy.close(); process.exit(2); }

// ── Driving the screen the way a person does: keys 1–8 are the eight quadrants ──

const GROUP_OF = (ch) => ('abcdef'.includes(ch) ? 1 : 'ghijklmn'.includes(ch) ? 2 : 'opqrs'.includes(ch) ? 3 : 'tuvwxyz'.includes(ch) ? 4 : 0);
const keysOf = (word) => [...word.toLowerCase()].map(GROUP_OF).filter(Boolean).map((g) => String(4 + g));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// The browser logs every failed request; those are the point of several cases, not app errors.
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION|Failed to fetch|net::|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = (fn, arg) => page.evaluate(fn, arg);
const press = async (key, delay = 60) => { await page.keyboard.press(key); await sleep(delay); };
const type = async (word, delay = 60) => { for (const k of keysOf(word)) await press(k, delay); };
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);

/** What the screen shows and whether it is sound. */
const look = () => evaluate(() => {
  // A card's live face, not the fading clone of its last one (Swap.tsx keeps that 170 ms).
  const live = (card) => card?.querySelector('.card-swap:not(.card-leaving)') ?? card;
  const text = (sel) => live(document.querySelector(sel))?.innerText.trim() ?? '';
  const cards = [...document.querySelectorAll('.card[data-action]')].map((c) => ({ action: c.dataset.action, text: live(c).innerText.trim(), fits: [...live(c).querySelectorAll('.card-label, .setting-value, .card-hint')].every((e) => e.scrollWidth <= e.clientWidth + 1) }));
  const now = document.querySelector('.now');
  const nowText = now?.querySelector('.now-text');
  const bodyText = document.body.innerText;
  const s = window.clarteDebug.state();
  return {
    phase: window.clarteDebug.phase(),
    screen: s.screen.kind,
    q1: text('.cell-q1 .card'),
    q4: text('.cell-q4 .card'),
    cards,
    words: s.composition.words.map((w) => w.text),
    pending: s.composition.pending.length,
    turns: s.turns.length,
    live: s.live.kind,
    down: window.clarteDebug.engineDown(),
    source: window.clarteDebug.prediction().source,
    violations: window.clarteDebug.validate(),
    badText: (bodyText.match(/\b(error|loading|offline|undefined|NaN|null)\b/gi) ?? []).slice(0, 3),
    nowClipped: Boolean(nowText && now && nowText.scrollWidth > now.clientWidth + 1),
    nowOverflow: Boolean(now?.hasAttribute('data-overflow')),
  };
});

const results = [];
let current = null;
function problem(detail) { current.problems.push(detail); }
async function sane(label = '') {
  const v = await look();
  const where = label ? `${label}: ` : '';
  if (v.screen === 'talk' && v.live !== 'speaking' && (!v.q1 || v.q1 === 'No word')) problem(`${where}Q1 shows "${v.q1}"`);
  if (v.badText.length) problem(`${where}text on screen: ${v.badText.join(', ')}`);
  for (const c of v.cards) {
    if (!c.text) problem(`${where}card ${c.action} is blank`);
    if (!c.fits) problem(`${where}card ${c.action} text is clipped`);
  }
  if (v.violations.length) problem(`${where}quadrant violations ${JSON.stringify(v.violations)}`);
  if (v.nowClipped) problem(`${where}the message line is clipped horizontally`);
  if (pageErrors.length) { problem(`${where}page errors: ${pageErrors.splice(0).join(' | ')}`); }
  return v;
}
const ONLY = args.only ? new RegExp(args.only) : null;
async function run(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  current = { name, problems: [], note: '' };
  mode = 'ok';
  delayMs = 0;
  try { await fn(); } catch (error) { problem(`threw: ${error.message}`); }
  results.push(current);
  console.log(`${current.problems.length ? 'FAIL' : 'ok  '} ${name}${current.note ? `  (${current.note})` : ''}${current.problems.length ? `\n     ${current.problems.join('\n     ')}` : ''}`);
}
const note = (text) => { current.note = text; };

async function fresh() {
  mode = 'ok';
  delayMs = 0;
  await evaluate(() => { window.clarteDebug.reset(); window.clarteDebug.settings({ textScale: 1, theme: 'light', partner: 'script' }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  if (await evaluate(() => window.clarteDebug.engineDown())) await waitFor(() => !window.clarteDebug.engineDown(), null, 8000);
}
const heard = (text) => evaluate((t) => window.clarteDebug.heard(t), text);
const words = async () => (await look()).words;

// ── Open ──

await page.goto(`${APP}/?onboarding=off&engine=${encodeURIComponent(PROXY)}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
const up = await waitFor(() => !window.clarteDebug.engineDown(), null, 15000);
if (!up) { console.error('the app did not find the engine through the proxy'); await browser.close(); proxy.close(); process.exit(2); }
await fresh();

// ── Cases ──

await run('1 rapid keys faster than the engine answers', async () => {
  await fresh();
  await heard('Where would you like to go for dinner tonight?');
  const keys = '5 6 7 8 1 6 7 1 8 5 1 7 7 8 1 5 6 1 8 8 7 1 6 5 1'.split(' ');
  for (const k of keys) await press(k, 15);
  await sleep(700);
  const v = await sane();
  if (v.words.length < 5) problem(`only ${v.words.length} words after 7 accepts`);
  note(`${v.words.length} words, pending ${v.pending}: "${v.words.join(' ')}"`);
});

await run('2 accepting the word the instant it changes', async () => {
  await fresh();
  await heard('Did you sleep at all?');
  // What Q1 said at the keydown is read in the capture phase, before the app sees the key.
  // (The label that is live, not the fading clone of the previous one, which precedes it in the DOM.)
  await evaluate(() => { window.__seen = []; window.addEventListener('keydown', (e) => { if (e.key === '1') window.__seen.push(document.querySelector('.cell-q1 .card-swap:not(.card-leaving) .card-label')?.textContent ?? ''); }, true); });
  const groups = ['6', '7', '5', '8', '6', '6', '7', '5', '8', '7'];
  for (const g of groups) { await page.keyboard.press(g); await page.keyboard.press('1'); await sleep(40); }
  await sleep(500);
  const seen = await evaluate(() => window.__seen);
  const v = await sane();
  const mismatches = v.words.map((w, i) => [w, seen[i]]).filter(([w, s]) => s && w.toLowerCase() !== s.toLowerCase());
  if (mismatches.length) problem(`accepted ≠ shown: ${JSON.stringify(mismatches)}`);
  if (v.words.length !== groups.length) problem(`${v.words.length} words for ${groups.length} accepts`);
  note(`${v.words.length} accepts, each the word that was on the card`);
});

await run('3 thirty groups that match nothing, then Delete past empty', async () => {
  await fresh();
  for (let i = 0; i < 30; i++) {
    await press(i % 2 ? '8' : '7', 20);
    if (i % 6 === 5) await sane(`after ${i + 1} groups`);
  }
  await sleep(400);
  let v = await sane('after 30 groups');
  note(`Q1 after 30 junk groups: "${v.q1}" (${v.source})`);
  await shot('03-thirty-junk-groups');
  for (let i = 0; i < 30; i++) await press('4', 20);
  await sleep(300);
  v = await sane('after 30 deletes');
  if (v.pending !== 0 || v.words.length !== 0) problem(`not empty after 30 deletes: ${v.words.length} words, ${v.pending} pending`);
  if (v.q4 !== 'Menu') problem(`Q4 on an empty message is "${v.q4}", not Menu`);
  await press('4', 300);
  v = await sane('one more Q4 on empty');
  if (v.screen !== 'menu') problem(`a further Q4 opened "${v.screen}", not the menu`);
  await press('1', 300);
  v = await sane('Back');
  if (v.screen !== 'talk') problem(`Back went to ${v.screen}`);
});

await run('4 very long words in Q1, Q4, the message and the chooser', async () => {
  await fresh();
  await type('antidisestablishmentarianism', 15);
  await sleep(500);
  let v = await sane('28 groups');
  note(`Q1 for antidisestablishmentarianism: "${v.q1}" (${v.source})`);
  await shot('04a-long-word-typing');
  await press('1', 200);
  const got = [];
  for (const w of ['uncomfortable', 'responsibilities', 'congratulations']) {
    await type(w, 15);
    await sleep(350);
    const t = await sane(`typing ${w}`);
    got.push(`${w} → "${t.q1}"`);
    await press('1', 150);
  }
  note(`${current.note}; ${got.join(', ')}`);
  v = await sane('long message');
  await shot('04b-long-words-message');
  await press('4', 300); // Done
  await sane('Done');
  await shot('04c-long-words-done');
  await press('7', 400); // Other words
  v = await sane('Other words');
  if (v.screen !== 'other') problem(`Other words opened ${v.screen}`);
  await shot('04d-long-words-chooser');
  await press('1', 300);
  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const scale of [2, 1]) {
      await evaluate((s) => window.clarteDebug.settings({ textScale: s }), scale);
      await sleep(400);
      v = await sane(`${w}x${h} at ${scale * 100}%`);
      if (v.nowOverflow) note(`${current.note}; message past its type floor at ${w}x${h} ${scale * 100}% (latest words kept)`);
      await shot(`04e-long-words-${w}x${h}-${scale * 100}pct`);
    }
  }
});

await run('5 a forty-word message, then Speak and Stop', async () => {
  await fresh();
  await heard('Tell me everything about your day');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('1');
    const ok = await waitFor((n) => window.clarteDebug.state().composition.words.length >= n, i + 1, 3000);
    if (!ok) { problem(`accept ${i + 1} did not land`); break; }
  }
  await sleep(400);
  let v = await sane('40 words');
  note(`${v.words.length} words${v.nowOverflow ? ', message past its type floor (latest words kept)' : ''}`);
  await shot('05a-forty-words');
  await press('4', 500); // Done
  await sane('Done');
  await shot('05b-forty-words-done');
  await press('4', 300); // Speak (a key on a different action in the same quadrant needs the 400 ms pause)
  v = await sane('speaking');
  if (v.live !== 'speaking') problem(`Speak did not start speaking (live ${v.live})`);
  await shot('05c-forty-words-speaking');
  await press('1', 300); // Stop
  v = await sane('stopped');
  if (v.live === 'speaking') problem('Stop did not stop');
  if (v.words.length !== 40) problem(`the draft did not come back after Stop (${v.words.length} words)`);
});

await run('6 a partner transcript of 300 words', async () => {
  await fresh();
  const long = Array.from({ length: 300 }, (_, i) => ['so', 'the', 'physiotherapist', 'called', 'again', 'this', 'morning', 'and', 'said', 'your', 'appointment', 'moved', 'to', 'thursday', 'afternoon', 'and', 'your', 'grandmother', 'wants', 'to', 'come', 'with', 'us', 'is', 'that', 'alright', 'with', 'you'][i % 28]).join(' ');
  await heard(long);
  await sleep(500);
  let v = await sane('transcript');
  note(`Q1 after 300 partner words: "${v.q1}" (${v.source})`);
  await shot('06-transcript-300-words');
  await type('ye', 60);
  await sleep(500);
  v = await sane('typing after it');
  await press('1', 200);
  await sane('accepted');
});

await run('7 the engine killed and restarted mid-word', async () => {
  await fresh();
  await heard('Do you want tea or coffee?');
  await type('te', 80);
  mode = 'refuse';
  await type('a', 80);
  await sleep(300);
  let v = await sane('engine gone, typing');
  await press('1', 200);
  await type('pl', 80);
  // Two failed requests lose the engine (one may have been a cached prefetch): by now there have been several.
  const down = await waitFor(() => window.clarteDebug.engineDown(), null, 6000);
  if (!down) problem('the engine was not noticed as gone');
  v = await sane('typing while gone');
  if (v.source !== 'local') problem(`source while gone is ${v.source}`);
  await shot('07a-engine-gone');
  mode = 'ok';
  const back = await waitFor(() => !window.clarteDebug.engineDown(), null, 8000);
  if (!back) problem('the engine did not come back within 8 s of answering again');
  await type('e', 80);
  const engineAgain = await waitFor(() => window.clarteDebug.prediction().source === 'engine', null, 3000);
  if (!engineAgain) problem('after the restart the word is still the local decoder\'s');
  v = await sane('engine back');
  await shot('07b-engine-back');
  note(`gone after ${down ? '≤6 s' : 'never'}, back after ${back ? '≤8 s' : 'never'}`);
});

await run('8 the engine returns 500, garbage JSON, or hangs for 10 s', async () => {
  await fresh();
  await heard('How are you feeling this morning?');
  for (const bad of ['error500', 'garbage', 'hang']) {
    mode = bad;
    const t0 = Date.now();
    await press('7', 0);
    await sleep(350);
    const v = await sane(`while ${bad}`);
    if (!v.q1) problem(`no word within ${Date.now() - t0} ms while ${bad}`);
    await press('4', 200); // Delete the group
    mode = 'ok';
    await sleep(2600); // the probe period, so a lost engine is found again before the next case
  }
  await evaluate(() => window.clarteDebug.setEngine(null));
  const back = await waitFor(() => !window.clarteDebug.engineDown(), null, 8000);
  if (!back) problem('the engine was not found again after the bad answers');
  await type('o', 80);
  await sleep(400);
  await sane('after');
});

await run('9 reload mid-message', async () => {
  await fresh();
  await type('ye', 60);
  await press('1', 100);
  await type('pl', 60);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
  await sleep(400);
  await waitFor(() => !window.clarteDebug.engineDown(), null, 8000);
  const v = await sane('after reload');
  note(`after reload: screen ${v.screen}, Q1 "${v.q1}", ${v.words.length} words (a reload starts a new message)`);
  await evaluate(() => window.clarteDebug.settings({ partner: 'script' }));
});

await run('10 theme and text size changed mid-word', async () => {
  await fresh();
  await heard('Are you cold?');
  await type('a', 60);
  await press('1', 100);
  await type('litt', 60);
  for (const patch of [{ theme: 'dark' }, { textScale: 2 }, { textScale: 1.5, theme: 'light' }, { textScale: 1 }]) {
    await evaluate((p) => window.clarteDebug.settings(p), patch);
    await sleep(350);
    await sane(JSON.stringify(patch));
    if (patch.theme === 'dark' && patch.textScale === undefined) await shot('10a-dark-mid-word');
    if (patch.textScale === 2) await shot('10b-200pct-mid-word');
  }
  await press('1', 100);
  await sane('accepted after');
});

await run('11 Done, Back, Done repeatedly', async () => {
  await fresh();
  await heard('Shall we go out?');
  await press('1', 150); await press('1', 150);
  for (let i = 0; i < 10; i++) { await press('4', 25); await press('1', 25); }
  await sleep(300);
  let v = await sane('after 20 alternations');
  if (v.screen !== 'talk') problem(`ended on ${v.screen}`);
  await press('4', 300);
  v = await sane('Done once more');
  if (v.screen !== 'done') problem(`Done opened ${v.screen}`);
  if (v.q4 !== 'Speak') problem(`Q4 on the Done page is "${v.q4}"`);
  await press('1', 300);
});

await run('12 Delete word until the message is empty, and beyond', async () => {
  await fresh();
  await heard('What would you like?');
  for (let i = 0; i < 3; i++) await press('1', 150);
  let v = await look();
  if (v.words.length !== 3) problem(`${v.words.length} words to start`);
  for (let i = 0; i < 3; i++) {
    await press('4', 150); // Done
    await press('5', 150); // Delete word → reopened
    v = await sane(`reopened ${i + 1}`);
    if (!v.q4.startsWith('Delete')) problem(`after Delete word Q4 is "${v.q4}"`);
    await press('4', 150); // Delete again → removed
  }
  v = await sane('empty');
  if (v.words.length || v.pending) problem(`not empty: ${v.words.length} words, ${v.pending} pending`);
  if (v.q4 !== 'Menu') problem(`Q4 on empty is "${v.q4}"`);
  await press('4', 300); // Menu
  await press('1', 300); // Back
  v = await sane('back on talk');
  if (v.screen !== 'talk') problem(`ended on ${v.screen}`);
});

await run('13 speaking an empty message', async () => {
  await fresh();
  const before = await look();
  await evaluate(() => window.clarteDebug.speak(''));
  await sleep(400);
  const v = await sane();
  if (v.live !== 'quiet') problem(`live is ${v.live}`);
  if (v.turns !== before.turns) problem('an empty turn was added');
  note('nothing happens');
});

await run('14 Other words: pages, More past the end, picking', async () => {
  await fresh();
  await heard('Where would you like to go for dinner tonight?');
  for (let i = 0; i < 5; i++) await press('1', 150);
  const start = await look();
  await press('4', 300); // Done
  await press('7', 400); // Other words
  let v = await sane('page 1');
  if (v.screen !== 'other') problem(`opened ${v.screen}`);
  const chooser = await evaluate(() => window.clarteDebug.chooser());
  const pages = Math.max(1, Math.ceil(chooser.total / 4));
  const page1 = v.cards.filter((c) => c.action.startsWith('other-')).map((c) => c.text);
  if (!page1.length) problem('no words on page 1');
  await shot('14a-other-words-page-1');
  if (pages > 1) {
    await press('4', 400); // More
    v = await sane('page 2');
    const page2 = v.cards.filter((c) => c.action.startsWith('other-')).map((c) => c.text);
    if (page2.join() === page1.join()) problem('More showed the same page');
    await shot('14b-other-words-page-2');
    if (pages <= 12) {
      for (let i = 1; i < pages; i++) await press('4', 200);
      v = await sane('wrapped');
      const at = await evaluate(() => window.clarteDebug.state().screen.page);
      const again = v.cards.filter((c) => c.action.startsWith('other-')).map((c) => c.text);
      if (at !== 0 || !again.length) problem(`More past the last page did not start again (page ${at + 1}: ${again.join(' ')})`);
    }
  }
  await press('6', 300); // the second word of the page
  v = await sane('picked');
  if (v.screen !== 'talk') problem(`picking left the screen on ${v.screen}`);
  if (v.words.length !== start.words.length) problem(`word count changed from ${start.words.length} to ${v.words.length}`);
  if (v.words.slice(0, -1).join(' ') !== start.words.slice(0, -1).join(' ')) problem('earlier words changed');
  note(`last word "${start.words.at(-1)}" → "${v.words.at(-1)}", ${chooser.total} words over ${pages} pages (${chooser.source})`);
  await shot('14c-other-words-picked');
});

await run('15 the engine says branch: the second word in Q4', async () => {
  await fresh();
  mode = 'branch';
  await heard('Did you sleep at all?');
  await press('1', 150);
  await type('mi', 120);
  // The engine's answer may queue behind the prefetches; the branch shows once it has arrived.
  const answered = await waitFor(() => window.clarteDebug.prediction().source === 'engine' && 'branch' in window.clarteDebug.prediction(), null, 4000);
  await sleep(300);
  let v = await sane('two groups');
  if (!answered) problem('no engine answer with a branch flag within 4 s');
  if (v.phase !== 'composing-branch') problem(`phase ${v.phase}, Q4 "${v.q4}"`);
  await shot('15a-branch-from-engine-flag');
  await press('4', 300); // the second word
  v = await sane('second word accepted');
  note(`Q1 "${v.words.at(-2) ?? ''}" / Q4 accepted "${v.words.at(-1)}"`);
  mode = 'ok';
});

await run('16 a late engine answer while gaze rests on Q1', async () => {
  await fresh();
  await heard('Where would you like to go for dinner tonight?');
  await sleep(600);
  mode = 'slow';
  // A new request (the first word of a new message), then gaze lands on Q1 before the engine answers.
  await type('s', 0);
  await sleep(60);
  await page.mouse.move(180, 200);
  await sleep(150);
  const first = (await look()).q1;
  const seen = new Set([first]);
  // Through the engine's late answer (700 ms) and past the dwell (900 ms) the label must not move.
  for (let t = 0; t < 1600; t += 100) { await sleep(100); seen.add((await look()).q1); }
  if (seen.size !== 1) problem(`Q1 changed under a resting gaze: ${[...seen].join(' → ')}`);
  const src = await evaluate(() => window.clarteDebug.prediction().source);
  await page.mouse.move(700, 450); // off the card: now it may change
  await sleep(400);
  const after = (await look()).q1;
  mode = 'ok';
  note(`held "${first}" for 1.7 s while the engine answered late (${src}); after gaze left: "${after}"`);
  await sane();
});


// ── Round 4: the hostile demo review's findings, one case each ──

/** The card's centre, for a look at it. */
const centreOf = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const restPoint = () => { const vp = page.viewportSize(); return { x: vp.width * 0.375, y: vp.height * 0.3 }; };
const rest = async () => { const p = restPoint(); await page.mouse.move(p.x, p.y); };
const lookAt = async (sel) => { const c = await centreOf(sel); await page.mouse.move(c.x, c.y); };
const labelOf = (sel) => evaluate((s) => document.querySelector(`${s} .card-swap:not(.card-leaving) .card-label`)?.textContent?.trim() ?? '', sel);
const settle = () => waitFor(() => window.clarteDebug.prediction().source === 'engine', null, 3000).then(() => sleep(200));

await run('17 the word just accepted is never the next word (the repeat guard)', async () => {
  await fresh(); await rest();
  await heard('Hello');
  await settle();
  const chain = [];
  for (let i = 0; i < 5; i++) { chain.push(await labelOf('.cell-q1')); await press('1', 150); await settle(); }
  let v = await sane('five accepts');
  const adjacent = v.words.some((w, i) => i > 0 && w === v.words[i - 1]);
  if (adjacent) problem(`a word repeated itself: ${v.words.join(' ')}`);
  // The engine answering its own word back: the screen takes the next distinct one.
  await fresh(); await rest(); await heard('Hello'); await settle(); await press('1', 150); await settle();
  const s = await evaluate(() => window.clarteDebug.state());
  const last = s.composition.words.at(-1).text;
  await evaluate(({ h, m, last }) => window.clarteDebug.seed({ history: h, message: m, groups: '', offset: 0 }, { words: [{ word: last, p: 0.5, complete: true }, { word: 'how', p: 0.3, complete: true }], total: 2, longer: 0, offset: 0, source: 'engine' }), { h: s.turns.map((t) => [t.who === 'partner' ? 'partner' : 'user', t.text]), m: s.composition.words.map((w) => w.text), last });
  await evaluate(() => window.clarteDebug.settings({ textScale: 1 })); // a render
  await sleep(200);
  const q1 = await labelOf('.cell-q1');
  if (q1.toLowerCase() === last) problem(`Q1 offers "${q1}" again right after it was accepted`);
  note(`chain ${chain.join(' → ')} → "${v.words.join(' ')}"; engine echo "${last}" shown as "${q1}"`);
});

await run('18 a dwell on Q1 accepts the word it showed, at 0, 300, 700 and 3000 ms engine latency', async () => {
  const lines = ['Did you sleep at all?', 'Are you cold?', 'Do you want tea or coffee?', 'Is the pain bad?'];
  const report = [];
  for (const [ms, react] of [[0, 60], [0, 250], [300, 250], [700, 250], [3000, 60]]) {
    let dead = 0, moved = 0, wrong = 0;
    for (const line of lines) {
      await fresh(); await rest(); delayMs = ms;
      await heard(`${line} ${Math.random().toString(36).slice(2, 6)}`); // unique, so nothing is cached
      await sleep(react);
      await lookAt('.cell-q1 .card');
      await sleep(120);
      const shown = await labelOf('.cell-q1');
      await sleep(1500); // through the 900 ms dwell and past a late answer
      const v = await look();
      const after = await labelOf('.cell-q1');
      if (v.words.length !== 1) dead += 1;
      else if (v.words[0].toLowerCase() !== shown.toLowerCase()) wrong += 1;
      if (after !== shown) moved += 1;
      await rest(); await sleep(250);
    }
    report.push(`${ms} ms/${react} ms: dead ${dead}, wrong ${wrong}, moved ${moved}`);
    if (dead || wrong || moved) problem(`engine +${ms} ms, look ${react} ms after the turn: ${dead} dead dwell(s), ${wrong} wrong word(s), ${moved} label(s) changed under the resting gaze, of ${lines.length}`);
  }
  delayMs = 0;
  note(report.join('; '));
  await sane();
});

await run('19 a late branch answer never hides Delete under a resting gaze; lines follow the labels', async () => {
  await fresh(); await rest();
  await heard('Did you sleep at all?'); await settle();
  await press('1', 150); await settle();
  await type('m', 150); await settle();
  await lookAt('.cell-q4 .card'); // resting on Delete
  await sleep(300);
  mode = 'branch'; delayMs = 500;
  await press('6', 0); // the second group: the local answer stands, the engine's late answer says branch
  const pendingBefore = (await look()).pending;
  const seen = new Set();
  let lines = 0;
  for (let t = 0; t < 500; t += 100) { await sleep(100); seen.add(await labelOf('.cell-q4')); lines = Math.max(lines, await evaluate(() => document.querySelectorAll('.branch').length)); }
  if (seen.size !== 1 || !seen.has('Delete')) problem(`Q4 changed under the resting gaze: ${[...seen].join(' → ')}`);
  if (lines) problem('branch lines were drawn while Q4 still read Delete');
  await sleep(900); // the dwell (900 ms from the look) completes on Delete, after the late answer arrived
  let v = await look();
  if (v.pending !== pendingBefore - 1) problem(`the dwell on "Delete" did not delete a group (pending ${pendingBefore} → ${v.pending})`);
  note(`Q4 held "${[...seen].join('')}" through the late branch answer and deleted a group`);
  mode = 'ok'; delayMs = 0;
  await rest(); await sleep(300);
  await sane();
});

await run('20 the local fallback: the partner\'s words count, chains differ, nothing loops', async () => {
  await fresh(); await rest();
  mode = 'refuse';
  await evaluate(() => window.clarteDebug.setEngine(null));
  const chains = {};
  for (const line of ['Where would you like to go for dinner tonight?', 'Do you want tea or coffee?', 'Are you cold?']) {
    await evaluate(() => window.clarteDebug.reset()); await heard(line); await sleep(150);
    const chain = [];
    for (let i = 0; i < 6; i++) { chain.push((await labelOf('.cell-q1')).toLowerCase()); await press('1', 120); }
    chains[line] = chain;
    if (chain.some((w, i) => i > 0 && w === chain[i - 1])) problem(`"${line}": a word repeats itself: ${chain.join(' ')}`);
    if (chain.some((_, i) => i + 3 < chain.length && chain[i] === chain[i + 2] && chain[i + 1] === chain[i + 3])) problem(`"${line}": an ABAB loop: ${chain.join(' ')}`);
  }
  if (new Set(Object.values(chains).map((c) => c.join(' '))).size < 2) problem(`every line gives the same chain: ${Object.values(chains)[0].join(' ')}`);
  const typedTo = async (line, word) => { await evaluate(() => window.clarteDebug.reset()); await heard(line); const seq = []; for (const k of keysOf(word)) { await press(k, 100); seq.push((await labelOf('.cell-q1')).toLowerCase()); } return seq; };
  const tea = await typedTo('Do you want tea or coffee?', 'tea');
  if (!tea.slice(1).includes('tea')) problem(`typing "tea" after the tea question never offers tea: ${tea.join(' → ')}`);
  const cold = await typedTo('Are you cold?', 'cold');
  if (!cold.slice(1).includes('cold')) problem(`typing "cold" after "Are you cold?" never offers cold: ${cold.join(' → ')}`);
  const v = await sane('fallback');
  if (v.source !== 'local') problem(`source is ${v.source}, not local`);
  note(`${Object.entries(chains).map(([l, c]) => `"${l.split(' ').slice(-2).join(' ')}" → ${c.join(' ')}`).join('; ')}; tea ${tea.join('→')}; cold ${cold.join('→')}`);
  mode = 'ok';
  await waitFor(() => !window.clarteDebug.engineDown(), null, 8000);
});

await run('21 Recalibrate returns to where it was opened, with the message; Back and Escape leave', async () => {
  await fresh(); await rest();
  await heard('Shall we go out?'); await settle(); await press('1', 150); await settle(); await press('1', 150);
  const before = await words();
  // From the Done page, out by Back (Q1) during the position step.
  await press('4', 300); await press('8', 400);
  let v = await look();
  if (v.screen !== 'calibration') problem(`Recalibrate opened ${v.screen}`);
  const actions = await evaluate(() => [...document.querySelectorAll('[data-action]')].map((e) => e.dataset.action));
  if (!actions.includes('back')) problem(`no gaze-reachable exit during calibration (actions ${actions.join(', ')})`);
  await shot('21a-calibration-back');
  await press('1', 400);
  v = await look();
  if (v.screen !== 'done') problem(`Back from calibration landed on ${v.screen}, not the Done page`);
  if (v.words.join(' ') !== before.join(' ')) problem(`the message changed: ${before} → ${v.words}`);
  // The points step: Back stands down while the dot is at the Q1 corner, then comes back; Escape leaves.
  await press('8', 400);
  await page.waitForFunction(() => window.clarteDebug.state().screen.step === 'points', null, { timeout: 5000 });
  await sleep(1200 + 700 + 300); // travel to the first point (top left) and settle on it
  const busy = await evaluate(() => document.querySelector('.cell-exit .card')?.getAttribute('aria-disabled'));
  if (busy !== 'true') problem('Back stayed live while the calibration target in Q1 was active');
  await sleep(1800 + 400 + 1200 + 300); // the next point (top centre) is active
  const live = await evaluate(() => document.querySelector('.cell-exit .card')?.getAttribute('aria-disabled'));
  if (live === 'true') problem('Back did not come back once the dot left Q1');
  await shot('21b-calibration-points-back');
  await press('Escape', 400);
  v = await look();
  if (v.screen !== 'done' || v.words.join(' ') !== before.join(' ')) problem(`Escape landed on ${v.screen} with "${v.words.join(' ')}"`);
  if ((await evaluate(() => window.clarteDebug.state().calibratedAt)) !== null) problem('leaving early marked calibration done');
  // From the Menu, Back returns to the conversation.
  await press('1', 300); // Back to talk
  await evaluate(() => window.clarteDebug.reset()); await sleep(200);
  await press('4', 300); await press('6', 400);
  v = await look();
  if (v.screen !== 'calibration') problem(`Menu → Recalibrate opened ${v.screen}`);
  await press('1', 400);
  v = await look();
  if (v.screen !== 'talk') problem(`Back from calibration (from the menu) landed on ${v.screen}`);
  note('Done → Recalibrate → Back lands on Done with the message; Escape too; Menu → Recalibrate → Back lands on the conversation');
});

await run('22 Recalibrate ridden to the end lands back on the message (44 s)', async () => {
  await fresh(); await rest();
  await heard('Shall we go out?'); await settle(); await press('1', 150); await settle();
  const before = await words();
  await press('4', 300); await press('8', 400);
  const ready = await page.waitForFunction(() => window.clarteDebug.state().screen.kind !== 'calibration' || window.clarteDebug.state().screen.step === 'ready', null, { timeout: 90000 }).then(() => true, () => false);
  if (!ready) problem('calibration did not reach Ready within 90 s');
  await shot('22-calibration-ready');
  await press('1', 500); // Start
  const v = await look();
  if (v.screen !== 'done') problem(`Start landed on ${v.screen}, not the Done page`);
  if (v.words.join(' ') !== before.join(' ')) problem(`message lost: ${before} → ${v.words}`);
  if ((await evaluate(() => window.clarteDebug.state().calibratedAt)) === null) problem('Start did not mark calibration done');
  await press('1', 300);
  note(`back on ${v.screen} with "${v.words.join(' ')}"`);
});

await run('23 Q1 while the partner speaks: at most two relabels per turn, never engine → local', async () => {
  await fresh(); await rest(); await settle();
  await evaluate(() => window.clarteDebug.partner('So the physiotherapist called again this morning and said your appointment moved from Tuesday to Thursday afternoon and your grandmother wants to come with us'));
  const seen = await evaluate(async () => {
    const out = []; let last = null; const t0 = performance.now();
    while (performance.now() - t0 < 9500) {
      const t = document.querySelector('.cell-q1 .card-swap:not(.card-leaving) .card-label')?.textContent ?? '';
      const src = window.clarteDebug.prediction().source;
      if (t !== last) { out.push(`${Math.round(performance.now() - t0)}:${t}:${src[0]}`); last = t; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  const changes = seen.length - 1;
  if (changes > 2) problem(`Q1 relabelled ${changes} times during one partner turn: ${seen.join(' ')}`);
  note(`${changes} relabel(s): ${seen.join(' ')}`);
  await sane();
});

await run('24 display case: names from the engine on the card, in the message and in speech', async () => {
  await fresh(); await rest();
  await heard('Your sister Priya is coming at four with Marcus.'); await settle();
  const s = await evaluate(() => window.clarteDebug.state());
  const history = s.turns.map((t) => [t.who === 'partner' ? 'partner' : 'user', t.text]);
  await type('is', 100); await settle(); await press('1', 150); await settle();
  const first = (await words())[0];
  const expected = `${first.charAt(0).toUpperCase()}${first.slice(1)} Priya`;
  // The engine's answer for "pr" after the first word: Priya, written as the partner wrote it.
  await evaluate(({ history, first }) => window.clarteDebug.seed({ history, message: [first], groups: '33', offset: 0 }, { words: [{ word: 'priya', p: 0.8, complete: false, display: 'Priya' }, { word: 'so', p: 0.01, complete: true }], total: 2, longer: 0.8, offset: 0, source: 'engine' }), { history, first });
  await type('pr', 100); await sleep(250);
  let v = await sane('typing pr');
  if (v.q1 !== 'Priya') problem(`Q1 shows "${v.q1}", not "Priya"`);
  const glyphs = await evaluate(() => [...document.querySelectorAll('.now .glyph.typed > span')].map((e) => e.textContent).join(''));
  if (!glyphs.startsWith('Pr')) problem(`the word in progress reads "${glyphs}", not "Pr…"`);
  await press('1', 150); await settle();
  const now = await evaluate(() => document.querySelector('.now .now-text')?.innerText.trim());
  if (now !== expected) problem(`the message reads "${now}", not "${expected}"`);
  await shot('24-display-name');
  await press('4', 600); await press('4', 300); // Done, then Speak (a key on a different action in the same quadrant needs the 400 ms pause)
  v = await look();
  const spoken = await evaluate(() => { const l = window.clarteDebug.state().live; return l.kind === 'speaking' ? l.text : ''; });
  if (spoken !== expected) problem(`spoken as "${spoken}", not "${expected}"`);
  await press('1', 300);
  // Without display the old rule holds: "i" is "I".
  await evaluate(() => window.clarteDebug.reset()); await heard('Who is coming?'); await settle(); await type('i', 100); await sleep(250);
  if ((await labelOf('.cell-q1')) !== 'I') problem(`"i" typed shows "${await labelOf('.cell-q1')}"`);
  note(`Q1 "Priya", message "${now}", spoken "${spoken}"`);
});

await run('25 three quick activations on Q4 never speak: clicks and keys', async () => {
  await fresh(); await rest();
  await heard('Are you cold?'); await settle(); await press('1', 150); await settle(); await type('a', 100);
  const c = await centreOf('.cell-q4 .card');
  const seq = [];
  for (let i = 0; i < 3; i++) { await page.mouse.click(c.x, c.y); await sleep(120); const v = await look(); seq.push(`${v.screen}/${v.live}`); }
  let v = await look();
  if (v.live === 'speaking') problem(`three fast clicks on Q4 spoke (${seq.join(' → ')})`);
  if (v.screen !== 'done') problem(`after three clicks the screen is ${v.screen}`);
  // The pointer leaves the quadrant and returns: now Speak is a deliberate second look.
  await rest(); await sleep(400); await page.mouse.click(c.x, c.y); await sleep(200);
  v = await look();
  if (v.live !== 'speaking') problem('a click on Speak after leaving and returning did not speak');
  await press('1', 300);
  // Keys: Delete → Done → Speak at 120 ms; the third waits.
  await evaluate(() => window.clarteDebug.reset()); await rest(); await heard('Are you cold?'); await settle(); await press('1', 150); await settle(); await type('a', 100);
  for (let i = 0; i < 3; i++) await press('4', 120);
  v = await look();
  if (v.live === 'speaking') problem('three fast key presses on Q4 spoke');
  await sleep(500); await press('4', 200);
  v = await look();
  if (v.live !== 'speaking') problem('a key press on Speak after the pause did not speak');
  await press('1', 300);
  note(`clicks: ${seq.join(' → ')} then spoke only after leaving Q4; keys: the third press waited 400 ms`);
});

await run('26 at 200% text and 1280x720 the partner\'s question stays whole, two lines', async () => {
  await fresh(); await page.setViewportSize({ width: 1280, height: 720 }); await rest();
  await evaluate(() => window.clarteDebug.settings({ textScale: 2 })); await sleep(300);
  await heard('Where would you like to go for dinner tonight?'); await settle();
  for (let i = 0; i < 5; i++) { await press('1', 150); await settle(); }
  const r = await evaluate(() => {
    const t = document.querySelector('.history .turn:last-child .turn-text');
    const rect = t.getBoundingClientRect(); const line = parseFloat(getComputedStyle(t).lineHeight);
    const now = document.querySelector('.now')?.getBoundingClientRect();
    return { text: t.innerText, lines: Math.round(rect.height / line), overflow: t.scrollHeight > t.clientHeight + 1, nowBottom: now?.bottom, half: innerHeight / 2 };
  });
  if (r.overflow) problem(`the partner's turn is cut: "${r.text}"`);
  if (r.lines < 2) problem(`the partner's turn has ${r.lines} line(s)`);
  if (r.nowBottom > r.half - 40 + 1) problem(`the live line reaches ${r.nowBottom}px, inside the 40 px margin before the row at ${r.half}`);
  await shot('26-200pct-1280-question');
  const v = await sane('200% 1280');
  note(`"${r.text}" on ${r.lines} lines; live line ends ${Math.round(r.nowBottom)}px of ${r.half}`);
  await evaluate(() => window.clarteDebug.settings({ textScale: 1 })); await page.setViewportSize({ width: 1440, height: 900 });
  void v;
});

/** Visible text nodes under 20 px, and elements crossing the row boundary, for the type and zoom cases. */
const audit = () => evaluate(() => {
  const visible = (el) => { let p = el; while (p) { const c = getComputedStyle(p); if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) === 0) return false; if (p.classList?.contains('thread-behind') || p.classList?.contains('rest-leaving') || p.classList?.contains('card-leaving') || p.classList?.contains('now-leaving')) return false; p = p.parentElement; } return true; };
  const small = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const n = walker.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (el.closest('.sr-only') || !visible(el)) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 20) small.push(`${fs.toFixed(1)}px "${t.slice(0, 20)}"`); }
  const clipped = [...document.querySelectorAll('.card:not(.card-gone) :is(.card-label, .setting-value, .setting-name, .card-hint)')].filter((e) => visible(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20));
  const thread = document.querySelector('.thread')?.getBoundingClientRect();
  const cards = [...document.querySelectorAll('.card:not(.card-gone)')].map((c) => c.getBoundingClientRect());
  return { small: [...new Set(small)], clipped, threadBottom: thread?.bottom, half: innerHeight / 2, minCard: Math.min(...cards.map((c) => Math.min(c.width, c.height))), violations: window.clarteDebug.validate() };
});

await run('27 type floor: a 22-letter word is never below 20 px on Q1, in the message or in the chooser', async () => {
  for (const [w, h] of [[1440, 900], [1280, 720]]) {
    await fresh(); await page.setViewportSize({ width: w, height: h }); await rest();
    await heard('What was the longest word you learned at school?'); await settle();
    await type('electroencephalography', 15); await sleep(400);
    let a = await audit();
    const q1Size = await evaluate(() => parseFloat(getComputedStyle(document.querySelector('.cell-q1 .card-swap:not(.card-leaving) .card-label')).fontSize));
    if (q1Size < 20) problem(`${w}x${h}: Q1 label at ${q1Size.toFixed(1)}px`);
    if (a.small.length) problem(`${w}x${h} typing: ${a.small.join(', ')}`);
    if (a.clipped.length) problem(`${w}x${h} typing: clipped ${a.clipped.join(', ')}`);
    await press('1', 150);
    for (const word of ['uncomfortable', 'physiotherapist']) { await type(word, 15); await sleep(300); await press('1', 150); }
    await press('4', 400); await press('7', 500); // Other words for physiotherapist
    a = await audit();
    if (a.small.length) problem(`${w}x${h} chooser: ${a.small.join(', ')}`);
    if (a.clipped.length) problem(`${w}x${h} chooser: clipped ${a.clipped.join(', ')}`);
    await shot(`27-type-floor-chooser-${w}`);
    await press('1', 300);
    // Three long words at 200%: whole lines only, nothing half-erased.
    await evaluate(() => window.clarteDebug.settings({ textScale: 2 })); await sleep(400);
    const lines = await evaluate(() => {
      const now = document.querySelector('.now'); const rect = now.getBoundingClientRect();
      // The room is clipped at its top to whole lines (Thread.tsx `--now-clip`): the visible region starts below the clip.
      const box = { top: rect.top + (parseFloat(now.style.getPropertyValue('--now-clip')) || 0), bottom: rect.bottom };
      const words = [...now.querySelectorAll('.now-text .word')];
      return words.map((el) => { const r = el.getBoundingClientRect(); return { text: el.textContent, top: r.top, bottom: r.bottom, visible: r.bottom > box.top + 6 && r.top < box.bottom - 6, whole: r.top >= box.top - 6 && r.bottom <= box.bottom + 6 }; });
    });
    const half = lines.filter((l) => l.visible && !l.whole);
    if (half.length) problem(`${w}x${h} at 200%: half-erased word(s) ${half.map((l) => l.text).join(', ')}`);
    await shot(`27-long-words-200pct-${w}`);
    await evaluate(() => window.clarteDebug.settings({ textScale: 1 }));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await sane();
});

await run('28 browser zoom 200% at 1280x720 (640x360 CSS px): the type floor and the rows hold', async () => {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  const p2 = await ctx.newPage();
  try {
    await p2.goto(`${APP}/?onboarding=off&engine=${encodeURIComponent(PROXY)}`, { waitUntil: 'load' });
    await p2.waitForFunction(() => Boolean(window.clarteDebug?.state));
    await p2.waitForFunction(() => !window.clarteDebug.engineDown(), null, { timeout: 10000 }).catch(() => {});
    await p2.evaluate(() => { window.clarteDebug.reset(); window.clarteDebug.settings({ textScale: 1, theme: 'light', partner: 'script' }); });
    await p2.mouse.move(240, 110);
    await p2.evaluate((t) => window.clarteDebug.heard(t), 'Are you cold?');
    await sleep(600);
    for (const k of keysOf('little')) { await p2.keyboard.press(k); await sleep(80); }
    await sleep(400);
    const states = [['typing', null], ['done', '4'], ['menu-back', '1']];
    for (const [name, key] of states) {
      if (key) { await p2.keyboard.press(key); await sleep(400); }
      const a = await p2.evaluate(() => {
        const visible = (el) => { let p = el; while (p) { const c = getComputedStyle(p); if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) === 0) return false; if (p.classList?.contains('thread-behind') || p.classList?.contains('rest-leaving') || p.classList?.contains('card-leaving') || p.classList?.contains('now-leaving')) return false; p = p.parentElement; } return true; };
        const small = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const n = walker.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (el.closest('.sr-only') || !visible(el)) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 20) small.push(`${fs.toFixed(1)}px "${t.slice(0, 20)}"`); }
        const clipped = [...document.querySelectorAll('.card:not(.card-gone) :is(.card-label, .setting-value, .setting-name, .card-hint)')].filter((e) => visible(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20));
        const cards = [...document.querySelectorAll('.card:not(.card-gone)')].map((c) => c.getBoundingClientRect());
        const texts = [...document.querySelectorAll('.thread .now-text, .thread .turn-text, .thread .state')].filter(visible).map((e) => e.getBoundingClientRect().bottom);
        return { phase: window.clarteDebug.phase(), small: [...new Set(small)], clipped, minCard: Math.round(Math.min(...cards.map((c) => Math.min(c.width, c.height)))), textBottom: Math.round(Math.max(...texts, 0)), half: innerHeight / 2, violations: window.clarteDebug.validate() };
      });
      await p2.screenshot({ path: join(OUT, `28-zoom200-${name}.png`) });
      if (a.small.length) problem(`zoom ${name}: text under 20 px: ${a.small.join(', ')}`);
      if (a.clipped.length) problem(`zoom ${name}: clipped ${a.clipped.join(', ')}`);
      if (a.violations.length) problem(`zoom ${name}: quadrant violations ${JSON.stringify(a.violations)}`);
      if (a.minCard < 96) problem(`zoom ${name}: a card is ${a.minCard}px`);
      if (a.textBottom > a.half) problem(`zoom ${name}: thread text reaches ${a.textBottom}px, below the row boundary at ${a.half}`);
      current.note = `${current.note ? `${current.note}; ` : ''}${name}: cards ≥ ${a.minCard}px, thread text ends ${a.textBottom}/${a.half}`;
    }
  } finally { await ctx.close(); }
});

await run('29 non-text contrast: unavailable cards and pager dots keep 3:1', async () => {
  await fresh(); await rest();
  const ratio = (fg, bg) => { const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); const [x, y] = [L(fg), L(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const measure = () => evaluate(() => {
    // Any CSS colour (rgb with alpha, color-mix, oklab) to sRGB bytes with alpha, through a canvas.
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const bytes = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    // The colour behind an element: every ancestor's background composited, from the page's canvas up.
    const behind = (el) => { const layers = []; for (let p = el; p; p = p.parentElement) layers.push(bytes(getComputedStyle(p).backgroundColor)); let out = bytes(getComputedStyle(document.body).backgroundColor).slice(0, 3); for (const [r, g, b, a] of layers.reverse()) out = out.map((c, i) => [r, g, b][i] * a + c * (1 - a)); return out.map(Math.round); };
    const rgb = (el) => bytes(getComputedStyle(el).color).slice(0, 3).map(Math.round);
    const out = {};
    const letters = document.querySelector('.card[aria-disabled] .letters');
    if (letters) out.letters = { fg: rgb(letters), bg: behind(letters.closest('.card')), alpha: parseFloat(getComputedStyle(letters.closest('.card-body')).opacity) };
    const q4 = document.querySelector('.cell-q4 .card[aria-disabled] .card-label');
    if (q4) out.q4 = { fg: rgb(q4), bg: behind(q4.closest('.card')), alpha: parseFloat(getComputedStyle(q4.closest('.card-body')).opacity) };
    const dot = document.querySelector('.pager i:not([data-on])');
    if (dot) out.dot = { fg: rgb(dot), bg: behind(dot.closest('.card')), alpha: parseFloat(getComputedStyle(dot).opacity) };
    return out;
  });
  const check = (name, m) => {
    if (!m) { problem(`${name}: not on screen`); return ''; }
    const { fg, bg } = m;
    const over = fg.map((c, i) => Math.round(c * m.alpha + bg[i] * (1 - m.alpha)));
    const r = ratio(over, bg);
    if (r < 3) problem(`${name}: ${r.toFixed(2)}:1 at opacity ${m.alpha}`);
    return `${name} ${r.toFixed(2)}:1`;
  };
  const results = [];
  for (const theme of ['light', 'dark']) {
    await evaluate((t) => window.clarteDebug.settings({ theme: t }), theme); await sleep(300);
    await evaluate(() => window.clarteDebug.speak('I would love to go')); await sleep(400);
    let m = await measure();
    results.push(check(`${theme} letters while speaking`, m.letters), check(`${theme} Q4 while speaking`, m.q4));
    await press('1', 400); // Stop
    await press('4', 300); await press('5', 400); // Menu → Settings (the pager)
    m = await measure();
    results.push(check(`${theme} pager dot`, m.dot));
    await press('1', 300); await press('1', 300);
  }
  await evaluate(() => window.clarteDebug.settings({ theme: 'light' }));
  note(results.filter(Boolean).join(', '));
});

await run('30 setup copy: no explanations, no zero counts, nothing under 20 px', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  try {
    await p2.goto(`${APP}/?engine=${encodeURIComponent(PROXY)}`, { waitUntil: 'load' });
    await p2.waitForFunction(() => Boolean(window.clarteDebug?.state));
    await p2.evaluate(() => localStorage.removeItem('clarte.style6.v2'));
    await p2.reload({ waitUntil: 'load' });
    await p2.waitForFunction(() => Boolean(window.clarteDebug?.state));
    await sleep(800);
    const banned = [/looks may land/i, /\b0 of \d/, /gaze from/i, /not yet/i, /cannot reach/i, /not calibrated/i, /recommended/i, /—/];
    for (let i = 0; i < 3; i++) {
      const info = await p2.evaluate(() => {
        const visible = (el) => { let p = el; while (p) { const c = getComputedStyle(p); if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) === 0) return false; p = p.parentElement; } return true; };
        const small = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const n = walker.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (el.closest('.sr-only') || !visible(el)) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 20) small.push(`${fs.toFixed(1)}px "${t.slice(0, 20)}"`); }
        return { phase: window.clarteDebug.phase(), text: document.body.innerText.replace(/\s+/g, ' '), small: [...new Set(small)], violations: window.clarteDebug.validate() };
      });
      for (const re of banned) if (re.test(info.text)) problem(`${info.phase}: "${info.text.match(re)[0]}" on screen`);
      if (info.small.length) problem(`${info.phase}: ${info.small.join(', ')}`);
      if (info.violations.length) problem(`${info.phase}: violations ${JSON.stringify(info.violations)}`);
      await p2.screenshot({ path: join(OUT, `30-${info.phase}.png`) });
      await p2.keyboard.press('4'); await sleep(500);
    }
    note('three pages: no explanatory sentence, no zero count, no dash placeholder, nothing under 20 px');
  } finally { await ctx.close(); }
});

await run('31 accessible names match the visible text: More, and the dimmed Menu while speaking', async () => {
  await fresh(); await rest();
  await heard('Where would you like to go for dinner tonight?'); await settle();
  for (let i = 0; i < 2; i++) { await press('1', 150); await settle(); }
  await press('4', 400); await press('7', 500);
  const more = await evaluate(() => { const c = document.querySelector('.card[data-action="more"]'); return c ? { name: c.getAttribute('aria-label'), text: c.innerText.replace(/\s+/g, ' ').trim() } : null; });
  if (more && more.name && more.text.split(' ').some((w) => !more.name.includes(w))) problem(`More is named "${more.name}" but reads "${more.text}"`);
  await press('1', 300);
  await evaluate(() => window.clarteDebug.speak('I would love to go')); await sleep(400);
  const q4 = await evaluate(() => { const c = document.querySelector('.cell-q4 .card'); return { name: c.getAttribute('aria-label'), text: c.innerText.replace(/\s+/g, ' ').trim(), disabled: c.getAttribute('aria-disabled') }; });
  if (q4.name && q4.name !== q4.text) problem(`the dimmed Q4 is named "${q4.name}" but reads "${q4.text}"`);
  if (q4.disabled !== 'true') problem('Q4 is not marked unavailable while speaking');
  await press('1', 300);
  note(`More "${more?.name}" / "${more?.text}"; Q4 while speaking "${q4.name ?? q4.text}" (aria-disabled ${q4.disabled})`);
});

await run('32 an ambiguous code: Q1 offers Options, and the right word is one look away ("computer science is hosting")', async () => {
  await fresh(); await rest();
  for (const w of ['computer', 'science', 'is']) {
    await type(w, 100); await settle();
    const shown = (await labelOf('.cell-q1')).toLowerCase();
    if (shown !== w) problem(`typing "${w}" shows "${shown}" in Q1`);
    await press('1', 150); await settle();
  }
  await type('hosting', 100); await settle();
  const q1 = await labelOf('.cell-q1'), q4 = await labelOf('.cell-q4');
  if (q1 !== 'Options') problem(`after "computer science is" + the code of hosting, Q1 reads "${q1}", not Options`);
  if (q4 !== 'Delete') problem(`Q4 reads "${q4}", not Delete`);
  await shot('32a-options-in-q1');
  await press('1', 300); await settle();
  const page1 = await evaluate(() => [5, 6, 7, 8].map((q) => document.querySelector(`.cell-q${q} .card-swap:not(.card-leaving) .card-label`)?.textContent?.trim().toLowerCase() ?? ''));
  const back = await labelOf('.cell-q1');
  if (back !== 'Back') problem(`the Options page has "${back}" in Q1, not Back`);
  const at = page1.indexOf('hosting');
  if (at < 0) problem(`hosting is not among the first four options: ${page1.join(', ')}`);
  await shot('32b-options-page');
  // Back returns to the word in progress, untouched.
  await press('1', 300); await settle();
  if ((await look()).pending !== 7) problem('Back from Options lost the typed groups');
  await press('1', 300); await settle();
  if (at >= 0) await press(String(5 + at), 300);
  await settle();
  const v = await look();
  if (v.words.join(' ') !== 'computer science is hosting' || v.pending !== 0) problem(`message is "${v.words.join(' ')}" with ${v.pending} pending`);
  await shot('32c-hosting-picked');
  note(`Q1 "${q1}" / Q4 "${q4}"; options ${page1.join(', ')}; message "${v.words.join(' ')}"`);
  await sane();
});

await run('33 a word typed in full shows that word before a longer completion ("the", not "what")', async () => {
  await fresh(); await rest();
  await type('the', 100); await settle();
  const q1 = await labelOf('.cell-q1');
  if (q1 !== 'The') problem(`"the" typed in full as the first word shows "${q1}"`);
  await shot('33-the-typed');
  await press('1', 150); await settle();
  const v = await look();
  if (v.words.join(' ') !== 'the') problem(`accepted "${v.words.join(' ')}"`);
  note(`Q1 "${q1}"; message "${v.words.join(' ')}"`);
  await sane();
});

// ── Report ──

await browser.close();
proxy.close();
const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length} of ${results.length} cases passed${failed.length ? `; failed: ${failed.map((r) => r.name.split(' ')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
