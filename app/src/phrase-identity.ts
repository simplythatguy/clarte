import { phraseText } from './phrase-text.ts';

/** Conservative entry equivalence, not fuzzy matching or semantic intent classification. */
export function phraseIdentity(text: string): string {
  let clean = phraseText(text.normalize('NFKC').replace(/\s+/gu, ' ')
    .replace(/[,;:!?]/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' '))
    .toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  // Only phrase-leading contractions; "he lets go" must retain its different meaning.
  clean = clean.replace(/^(?:im|i m)\b/, 'i am').replace(/^(?:lets|let s)\b/, 'let us');
  // Bounded colloquial forms of this exact question, not global u/2 substitutions.
  if (/^what do (?:you|u) (?:want to|wanna|want 2) get$/.test(clean)) clean = 'what do you want to get';
  return clean;
}
