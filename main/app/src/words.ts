/**
 * Which word the screen offers, from the engine's answer for the typed groups (PR #24's rules,
 * measured with `main/engine/bench/policy_eval.py` and the s6 oracle user).
 *
 * The word card shows one word. While typing, a word exactly as long as the groups typed comes
 * before a longer completion when it is at least EXACT_FIRST as likely ("the" typed in full must
 * not show "what"). When nothing matches, a one-slip correction (one group off) stands in, so a
 * wrong look still reaches the word. When two whole words fit about equally well the screen does
 * not guess: it offers Options (owner, 2026-11-08), which lists every whole word that fits.
 */
import type { Composition } from './core/composer.ts';
import type { Prediction } from './prediction/prediction.ts';

/** The share of a longer completion's probability at which an exact-length word is shown first. */
export const EXACT_FIRST = 0.03;
/** Two whole words are a conflict when the second is at least this share of the first. */
export const CLOSE = 0.6;
/** ...and the first is at least this likely. */
export const SURE = 0.2;
/** ...and the word more likely ends here than continues, by this factor over longer words. */
export const ENDS_HERE = 3;
/** A single group is never a word decision. */
export const CONFLICT_FROM = 2;

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

/** True when the typed groups spell two whole words about equally well. The engine makes the call when it can. */
export function isConflict(c: Composition, prediction: Prediction): boolean {
  if (c.reopened || c.candidateIndex !== 0 || prediction.offset !== 0 || prediction.fallback) return false;
  const [a, b] = prediction.words;
  if (prediction.source === 'engine' && typeof prediction.branch === 'boolean') return prediction.branch && Boolean(a && b);
  if (c.pending.length < CONFLICT_FROM) return false;
  if (!a || !b || !a.complete || !b.complete || a.corrected || b.corrected) return false;
  if (a.p < SURE || b.p / a.p < CLOSE) return false;
  return a.p + b.p >= ENDS_HERE * prediction.longer;
}

/** Every whole word the typed groups spell, most likely first: the Options screen's list. */
export function optionsOf(prediction: Prediction): string[] {
  return prediction.words.filter((w) => w.complete && !w.corrected).map((w) => w.word);
}
