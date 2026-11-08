#!/usr/bin/env node
/**
 * Builds the fallback decoder's next-word table `src/prediction/bigrams.json` from the prediction engine's
 * ARPA 4-gram (`main/engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz`): for the
 * most frequent previous words (by unigram log probability) and for the sentence start (`<s>`),
 * the best next words with their log10 probabilities, read off the model's 2-gram section.
 *
 *   node scripts/build-bigrams.mjs [--previous 3000] [--next 8]
 *
 * Output: `{ "<s>": [["i", -1.21], ...], "to": [["the", -1.72], ...], ... }`, two decimals, so
 * the asset stays small (about 100 KB gzipped at 3000 × 8). The lexicon (`build-lexicon.mjs`)
 * stays the unigram back-off; `<unk>` and `</s>` are left out, and only words the lexicon knows
 * are kept so every suggestion is typeable.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const PREVIOUS = Number(args.previous ?? 3000);
const NEXT = Number(args.next ?? 8);

const here = fileURLToPath(new URL('.', import.meta.url));
const arpa = fileURLToPath(new URL('../../engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz', import.meta.url));
const known = new Set(JSON.parse(readFileSync(`${here}/../src/prediction/lexicon.json`, 'utf8')).map(([w]) => w));

const unigram = new Map();
const bigram = new Map();
let section = '';
const lines = createInterface({ input: createReadStream(arpa).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  if (line.startsWith('\\')) {
    section = line.trim();
    if (section === '\\3-grams:') break;
    continue;
  }
  if (!line || section !== '\\1-grams:' && section !== '\\2-grams:') continue;
  const [logp, gram] = line.split('\t');
  if (section === '\\1-grams:') {
    if (known.has(gram)) unigram.set(gram, Number(logp));
  } else {
    const [prev, next] = gram.split(' ');
    if (next === '</s>' || next === '<unk>' || !known.has(next)) continue;
    if (prev !== '<s>' && !known.has(prev)) continue;
    let list = bigram.get(prev);
    if (!list) { list = []; bigram.set(prev, list); }
    list.push([next, Number(logp)]);
  }
}
const previous = [...unigram.entries()].sort((a, b) => b[1] - a[1]).slice(0, PREVIOUS).map(([w]) => w);
const table = {};
for (const prev of ['<s>', ...previous]) {
  const list = bigram.get(prev);
  if (!list) continue;
  table[prev] = list.sort((a, b) => b[1] - a[1]).slice(0, NEXT).map(([w, p]) => [w, Number(p.toFixed(2))]);
}
const json = JSON.stringify(table);
writeFileSync(`${here}/../src/prediction/bigrams.json`, `${json}\n`);
console.log(`bigrams: ${Object.keys(table).length} previous words × up to ${NEXT} next → src/prediction/bigrams.json (${(json.length / 1024).toFixed(0)} KB)`);
