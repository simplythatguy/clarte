#!/usr/bin/env node
/**
 * The oracle user: says a target sentence through the real s6 screen and the real engine, the way a
 * person who knows the sentence would, and checks the message reads exactly that. For each word it
 * types the word's groups and accepts Q1 the moment it shows the word; otherwise it takes the second
 * word in Q4, Options, the chooser's arrow, Other words, or Spell, whichever the screen offers. Every
 * key press is one look. A word fails when the message is wrong, when no route produced it, or when
 * it cost more looks than spelling it from scratch would (its groups, Spell, and the letters).
 *
 *   node scripts/oracle.mjs [--app http://localhost:5116] [--engine http://127.0.0.1:8766] [--suite all|NAME] [--out DIR]
 *
 * Needs the s6 dev server and a healthy v1 engine. Writes DIR/oracle.json and prints one line per case.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const APP = (args.app ?? 'http://localhost:5116').replace(/\/$/, '');
const ENGINE = (args.engine ?? 'http://127.0.0.1:8766').replace(/\/$/, '');
const OUT = args.out ?? 'evidence/oracle';
const SUITE = args.suite ?? 'all';
mkdirSync(OUT, { recursive: true });

const group = (ch) => { const c = ch.charCodeAt(0) - 97; return c < 0 || c > 25 ? null : c < 6 ? 1 : c < 14 ? 2 : c < 19 ? 3 : 4; };
const keysOf = (word) => [...word.toLowerCase()].map(group).filter(Boolean).map((g) => String(4 + g));
const letters = (word) => word.toLowerCase().replace(/[^a-z]/g, '');

const LONG = 'i have been thinking about what you said yesterday and i really want to talk to my sister before we decide anything about the house because she always knows what to do when things get hard';
const HISTORY = Array.from({ length: 30 }, (_, i) => (i % 2 ? ['user', `I think so ${i}`] : ['partner', `Did you sleep well last night, number ${i}?`]));

/** Each case: a partner line (or null), optional extra history, and the sentence to say. */
const SUITES = {
  short: [
    [null, 'a'], [null, 'i'], [null, 'no'], [null, 'ok'], ['Are you cold?', 'yes'], [null, 'go'], [null, 'hi'], [null, 'it is'],
    ['Do you want it?', 'no no no'], [null, 'up'], [null, 'so'], [null, 'oh'],
  ],
  common: [
    ['Where would you like to go for dinner tonight?', 'i would like to go to the restaurant'],
    ['How are you feeling today?', 'i feel tired and my back hurts'],
    [null, 'can you help me please'],
    [null, 'thank you so much for coming'],
    ['Do you want tea or coffee?', 'coffee please with milk'],
    [null, 'the hero of the story'],
    [null, 'computer science is hosting a hackathon'],
  ],
  long: [
    [null, LONG],
    ['Tell me about your day.', 'it was a long day but a good one and i am happy to be home now with you'],
  ],
  history: [
    ['What should we do now?', 'i want to sleep', HISTORY],
    ['And then?', 'call my mom tomorrow morning', HISTORY],
  ],
  rare: [
    [null, 'i love the smell of petrichor'],
    ['What did the doctor give you?', 'levothyroxine and atorvastatin'],
    [null, 'i feel discombobulated'],
    [null, 'that was serendipity'],
    [null, 'what a kerfuffle'],
    [null, 'otorhinolaryngologist'],
    [null, 'polyphiloprogenitive'],
    [null, 'antidisestablishmentarianism'],
    [null, 'pneumonoultramicroscopicsilicovolcanoconiosis'],
    [null, 'apricity'],
    [null, 'i need my baclofen'],
    [null, 'dysarthria makes talking hard'],
  ],
  names: [
    ['Your sister Priya is coming at four with Marcus.', 'is priya bringing the kids'],
    [null, 'ask doctor okafor'],
    [null, 'my name is amal'],
    [null, 'tell kensky thanks'],
    [null, 'john is here'],
  ],
  slang: [
    ['yo what is up', 'nah bro i am good'],
    [null, 'idk tbh'],
    [null, 'that is so sus'],
    [null, 'rizz'],
    [null, 'lol okay'],
  ],
  contractions: [
    [null, "i don't know"], [null, "i'm fine"], [null, "we can't go"], [null, "y'all are late"], [null, "it won't work"], [null, "she's here"],
  ],
  repeats: [
    [null, 'very very good'], ['Hello', 'hello hello'], [null, 'the the'], [null, 'bye bye'],
  ],
  debug: [[null, 'xyz'], [null, 'zorbleflux'], [null, 'ask doctor okafor'], [null, "y'all are late"]],
  invented: [
    [null, 'zorbleflux'], [null, 'my cat is called mrowly'], [null, 'qwerty'], [null, 'xyz'],
  ],
  profanity: [
    [null, 'this is shit'], [null, 'what the fuck'],
  ],
};

