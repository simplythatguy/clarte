/**
 * Word conflicts: when the typed groups spell two whole words about equally well, the screen does
 * not guess. The primary card offers Options (owner, 2026-11-08), and the Options screen lists
 * every whole word the groups spell, most likely first.
 *
 * Contract for the language model: `conflictFor` returns the two words when both are whole words
 * for the typed groups, the second is close to the first (p(second) / p(first) ≥ CLOSE), and the
 * word more likely ends here than continues (p(first) + p(second) ≥ ENDS_HERE × the summed
 * probability of longer words with the same start). Otherwise null.
 *
 * The stand-in decoder scores by frequency rank, so probability is approximated by Zipf's law,
 * p ∝ 1 / rank. A word the conversation already used gets the decoder's context boost and is
 * never in conflict with one it did not use.
 */
import { decode, type Candidate } from '../../shared/decoder.ts';
import type { Composition } from '../../shared/composer.ts';

export const CLOSE = 0.6;
/**
 * The word must be this many times more likely to end here than to continue. Measured on the
 * stand-in vocabulary (1256 words, every prefix typed): 1 → 161 conflicts on whole words and 240
 * mid-word; 3 → 98 whole-word and 38 mid-word. Mid-word branches cost Delete for a look, so 3.
 */
export const ENDS_HERE = 3;
/** Branching from two groups on: a single group is never a word decision. */
export const CONFLICT_FROM = 2;

export type Conflict = { first: string; second: string };

const CONTEXT_BOOST = 20000;
const COMPLETE_BONUS = 50000;
const TOP = 100000;

/** Zipf probability (unnormalised) from the stand-in decoder's score. */
function zipf(c: Candidate, extraPerLetter = 400, length = 0): { p: number; context: boolean } {
  let raw = TOP - c.score + (c.complete ? COMPLETE_BONUS : -extraPerLetter * length);
  const context = raw < 0;
  if (context) raw += CONTEXT_BOOST;
  return { p: 1 / (Math.max(0, raw) + 1), context };
}

export function conflictFor(c: Composition, context: readonly string[] = []): Conflict | null {
  if (c.reopened || c.pending.length < CONFLICT_FROM) return null;
  const list = decode(c.pending, { limit: 60, context });
  const whole = list.filter((x) => x.complete);
  if (whole.length < 2) return null;
  const [a, b] = whole;
  const pa = zipf(a), pb = zipf(b);
  if (pa.context !== pb.context) return null;
  if (pb.p / pa.p < CLOSE) return null;
  let longer = 0;
  for (const x of list) if (!x.complete) longer += zipf(x, 400, x.word.length - c.pending.length).p;
  if (pa.p + pb.p < ENDS_HERE * longer) return null;
  return { first: a.word, second: b.word };
}

/** Every whole word the typed groups spell, most likely first: the Options screen's list. */
export function optionsFor(c: Composition, context: readonly string[] = []): string[] {
  return decode(c.pending, { limit: 60, context }).filter((x) => x.complete).map((x) => x.word);
}
