#!/usr/bin/env node
/**
 * Builds the fallback decoder's echo table `src/prediction/echo.json` from the prediction engine's ARPA 4-gram
 * (`main/engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz`), the way
 * `build-bigrams.mjs` builds the next-word table: for each of the most frequent content words (the
 * lexicon past its FUNCTION most frequent entries), which function words the model has seen right
 * before it with p(word | function word) ≥ 10^FLOOR, as a bit mask over the function words in
 * lexicon order, base64.
 *
 *   node scripts/build-echo.mjs [--function 250] [--content 7000] [--floor -3.7]
 *
 * Output: `{ "_function": ["the", "i", ...], "cold": "AAEC...", "tea": "...", ... }`.
 *
 * Why: the fallback copies the partner's content words ("cold", "tea", "dinner") into its ranking
 * (the engine's pointer cache, `v1/engine/cache.py`), but a copied word may only be offered as the
 * next word where the language model agrees it can follow the word before it ("I am cold", never
 * "I cold"). The next-word table keeps only the eight best continuations of each word, which a
 * content word rarely reaches ("am cold" is the model's 100th continuation of "am"); this table
 * holds the model's own probability for exactly those pairs, so the fallback can tell "am cold"
 * (far likelier than "cold" in general) from "am coffee" (not).
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const FUNCTION = Number(args.function ?? 250); // at most 256: an index is one byte
const CONTENT = Number(args.content ?? 7000);
const FLOOR = Number(args.floor ?? -4);

const here = fileURLToPath(new URL('.', import.meta.url));
const arpa = fileURLToPath(new URL('../../engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz', import.meta.url));
const lexicon = JSON.parse(readFileSync(`${here}/../src/prediction/lexicon.json`, 'utf8')).map(([w]) => w);
const functionWords = lexicon.slice(0, FUNCTION);
const functionIndex = new Map(functionWords.map((w, i) => [w, i]));
const content = new Set(lexicon.slice(FUNCTION, FUNCTION + CONTENT));

const pairs = new Map();
let section = '';
const lines = createInterface({ input: createReadStream(arpa).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  if (line.startsWith('\\')) {
    section = line.trim();
    if (section === '\\3-grams:') break;
    continue;
  }
  if (!line || section !== '\\2-grams:') continue;
  const [logp, gram] = line.split('\t');
  const [a, b] = gram.split(' ');
  if (!content.has(b) || Number(logp) < FLOOR) continue;
  const i = functionIndex.get(a);
  if (i === undefined) continue;
  let list = pairs.get(b);
  if (!list) { list = []; pairs.set(b, list); }
  list.push(i, Math.max(0, Math.min(255, Math.round(-32 * Number(logp)))));
}
const out = { _function: functionWords };
let entries = 0;
for (const [word, list] of pairs) { out[word] = Buffer.from(Uint8Array.from(list)).toString('base64'); entries += list.length / 2; }
const json = JSON.stringify(out);
writeFileSync(`${here}/../src/prediction/echo.json`, `${json}\n`);
console.log(`echo: ${pairs.size} content words, ${entries} (function word, p) pairs with p ≥ 10^${FLOOR} → src/prediction/echo.json (${(json.length / 1024).toFixed(0)} KB)`);
