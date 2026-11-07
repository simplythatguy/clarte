/**
 * Whole-reply suggestion stub for style 5.
 *
 * A stand-in rule table maps the partner's last turn to one short reply. The language-model
 * teammate replaces the table; the contract stays `suggestReply(partnerText): string | null`.
 */

type Rule = { starts: readonly string[]; reply: string };

const RULES: readonly Rule[] = [
  { starts: ['how are'], reply: "I'm okay, thanks" },
  { starts: ['do you want', 'shall we'], reply: 'Yes, please' },
  { starts: ['are you'], reply: 'Yes' },
];

/** Leading words that do not change what the question asks ("Hey, how are you…"). */
const OPENERS = /^(?:(?:hey|hi|hello|so|and|oh|okay|ok|well|right)[,!]?\s+)+/;

function questions(text: string): string[] {
  return (text.match(/[^.?!]*\?/g) ?? []).map((q) => q.trim().toLowerCase().replace(OPENERS, ''));
}

export function suggestReply(partnerText: string): string | null {
  for (const question of questions(partnerText).reverse()) {
    const rule = RULES.find((r) => r.starts.some((s) => question.startsWith(s)));
    if (rule) return rule.reply;
  }
  return null;
}
