#!/usr/bin/env node
/**
 * Builds the fallback decoder's two-word context table `src/trigrams.json` from the prediction
 * engine's ARPA 4-gram (`prototypes/Word Prediction/models/lm_mix_top3_4gram_abs0.0.arpa.gz`),
 * the way `build-bigrams.mjs` builds the one-word table: for the most frequent two-word histories
 * (by their joint probability, unigram × bigram, read off the 1-gram and 2-gram sections, with the
 * sentence start `<s>` as a possible first word), the best next words with their log10
 * probabilities from the 3-gram section.
 *
 *   node scripts/build-trigrams.mjs [--last 400] [--before 10] [--hub 100] [--next 4]
 *
 * A context's second word (the word the person just accepted) is one of the LAST most frequent
 * words, and for each of them the most frequent words before it (by joint probability) make the
 * contexts: BEFORE of them, or HUB for the 80 most frequent last words ("to", "not", "the" have
 * dozens of common predecessors, and "am not" must be one). Contexts are what the fallback looks up
 * after an accepted word; a single ranking by joint probability is full of "of the"-like pairs while
 * "am not" is missing. A context whose continuations all repeat the bigram table's for its last
 * word adds nothing and is dropped.
 *
 * Output: `{ "i am": [["not", -1.1], ...], "<s> i": [["am", -1.0], ...], ... }`, two decimals.
 * Only words the lexicon knows are kept, so every suggestion is typeable; `</s>` and `<unk>` are
 * left out. With the bigram table as the back-off, the chain the fallback produces reads as
 * English three words at a time instead of two ("I am not sure", not "I am not to").
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const LAST = Number(args.last ?? 400);
const BEFORE = Number(args.before ?? 10);
const HUB = Number(args.hub ?? 100);
const NEXT = Number(args.next ?? 4);

const here = fileURLToPath(new URL('.', import.meta.url));
const arpa = fileURLToPath(new URL('../../../../Word Prediction/models/lm_mix_top3_4gram_abs0.0.arpa.gz', import.meta.url));
const lexicon = JSON.parse(readFileSync(`${here}/../src/lexicon.json`, 'utf8')).map(([w]) => w);
const known = new Set(lexicon);
const last = new Set(lexicon.slice(0, LAST));
const hub = new Set(lexicon.slice(0, 80));
const bigrams = JSON.parse(readFileSync(`${here}/../src/bigrams.json`, 'utf8'));

const unigram = new Map();
const joint = new Map(); // b → [[logp(a) + logp(b|a), "a b"], ...]
let section = '';
const lines = createInterface({ input: createReadStream(arpa).pipe(createGunzip()), crlfDelay: Infinity });
// Pass 1 (1-grams and 2-grams) picks the contexts; the 3-gram section then fills them in one pass.
let contexts = null;
const table = new Map();
for await (const line of lines) {
  if (line.startsWith('\\')) {
    section = line.trim();
    if (section === '\\3-grams:') {
      contexts = new Set();
      for (const [b, list] of joint) for (const [, k] of list.sort((a, b) => b[0] - a[0]).slice(0, hub.has(b) ? HUB : BEFORE)) contexts.add(k);
      console.log(`contexts: ${contexts.size}; "am not" ${contexts.has('am not') ? 'in' : 'out'}, "want to" ${contexts.has('want to') ? 'in' : 'out'}, "<s> i" ${contexts.has('<s> i') ? 'in' : 'out'}`);
    }
    if (section === '\\4-grams:') break;
    continue;
  }
  if (!line) continue;
  const [logp, gram] = line.split('\t');
  if (section === '\\1-grams:') {
    if (known.has(gram) || gram === '<s>') unigram.set(gram, Number(logp));
  } else if (section === '\\2-grams:') {
    const [a, b] = gram.split(' ');
    if (!last.has(b) || !(known.has(a) || a === '<s>')) continue;
    // `<s>` has no unigram probability of its own in the model (it is -99): every sentence starts with it.
    const pa = a === '<s>' ? -0.9 : unigram.get(a);
    if (pa === undefined) continue;
    let list = joint.get(b);
    if (!list) { list = []; joint.set(b, list); }
    list.push([pa + Number(logp), `${a} ${b}`]);
  } else if (section === '\\3-grams:' && contexts) {
    const cut = gram.lastIndexOf(' ');
    const context = gram.slice(0, cut);
    if (!contexts.has(context)) continue;
    const next = gram.slice(cut + 1);
    if (next === '</s>' || next === '<unk>' || !known.has(next)) continue;
    let list = table.get(context);
    if (!list) { list = []; table.set(context, list); }
    list.push([next, Number(logp)]);
  }
}
const out = {};
let dropped = 0;
for (const [context, list] of table) {
  const next = list.sort((a, b) => b[1] - a[1]).slice(0, NEXT).map(([w, p]) => [w, Number(p.toFixed(2))]);
  const b = context.slice(context.lastIndexOf(' ') + 1);
  const same = (bigrams[b] ?? []).slice(0, next.length).map(([w]) => w).join(' ');
  if (next.length && next.map(([w]) => w).join(' ') === same) { dropped += 1; continue; }
  out[context] = next;
}
console.log(`dropped ${dropped} contexts that repeat the bigram table`);
const json = JSON.stringify(out);
writeFileSync(`${here}/../src/trigrams.json`, `${json}\n`);
console.log(`trigrams: ${Object.keys(out).length} two-word contexts × up to ${NEXT} next → src/trigrams.json (${(json.length / 1024).toFixed(0)} KB)`);
