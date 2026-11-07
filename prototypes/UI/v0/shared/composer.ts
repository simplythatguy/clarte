/**
 * The composition model shared by every UI style.
 *
 * A message is a list of committed words plus the groups typed since the last commit. All five
 * prototypes drive this same reducer, so they differ only in how they show it, never in what a
 * selection means.
 */
import { decode, groupLabel, groupOf, type Candidate, type GroupId } from './decoder.ts';

export type Word = {
  text: string;
  /** The groups that produced it; empty for text that arrived whole (a phrase, a quick reply). */
  groups: GroupId[];
  /** Which candidate was taken, so a later delete can reopen the word at the next one. */
  candidateIndex: number;
  source: 'decoded' | 'unresolved' | 'phrase';
};

export type Composition = {
  words: Word[];
  pending: GroupId[];
  /** Which decode candidate the autocomplete slot shows for `pending`. 0 is the most likely. */
  candidateIndex: number;
  /** True right after a delete reopened a word, so that a second delete removes the word outright. */
  reopened: boolean;
};

/** Completions longer than the typed sequence are offered only from this many groups on. */
export const COMPLETIONS_FROM = 2;

export type ComposerEvent =
  | { type: 'group'; group: GroupId }
  /** Commit the shown candidate as a word. With nothing pending, nothing happens. */
  | { type: 'accept' }
  /** Show the next candidate for the pending groups. Wraps around. */
  | { type: 'next' }
  /**
   * Delete the last pending group. With nothing pending, take back the last word: a decoded word
   * reopens as its pending groups with the next candidate offered, so a wrong decode is one
   * selection away from the next guess ("other word" = delete, accept); a second delete straight
   * after the reopen removes the whole word; a phrase is simply removed.
   */
  | { type: 'delete' }
  | { type: 'clear' }
  /** Commit text that arrived whole, such as a quick phrase. */
  | { type: 'phrase'; text: string };

export const EMPTY_COMPOSITION: Composition = { words: [], pending: [], candidateIndex: 0, reopened: false };

export function candidates(c: Composition, context: readonly string[] = []): Candidate[] {
  const list = decode(c.pending, { limit: 8, context });
  const filtered = c.pending.length >= COMPLETIONS_FROM ? list : list.filter((x) => x.complete);
  return filtered.slice(0, 5);
}

/** The candidate the autocomplete slot should show, or null with nothing pending. */
export function currentCandidate(c: Composition, context: readonly string[] = []): Candidate | null {
  const list = candidates(c, context);
  if (!list.length) return null;
  return list[c.candidateIndex % list.length];
}

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
 * What to draw for the word in progress: one glyph per pending group showing the current
 * candidate's letter in that position (null when no candidate), then the candidate's remaining
 * letters as untyped ghost glyphs. The UI colours typed glyphs by group and ghosts in tertiary ink.
 */
export function pendingGlyphs(c: Composition, context: readonly string[] = []): Glyph[] {
  const candidate = currentCandidate(c, context);
  const word = candidate?.word ?? '';
  const letters = word.split('');
  const glyphs: Glyph[] = c.pending.map((group, i) => ({ group, letter: letters[i] ?? null, typed: true }));
  for (let i = c.pending.length; i < letters.length; i++) {
    const g = groupOf(letters[i]);
    if (g) glyphs.push({ group: g, letter: letters[i], typed: false });
  }
  return glyphs;
}

export function reduce(c: Composition, event: ComposerEvent, context: readonly string[] = []): Composition {
  switch (event.type) {
    case 'group':
      return { ...c, pending: [...c.pending, event.group], candidateIndex: 0, reopened: false };
    case 'next': {
      const count = candidates(c, context).length;
      return count ? { ...c, candidateIndex: (c.candidateIndex + 1) % count, reopened: false } : c;
    }
    case 'accept': {
      if (!c.pending.length) return c;
      const candidate = currentCandidate(c, context);
      const word: Word = candidate
        ? { text: candidate.word, groups: c.pending, candidateIndex: c.candidateIndex, source: 'decoded' }
        : { text: c.pending.join('·'), groups: c.pending, candidateIndex: 0, source: 'unresolved' };
      return { words: [...c.words, word], pending: [], candidateIndex: 0, reopened: false };
    }
    case 'delete': {
      if (c.reopened) return { ...c, pending: [], candidateIndex: 0, reopened: false };
      if (c.pending.length) return { ...c, pending: c.pending.slice(0, -1), candidateIndex: 0 };
      const last = c.words[c.words.length - 1];
      if (!last) return c;
      const words = c.words.slice(0, -1);
      if (last.source !== 'decoded') return { ...c, words, reopened: false };
      const count = candidates({ ...c, pending: last.groups }, context).length;
      const next = count > 1 ? (last.candidateIndex + 1) % count : 0;
      return { words, pending: last.groups, candidateIndex: next, reopened: true };
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
