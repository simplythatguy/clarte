#!/usr/bin/env node
/**
 * Builds the fallback lexicon `src/prediction/lexicon.json` from the prediction engine's vocabulary
 * (`main/engine/models/vocabulary.json`, about 23k words with unigram
 * frequencies). The app decodes against it when the engine is unreachable or slow.
 *
 *   node scripts/build-lexicon.mjs
 *
 * Output: `[[word, log10(frequency)], ...]`, best first, two decimals, so the asset stays small.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const source = new URL('../../engine/models/vocabulary.json', import.meta.url);
const { words } = JSON.parse(readFileSync(source, 'utf8'));
const rows = words
  .filter((w) => /^[a-z]+(?:'[a-z]+)*$/.test(w.word) && w.frequency > 0)
  .sort((a, b) => b.frequency - a.frequency)
  .map((w) => [w.word, Number(Math.log10(w.frequency).toFixed(2))]);
writeFileSync(`${here}/../src/prediction/lexicon.json`, `${JSON.stringify(rows)}\n`);
console.log(`lexicon: ${rows.length} words → src/prediction/lexicon.json`);
