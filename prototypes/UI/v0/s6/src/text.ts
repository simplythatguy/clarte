import type { CSSProperties } from 'react';

/** A word as the decoder keys it (lower case) with, when the engine sent one, the form it is written in. */
export type Shown = { text: string; display?: string };

/**
 * How a word reads in the sentence, on a card, in the message and in speech. The decoder works in
 * lower case; the engine's `display` field (CONTRACT.md round 4) carries the written form of a
 * name or an acronym ("Priya", "NHS"). Without it, the old rule holds: "i" is "I", and the first
 * word of the message takes a capital.
 */
export function displayWord(word: string, index: number, display?: string): string {
  const w = display && display.toLowerCase() === word.toLowerCase() ? display : word.replace(/^i(?=$|')/, 'I');
  return index === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/** The message as it is spoken and shown: every word in its display form, sentence case. */
export function sentenceOf(words: readonly Shown[]): string {
  return words.map((w, i) => displayWord(w.text, i, w.display)).join(' ');
}

/** Sentence case for plain text (debug and tests), with no display forms. */
export function sentence(text: string): string {
  return text.split(/\s+/).filter(Boolean).map((w, i) => displayWord(w, i)).join(' ');
}

/** Card labels size by their longest word, so large text grows until that word fills the card. */
export function longest(text: string): CSSProperties {
  return { ['--len' as string]: Math.max(...text.split(/\s+/).map((w) => w.length)) };
}
