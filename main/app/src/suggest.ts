/**
 * The suggested reply in Q4 after the partner speaks: one selection puts it in the composer, never speaks it
 * (BRIEF: no suggestion inserted without a selection).
 *
 * A suggestion is only ever a social formula, never an answer about the person (NAT-53). The stub this
 * replaces answered "Yes" to any "are you…?" and "Yes, please" to any "do you want…?", so "Are you in pain?"
 * put "Yes" on the most prominent card. Now:
 *
 *  - A greeting gets a greeting back ("Good morning" → "Good morning", "Hi" → "Hello").
 *  - Thanks gets "You're welcome"; a goodbye gets a goodbye.
 *  - The bare social "How are you?" (doing, today, how's it going) keeps "I'm okay, thanks". "How are you
 *    feeling?", "How is your back?" and any other question about the person get nothing.
 *  - A turn with any other question gets nothing: yes or no, what, when, which. The answer is the person's.
 *
 * The contract stays `suggestReply(partnerText): string | null`.
 */

/** Leading words that do not change what is said ("Hey, how are you…", "Okay, bye"). */
const OPENERS = /^(?:(?:hey|hi|hello|so|and|oh|okay|ok|well|right|alright)\b[,!.]?\s*)+/;

/** The social "how are you": asks after nothing in particular, and expects the formula back. */
const SMALL_TALK = /^(?:how are you(?: doing)?(?: today| this morning| this afternoon| this evening)?|how's it going|how is it going|how are things|how have you been)$/;

const GREETINGS: [RegExp, string][] = [
  [/^(?:good )?morning\b/, 'Good morning'],
  [/^good afternoon\b/, 'Good afternoon'],
  [/^good evening\b/, 'Good evening'],
  [/^(?:hi|hello|hey)(?: there)?\b/, 'Hello'],
];

/** The turn's sentences, lower case, with their end marks. */
function sentencesOf(text: string): { text: string; question: boolean }[] {
  return (text.replace(/’/g, "'").match(/[^.?!]+[.?!]*/g) ?? [])
    .map((s) => ({ text: s.trim().toLowerCase(), question: s.trim().endsWith('?') }))
    .filter((s) => s.text.replace(/[.?!,\s]/g, ''));
}

const bare = (s: string) => s.replace(/[.?!,]+$/g, '').trim();

export function suggestReply(partnerText: string): string | null {
  const sentences = sentencesOf(partnerText);
  if (!sentences.length) return null;
  // Any question but the social "how are you" is the person's to answer.
  const asks = sentences.filter((s) => s.question);
  if (asks.some((s) => !SMALL_TALK.test(bare(s.text).replace(OPENERS, '')))) return null;
  const words = sentences.map((s) => bare(s.text)).join(' ');
  if (/\b(?:bye|goodbye|see you|talk to you later|take care)\b/.test(words)) return 'Bye, see you soon';
  if (/\bgood night\b/.test(words)) return 'Good night';
  if (/\b(?:thank you|thanks)\b/.test(words)) return "You're welcome";
  if (asks.length) return "I'm okay, thanks";
  // A greeting on its own, or with a name ("Morning, Sam"); not the start of news ("Hi, the doctor called").
  if (sentences.length === 1) {
    for (const [pattern, reply] of GREETINGS) {
      const rest = words.replace(pattern, '').replace(/[,!.]/g, ' ').trim();
      if (pattern.test(words) && rest.split(/\s+/).filter(Boolean).length <= 1) return reply;
    }
  }
  return null;
}
