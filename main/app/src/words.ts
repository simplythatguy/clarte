/**
 * Which word the screen offers, from the engine's answer for the typed groups (PR #24's rules,
 * measured with `main/engine/bench/policy_eval.py` and the s6 oracle user).
 *
 * The inline preview shows one word. While typing, a word exactly as long as the groups typed comes
 * before a longer completion when it is at least EXACT_FIRST as likely ("the" typed in full must
 * not show "what"). When nothing matches, a one-slip correction (one group off) stands in, so a
 * wrong look still reaches the word. Options always offers the shown word, the fetched exact
 * matches and the other fetched completions, regardless of their relative scores.
 */
import type { Composition } from './core/composer.ts';
import type { Prediction } from './prediction/prediction.ts';

/** The share of a longer completion's probability at which an exact-length word is shown first. */
export const EXACT_FIRST = 0.03;

export type Shown = { word: string; rank: number; slip: boolean };

/** The word the card offers for the pending groups, or null when nothing fits. */
export function shownWord(c: Composition, prediction: Prediction): Shown | null {
  if (!c.pending.length) return null;
  const words = prediction.words;
  let i = 0;
  if (!c.reopened && prediction.offset === 0 && words[0] && !words[0].complete) {
    const exact = words.findIndex((w) => w.complete && !w.corrected);
    if (exact > 0 && words[exact].p >= EXACT_FIRST * words[0].p) i = exact;
  }
  const top = words[i];
  if (top) return { word: top.word, rank: prediction.offset + i, slip: Boolean(top.corrected) };
  const alt = prediction.fallback;
  return alt?.kind === 'corrected' ? { word: alt.word, rank: 0, slip: true } : null;
}

/** Keep the current guess first, followed by exact alternatives, then longer completions. */
export function optionsOf(c: Composition, prediction: Prediction, exact: Prediction): string[] {
  const shown = shownWord(c, prediction);
  return [...new Set([
    ...(shown ? [shown.word] : []),
    ...exact.words.filter((w) => w.complete && !w.corrected).map((w) => w.word),
    ...prediction.words.map((w) => w.word),
  ])];
}
