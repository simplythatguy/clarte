/**
 * The composition model: a message is a list of committed words plus the groups typed since the
 * last commit. Words come from the prediction engine (`src/prediction`), so the reducer never
 * decodes; an accept carries the word the screen showed and its rank in the engine's ranking.
 */
import { groupLabel, groupOf, signatureOf, type GroupId } from './decoder.ts';

export type Word = {
  text: string;
  /** The groups that produced it; empty for text that arrived whole (a phrase, a quick reply). */
  groups: GroupId[];
  /** The rank the word had in the engine's ranking, so a later delete can reopen it at the next one. */
  candidateIndex: number;
  source: 'decoded' | 'unresolved' | 'phrase';
  /** The groups actually typed when they differ from `groups` (a gaze-slip correction was accepted). */
  typed?: GroupId[];
};

export type Composition = {
  words: Word[];
  pending: GroupId[];
  /** Which rank of the engine's ranking the word card shows for `pending`. 0 is the most likely. */
  candidateIndex: number;
  /** True right after a delete reopened a word, so that a second delete removes the word outright. */
  reopened: boolean;
};

export type ComposerEvent =
  | { type: 'group'; group: GroupId }
  /** Commit the shown word, `rank` its place in the engine's ranking. With nothing pending, nothing happens. */
  | { type: 'accept'; word: string; rank: number }
  /**
   * Delete the last pending group. With nothing pending, take back the last word: a decoded word
   * reopens as its pending groups with the next-ranked word offered, so a wrong decode is one
   * selection away from the next guess ("other word" = delete, accept); a second delete straight
   * after the reopen removes the whole word; a phrase is simply removed.
   */
  | { type: 'delete' }
  | { type: 'clear' }
  /** Commit text that arrived whole, such as a quick phrase. */
  | { type: 'phrase'; text: string };

export const EMPTY_COMPOSITION: Composition = { words: [], pending: [], candidateIndex: 0, reopened: false };

/** Committed text, ready to speak. */
export function messageText(c: Composition): string {
  return c.words.map((w) => w.text).join(' ');
}

/** The pending groups as labels, for showing what has been typed but not yet decoded. */
export function pendingLabels(c: Composition): string[] {
  return c.pending.map(groupLabel);
}

export type Glyph = { group: GroupId; letter: string | null; typed: boolean };

/**
 * What to draw for the word in progress: one glyph per pending group showing the shown word's
 * letter in that position (null when there is no word), then the word's remaining letters as
 * untyped ghost glyphs. The UI colours typed glyphs by group and ghosts in tertiary ink. Letters
 * without a group (an apostrophe) are skipped, as the group signature skips them.
 */
export function glyphsForWord(pending: readonly GroupId[], word: string | null): Glyph[] {
  const letters = (word ?? '').split('').filter((ch) => groupOf(ch) !== null);
  const glyphs: Glyph[] = pending.map((group, i) => ({ group, letter: letters[i] ?? null, typed: true }));
  for (let i = pending.length; i < letters.length; i++) {
    const g = groupOf(letters[i]);
    if (g) glyphs.push({ group: g, letter: letters[i], typed: false });
  }
  return glyphs;
}

/**
 * Commit `word` for the pending groups, or as a whole word when nothing is pending (it then
 * remembers its own groups, so Delete can reopen it like any typed word).
 */
export function acceptWord(c: Composition, word: string, candidateIndex = c.candidateIndex): Composition {
  const groups = c.pending.length ? c.pending : signatureOf(word);
  return { words: [...c.words, { text: word, groups, candidateIndex, source: 'decoded' }], pending: [], candidateIndex: 0, reopened: false };
}

export function reduce(c: Composition, event: ComposerEvent): Composition {
  switch (event.type) {
    case 'group':
      return { ...c, pending: [...c.pending, event.group], candidateIndex: 0, reopened: false };
    case 'accept':
      return c.pending.length ? acceptWord(c, event.word, event.rank) : c;
    case 'delete': {
      if (c.reopened) return { ...c, pending: [], candidateIndex: 0, reopened: false };
      if (c.pending.length) return { ...c, pending: c.pending.slice(0, -1), candidateIndex: 0 };
      const last = c.words[c.words.length - 1];
      if (!last) return c;
      const words = c.words.slice(0, -1);
      if (last.source !== 'decoded') return { ...c, words, reopened: false };
      // The engine wraps a rank past its last word back to 0.
      return { words, pending: last.typed ?? last.groups, candidateIndex: last.candidateIndex + 1, reopened: true };
    }
    case 'clear':
      return EMPTY_COMPOSITION;
    case 'phrase': {
      const text = event.text.trim();
      if (!text) return c;
      return { words: [...c.words, { text, groups: [], candidateIndex: 0, source: 'phrase' }], pending: [], candidateIndex: 0, reopened: false };
    }
  }
}
