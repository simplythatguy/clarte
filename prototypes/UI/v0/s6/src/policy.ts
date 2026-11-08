/**
 * What the two top cards offer (owner decisions, 2026-11-07). Pure functions over the state and
 * the current prediction, so a label can never disagree with what it does, and so the rules are
 * testable without a browser (`scripts/test-policy.ts`).
 *
 * Q1 always shows the predicted word: the next word when nothing is typed (the first word of a
 * message too, and while the partner is being heard), the current word's completion while typing.
 * The word just accepted is never offered as the next word (the engine and the local decoder
 * suppress it too; this is the screen's own guard against "hello hello"): the next distinct word
 * takes its place. When nothing matches the typed groups it shows the engine's top correction
 * (one digit off) or the best word for the longest matching prefix, marked `slip`, so Q1 is never
 * empty. While typing, a word exactly as long as the groups typed comes before a longer completion
 * when it is at least a tenth as likely (`EXACT_FIRST`). Accepting it appends it. When several whole words fit the typed groups and no two are
 * close enough to branch on, Q1 is Options instead: it shows the top four in Q5–Q8 (owner,
 * 2026-11-08). While the device speaks, Q1 is Stop.
 *
 * Q4 offers whatever is most needed at that moment, in this priority order:
 *   1. speaking: unavailable (dimmed, named);
 *   2. two close whole words (the branch contract in conflict.ts): the second word;
 *   3. groups pending: Delete (the last group), or Delete word once a word was reopened;
 *   4. the message has words and nothing is pending: Done (opens the page with Speak);
 *   5. just spoken: Say again, for a few seconds;
 *   6. the message is empty: Menu.
 */
import { conflictFor, optionsFor, type Conflict } from './conflict.ts';
import type { State } from './model.ts';
import type { Prediction } from './prediction.ts';

/** Q1, the ink card. */
export type PrimaryFn =
  /** `slip`: nothing matched the typed groups; this word is a gaze-slip correction or the best word for the longest matching prefix. */
  | { kind: 'word'; word: string; display?: string; rank: number; complete: boolean; slip?: boolean }
  /** Groups are pending and nothing fits them, not even one digit off. */
  | { kind: 'no-match' }
  /** Several whole words fit the typed groups: open them in Q5–Q8 rather than guess (conflict.ts `optionsFor`). */
  | { kind: 'options' }
  | { kind: 'stop-speaking' };

/** Q4, the white card. */
export type SecondaryFn =
  | { kind: 'unavailable' }
  | { kind: 'second'; word: string; display?: string; rank: number }
  | { kind: 'delete'; word: boolean }
  | { kind: 'done' }
  | { kind: 'say-again'; turnId: number }
  | { kind: 'menu' };

/**
 * While typing, a word whose length is exactly the groups typed is preferred to a longer completion
 * when it is at least this share of the completion's probability (owner, 2026-11-08: "the" typed in
 * full showed "what"). Replayed on the round-3 dev records with the branch and Options: 2.9194
 * selections per word vs 2.9632 for completion first; showing only exact-length words would cost
 * about 4.96, since nothing could be completed early.
 */
export const EXACT_FIRST = 0.1;

/** The word Q1 offers from `prediction`: the first that is not the word just accepted (next word only). */
export function nextWordIndex(state: State, prediction: Prediction): number {
  const c = state.composition;
  if (c.pending.length && !c.reopened && prediction.offset === 0) {
    const [top] = prediction.words;
    if (top && !top.complete) {
      const exact = prediction.words.findIndex((w) => w.complete && !w.corrected);
      if (exact > 0 && prediction.words[exact].p >= EXACT_FIRST * top.p) return exact;
    }
    return 0;
  }
  const last = c.pending.length ? null : c.words[c.words.length - 1]?.text.toLowerCase() ?? null;
  if (last === null) return 0;
  const i = prediction.words.findIndex((w) => w.word.toLowerCase() !== last);
  return i < 0 ? 0 : i;
}

export function primaryFor(state: State, prediction: Prediction): PrimaryFn {
  if (state.live.kind === 'speaking') return { kind: 'stop-speaking' };
  if (optionsOf(state, prediction)) return { kind: 'options' };
  const i = nextWordIndex(state, prediction);
  const top = prediction.words[i];
  if (top) {
    const fn: PrimaryFn = { kind: 'word', word: top.word, rank: prediction.offset + i, complete: top.complete };
    if (top.display) fn.display = top.display;
    if (top.corrected) fn.slip = true;
    return fn;
  }
  const alt = prediction.fallback;
  if (alt && state.composition.pending.length) {
    const fn: PrimaryFn = { kind: 'word', word: alt.word, rank: 0, complete: false, slip: true };
    if (alt.display) fn.display = alt.display;
    return fn;
  }
  return { kind: 'no-match' };
}

/** Options, when several whole words fit the typed groups and none is close enough to branch on. */
export function optionsOf(state: State, prediction: Prediction): boolean {
  const c = state.composition;
  if (state.live.kind === 'speaking' || !c.pending.length || c.reopened) return false;
  return !conflictFor(prediction, c.pending.length) && optionsFor(prediction);
}

/** The branch, when the typed groups spell two whole words about equally well. */
export function conflictOf(state: State, prediction: Prediction): Conflict | null {
  const c = state.composition;
  if (state.live.kind === 'speaking' || !c.pending.length || c.reopened) return null;
  return conflictFor(prediction, c.pending.length);
}

export function secondaryFor(state: State, prediction: Prediction): SecondaryFn {
  const { live, composition: c } = state;
  if (live.kind === 'speaking') return { kind: 'unavailable' };
  if (c.pending.length) {
    const conflict = conflictOf(state, prediction);
    if (conflict) {
      // Its rank in the engine's ranking, so Delete word reopens at the word after it.
      const at = Math.max(0, prediction.words.findIndex((w) => w.word === conflict.second));
      const fn: SecondaryFn = { kind: 'second', word: conflict.second, rank: prediction.offset + at };
      const display = prediction.words[at]?.display;
      if (display) fn.display = display;
      return fn;
    }
    return { kind: 'delete', word: c.reopened };
  }
  if (c.words.length) return { kind: 'done' };
  if (live.kind === 'spoken') return { kind: 'say-again', turnId: live.turnId };
  return { kind: 'menu' };
}

/** Identity of a face, for holding a label still under a resting gaze (App: useSettled). */
export function primaryKey(fn: PrimaryFn): string {
  return fn.kind === 'word' ? `word:${fn.word}` : fn.kind;
}

export function secondaryKey(fn: SecondaryFn): string {
  switch (fn.kind) {
    case 'second': return `second:${fn.word}`;
    case 'delete': return `delete:${fn.word}`;
    case 'say-again': return `say-again:${fn.turnId}`;
    default: return fn.kind;
  }
}
