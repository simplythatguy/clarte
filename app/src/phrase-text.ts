/** Phrase suggestions and their accepted draft use the same punctuation-free wording. */
export function phraseText(text: string): string {
  return text.replace(/(\d)\.(?=\d)/g, '$1 point ')
    .replace(/[\p{Pd}\p{Pc}]/gu, ' ')
    .replace(/\p{P}/gu, '').replace(/\s+/g, ' ').trim();
}