const cases = Object.entries(SUITES).flatMap(([suite, list]) => list.map(([partner, sentence, history]) => ({ suite, partner, sentence, history })))
  .filter((c) => (SUITE === 'all' && c.suite !== 'debug') || c.suite === SUITE);

const health = await fetch(`${ENGINE}/api/v1/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) { console.error(`no engine at ${ENGINE}`); process.exit(2); }
console.log(`engine ${ENGINE}: ${health.vocabulary.toLocaleString()} words, ${health.rescorer}`);

/** Looks to spell `word` from nothing: its groups, Spell, and the letters as Spell ranks them. */
async function spellCost(page, word) {
  return page.evaluate(async (w) => window.clarteDebug.spellLooks(w), letters(word));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${APP}/?onboarding=off&engine=${encodeURIComponent(ENGINE)}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.clarteDebug?.state));
await page.waitForFunction(() => !window.clarteDebug.engineDown(), null, { timeout: 20000 });
await page.mouse.move(720, 230); // rest zone: the bot reads cards, it never rests its gaze on them

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let looks = 0;
const VERBOSE = Boolean(process.env.ORACLE_VERBOSE);
const press = async (key) => { looks += 1; if (VERBOSE) console.log(`  press ${key}`); await page.keyboard.press(key); await sleep(90); };
// Only a card with an action counts: an empty quadrant keeps its last card while it fades away.
const label = (q) => page.evaluate((q) => { const c = document.querySelector(`.cell-${q} .card[data-action]`); return c?.querySelector('.card-swap:not(.card-leaving) .card-label')?.textContent?.trim() ?? ''; }, q);
const action = (q) => page.evaluate((q) => document.querySelector(`.cell-${q} .card[data-action]`)?.dataset.action ?? '', q);
const screen = () => page.evaluate(() => window.clarteDebug.state().screen);
const message = () => page.evaluate(() => window.clarteDebug.state().composition.words.map((w) => w.text.toLowerCase()));
/** Wait until the screen shows the engine's answer (never the local stand-in), as a person waits for the card. */
const settle = async () => {
  await page.waitForFunction(() => { const p = window.clarteDebug.prediction(); return p.source === 'engine' && !p.provisional; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => { const c = window.clarteDebug.chooser?.(); return !c || c.source === 'engine'; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(160);
};
/** Wait until the screen state satisfies `test` (a page turned), then let the cards swap in. */
const waitScreen = async (test, arg) => {
  for (let i = 0; i < 60; i++) { if (test(await screen(), arg)) break; await sleep(25); }
  await sleep(220);
};
const bottom = async () => Promise.all(['q5', 'q6', 'q7'].map(async (q) => (await label(q)).toLowerCase()));

/**
 * On a chooser (words) page: look for `word` on the first pages and pick it. True when picked. Like a
 * person, the oracle turns to Spell when the word is not on the first two pages rather than paging on.
 */
async function pickFromChooser(word, pages = 2) {
  for (let guard = 0; guard < pages; guard++) {
    const shown = await bottom();
    const at = shown.indexOf(word);
    if (at >= 0) { await press(String(5 + at)); await settle(); return true; }
    if (guard + 1 >= pages || (await action('q8')) !== 'more') return false;
    const before = (await screen()).page;
    await press('8');
    await waitScreen((sc, b) => sc.page !== b, before);
    await settle();
  }
  return false;
}

/** On a Spell page: choose each letter of `word`. True when the word was completed. */
async function spell(word) {
  if (VERBOSE) console.log('    spell', word, 'screen', (await screen()).kind, 'letters on screen', await bottom(), 'q8', await action('q8'));
  for (const ch of word.toLowerCase().replace(/[^a-z']/g, '')) {
    let found = false;
    for (let guard = 0; guard < 4 && !found; guard++) {
      const shown = await bottom();
      const at = shown.indexOf(ch);
      if (at >= 0) { await press(String(5 + at)); found = true; await waitScreen((sc) => sc.kind !== 'spell' || sc.page === 0); }
      else if ((await action('q8')) === 'more') {
        const before = (await screen()).page;
        await press('8');
        await waitScreen((sc, b) => sc.page !== b, before);
      } else break;
    }
    if (!found) return false;
  }
  await settle();
  return true;
}

/** Say one word. Returns the route that produced it, or null. */
async function sayWord(word) {
  const target = word.toLowerCase();
  const say = (...m) => { if (VERBOSE) console.log('   ', word, ...m); };
  const keys = keysOf(word);
  for (let k = 0; k < keys.length; k++) {
    // The next word can be on Q1 before anything is typed.
    if (k === 0) {
      const q1 = (await label('q1')).toLowerCase();
      if (q1 === target) { await press('1'); await settle(); return 'next word'; }
    }
    await press(keys[k]); await settle();
    const q1 = (await label('q1')).toLowerCase();
    if (q1 === target) { await press('1'); await settle(); return `Q1 after ${k + 1}/${keys.length}`; }
    if ((await action('q4')) === 'secondary' && (await label('q4')).toLowerCase() === target) { await press('4'); await settle(); return `Q4 after ${k + 1}/${keys.length}`; }
  }
  const q1 = (await label('q1')).toLowerCase();
  say(`after all groups: Q1 "${q1}", Q4 "${await label('q4')}" (${await action('q4')}), screen ${(await screen()).kind}`);
  if (q1 === 'options') {
    await press('1'); await settle();
    if (await pickFromChooser(target)) return 'Options';
    // Not on the pages (a word the lexicon lacks): Spell from Q4. Back to page 1 first is not needed.
    await press('4'); await settle();
    return (await spell(word)) ? 'Options → Spell' : null;
  }
  if (q1 === 'spell') { await press('1'); await settle(); return (await spell(word)) ? 'Spell' : null; }
  if (q1 === 'no word') { await settle(); return sayWordAfterWait(word); }
  // Q1 holds another whole word: accept it, then Done → Other words to swap it, or Spell from there.
  await press('1'); await settle();
  await press('4'); await settle();               // Done
  await press('7'); await settle();               // Other words
  if (await pickFromChooser(target)) return 'Other words';
  await press('4'); await settle();               // Spell (respell the last word)
  return (await spell(word)) ? 'Other words → Spell' : null;
}
async function sayWordAfterWait(word) {
  const q1 = (await label('q1')).toLowerCase();
  if (q1 === 'spell') { await press('1'); await settle(); return (await spell(word)) ? 'Spell (after wait)' : null; }
  return null;
}

const results = [];
for (const c of cases) {
  await page.evaluate(() => window.clarteDebug.reset());
  await sleep(150);
  if (c.history) await page.evaluate((h) => window.clarteDebug.setHistory(h), c.history);
  if (c.partner) await page.evaluate((t) => window.clarteDebug.heard(t), c.partner);
  await settle();
  const words = c.sentence.split(' ');
  const per = [];
  let ok = true;
  for (const w of words) {
    const before = looks;
    const t0 = Date.now();
    let route = null;
    try { route = await sayWord(w); } catch (e) { route = null; }
    const cost = looks - before;
    const spellLooks = await spellCost(page, w);
    const msg = await message();
    const right = msg.at(-1) === w.toLowerCase() && (await screen()).kind === 'talk';
    const tooDear = cost > spellLooks;
    if (!route || !right || tooDear) ok = false;
    per.push({ word: w, route, looks: cost, spell: spellLooks, right, tooDear, ms: Date.now() - t0 });
    if (!route || !right) {
      // Put the message right so the rest of the sentence is still tested.
      await page.evaluate((target) => window.clarteDebug.forceMessage(target), words.slice(0, per.length).join(' '));
      await settle();
    }
  }
  const final = (await message()).join(' ');
  if (final !== c.sentence.toLowerCase()) ok = false;
  const total = per.reduce((s, p) => s + p.looks, 0);
  const spellTotal = per.reduce((s, p) => s + p.spell, 0);
  results.push({ ...c, history: c.history ? c.history.length : 0, ok, final, looks: total, spellLooks: spellTotal, words: per });
  const bad = per.filter((p) => !p.route || !p.right || p.tooDear).map((p) => `${p.word}${!p.route ? ' (no route)' : !p.right ? ' (wrong message)' : ` (${p.looks} looks > spelling ${p.spell})`}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${c.suite}] "${c.sentence.slice(0, 70)}${c.sentence.length > 70 ? '…' : ''}" ${total} looks (spelling ${spellTotal})${bad.length ? `  ✗ ${bad.join(', ')}` : ''}`);
}
await browser.close();
writeFileSync(join(OUT, 'oracle.json'), `${JSON.stringify({ engine: ENGINE, vocabulary: health.vocabulary, results }, null, 2)}\n`);
const failed = results.filter((r) => !r.ok);
const allWords = results.flatMap((r) => r.words);
const routes = allWords.reduce((m, w) => ({ ...m, [w.route ?? 'none']: (m[w.route?.split(' after')[0] ?? 'none'] ?? 0) + 1 }), {});
console.log(`\n${results.length - failed.length} of ${results.length} sentences exact and no dearer than spelling; ${allWords.length} words, ${allWords.reduce((s, w) => s + w.looks, 0)} looks (spelling every word: ${allWords.reduce((s, w) => s + w.spell, 0)})`);
console.log('routes:', JSON.stringify(Object.fromEntries(Object.entries(allWords.reduce((m, w) => { const k = (w.route ?? 'none').split(' after')[0]; m[k] = (m[k] ?? 0) + 1; return m; }, {})))));
process.exit(failed.length ? 1 : 0);
