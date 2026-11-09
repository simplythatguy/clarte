#!/usr/bin/env node
/**
 * Builds the fallback decoder's sentence-end table `src/prediction/ends.json` from the prediction engine's ARPA
 * 4-gram (`engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz`), the way
 * `build-bigrams.mjs` builds the next-word table: for the most frequent words, log10 p(</s> | word),
 * how readily a sentence ends after it.
 *
 *   node scripts/build-ends.mjs [--words 6000]
 *
 * Output: `{ "sure": -0.6, "to": -3.1, ... }`, one decimal.
 *
 * Why: a reply on a communication aid is short, and the model's own three-word contexts often tie
 * ("I am not" → to, a, sure, so within 0.04 of each other). The fallback breaks such ties towards
 * the word that can close the sentence ("I am not sure"), never away from a clearly likelier word.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const WORDS = Number(args.words ?? 6000);

const here = fileURLToPath(new URL('.', import.meta.url));
const arpa = fileURLToPath(new URL('../../engine/models/lm_mix_top3_4gram_abs0.0.arpa.gz', import.meta.url));
const keep = new Set(JSON.parse(readFileSync(`${here}/../src/prediction/lexicon.json`, 'utf8')).slice(0, WORDS).map(([w]) => w));

const out = {};
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
  const cut = gram.indexOf(' ');
  if (gram.slice(cut + 1) !== '</s>') continue;
  const w = gram.slice(0, cut);
  if (keep.has(w)) out[w] = Number(Number(logp).toFixed(1));
}
const json = JSON.stringify(out);
writeFileSync(`${here}/../src/prediction/ends.json`, `${json}\n`);
console.log(`ends: ${Object.keys(out).length} words → src/prediction/ends.json (${(json.length / 1024).toFixed(0)} KB)`);
