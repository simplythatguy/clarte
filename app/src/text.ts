import type { CSSProperties } from 'react';

/**
 * Sentence case for display and speech. The decoder works in lower case; the person's words are
 * shown and spoken as a sentence: first word capitalised, and "i" as "I".
 */
export function displayWord(word: string, index: number): string {
  const w = word.replace(/^i(?=$|')/, 'I');
  return index === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

export function sentence(text: string): string {
  return text.split(/\s+/).filter(Boolean).map(displayWord).join(' ');
}

/** Card labels size by their longest word, so large text grows until that word fills the card. */
export function longest(text: string): CSSProperties {
  return { ['--len' as string]: Math.max(...text.split(/\s+/).map((w) => w.length)) };
}
