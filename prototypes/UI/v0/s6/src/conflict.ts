/**
 * Word conflicts: when the typed groups spell two whole words about equally well, the screen
 * branches instead of guessing (owner concept, 2026-11-07). Q1 keeps the first word and Q4 offers
 * the second; lines draw from the word in progress to both (Branch.tsx).
 *
 * The engine decides (CONTRACT.md, round 2): a response with `branch: true` means offer `words[1]`
 * in Q4; `branch: false` means do not. Its rule (round 4: only when two complete words are close
 * and the best word is not a likely slip) was tuned on the benchmark's dev splits under this UI's
 * policy, so it is followed as sent. The local decoder (and an engine that does not say) uses the
 * rule below, kept as strict as the engine's and read off the answer's shape (`p` renormalised
 * over every matching word, `complete` for exact-length words, `longer` for the summed p of longer
 * words): the two best words are both whole words (not merely the two best whole words somewhere
 * down the list), neither is a gaze-slip correction, the first is sure enough (p(first) ≥ SURE),
 * the second is close to it (p(second) / p(first) ≥ CLOSE), and the word more likely ends here than
 * continues (p(first) + p(second) ≥ ENDS_HERE × longer). Otherwise null, and Q4 keeps Delete.
 */
import type { Prediction } from './prediction.ts';

export const CLOSE = 0.6;
/** The first word must carry at least this much of the matching mass (the engine's round-3 rule). */
export const SURE = 0.2;
/**
 * The word must be this many times more likely to end here than to continue. Measured on the
 * stand-in vocabulary (1256 words, every prefix typed): 1 → 161 conflicts on whole words and 240
 * mid-word; 3 → 98 whole-word and 38 mid-word. Mid-word branches cost a look, so 3.
 */
export const ENDS_HERE = 3;
/** Branching from two groups on: a single group is never a word decision. */
export const CONFLICT_FROM = 2;

export type Conflict = { first: string; second: string };

/**
 * Several whole words fit the typed groups and the screen should not guess (owner, 2026-11-08:
 * "computer science is hosting" read as "growing"; both are 2334222). Q1 then offers Options,
 * which shows the top four whole words for the code in Q5–Q8. The two best words must both be
 * whole words and neither a gaze-slip correction; the second may be far less likely, because the
 * engine multiplies two context models and is overconfident (hosting/growing is 2.4e-4). Replayed
 * on the round-3 dev records with the branch kept for close pairs: 2.9632 selections per word vs
 * 2.9608 for the branch alone and 2.9832 with neither; Options shows in about 2% of typed states.
 */
export const OPTIONS_RATIO = 1e-4;

export function optionsFor(prediction: Prediction): boolean {
  if (prediction.offset !== 0 || prediction.fallback) return false;
  const [a, b] = prediction.words;
  if (!a || !b || !a.complete || !b.complete || a.corrected || b.corrected || a.p <= 0) return false;
  return b.p / a.p >= OPTIONS_RATIO;
}

export function conflictFor(prediction: Prediction, typed: number): Conflict | null {
  if (prediction.offset !== 0 || prediction.fallback) return null;
  if (prediction.source === 'engine' && typeof prediction.branch === 'boolean') {
    const [a, b] = prediction.words;
    return prediction.branch && a && b ? { first: a.word, second: b.word } : null;
  }
  if (typed < CONFLICT_FROM) return null;
  const [a, b] = prediction.words;
  if (!a || !b || !a.complete || !b.complete || a.corrected || b.corrected) return null;
  if (a.p < SURE || b.p / a.p < CLOSE) return null;
  if (a.p + b.p < ENDS_HERE * prediction.longer) return null;
  return { first: a.word, second: b.word };
}
