/**
 * Reactions (owner, 2026-11-07): certain words and sentences get a face. Style 7 has eighteen:
 * seven positive, seven negative and four neutral (the owner asked for more than the first eight).
 *
 * A stand-in for the language model, like the Zipf decoder: a cue lexicon, a three-word negation
 * window and these rules.
 *
 * - Statements react. A question asks rather than tells, so only surprise and confusion react to
 *   one ("Really?", "What do you mean?"); "Did you sleep at all?" stays quiet.
 * - Within a sentence the most specific feeling wins (PRIORITY): "Thanks, but my head hurts" is hurt.
 * - Across sentences the last one that reacts wins, because it is the latest feeling.
 * - A negated cue turns over: a negated positive is sad ("not good"), a negated negative or
 *   neutral is calm ("not worried", "no pain", "not hungry"). "Not bad" is calm.
 * - A calm cue that ends in "!" is joy ("Good!").
 */
export type ReactionKind =
  | 'calm' | 'joy' | 'love' | 'laugh' | 'excited' | 'proud' | 'silly'
  | 'sad' | 'hurt' | 'tired' | 'worried' | 'angry' | 'sick' | 'cold'
  | 'surprised' | 'curious' | 'confused' | 'hungry';

export const POSITIVE: readonly ReactionKind[] = ['calm', 'joy', 'love', 'laugh', 'excited', 'proud', 'silly'];
export const NEGATIVE: readonly ReactionKind[] = ['sad', 'hurt', 'tired', 'worried', 'angry', 'sick', 'cold'];
export const NEUTRAL: readonly ReactionKind[] = ['surprised', 'curious', 'confused', 'hungry'];

/** Most specific first: the first kind found in a sentence is its reaction. */
const PRIORITY: ReactionKind[] = [
  'hurt', 'sick', 'tired', 'cold', 'hungry', 'worried', 'angry', 'sad', 'confused', 'surprised',
  'love', 'proud', 'excited', 'laugh', 'silly', 'joy', 'curious', 'calm',
];

/** The kinds a question may still show. */
const IN_QUESTIONS = new Set<ReactionKind>(['surprised', 'confused']);

const CUES: Record<ReactionKind, string[]> = {
  hurt: ['hurt', 'hurts', 'hurting', 'pain', 'painful', 'ache', 'aches', 'aching', 'sore', 'ouch', 'headache', 'backache', 'cramp', 'cramps', 'itchy'],
  sick: ['sick', 'nauseous', 'nausea', 'dizzy', 'unwell', 'fever', 'vomit', 'throw up', 'flu', 'ill'],
  tired: ['tired', 'exhausted', 'sleepy', 'drowsy', 'worn out', 'no sleep', "can't sleep", "couldn't sleep", "didn't sleep", 'barely slept', 'yawn', 'need a nap'],
  cold: ['cold', 'freezing', 'chilly', 'shivering', 'frozen', 'blanket'],
  hungry: ['hungry', 'starving', 'thirsty', 'peckish', 'eat', 'food', 'lunch', 'dinner', 'breakfast', 'snack', 'a drink', 'some water', 'tea', 'coffee'],
  worried: ['worried', 'worry', 'worrying', 'scared', 'afraid', 'nervous', 'anxious', 'frightened', 'oh no', 'panic', 'emergency'],
  angry: ['angry', 'annoyed', 'frustrated', 'furious', 'mad', 'cross', 'hate', 'irritated', 'fed up', 'ugh'],
  sad: ['sad', 'sorry', 'unhappy', 'upset', 'lonely', 'cry', 'crying', 'miserable', 'terrible', 'awful', 'horrible', 'bad', 'bad news', 'died', 'passed away', 'disappointed', 'miss'],
  confused: ['confused', 'confusing', 'huh', 'what do you mean', "don't understand", "don't get it", 'pardon', 'lost me'],
  surprised: ['wow', 'whoa', 'no way', 'surprise', 'surprised', 'omg', 'oh my', 'unbelievable', 'shocked'],
  love: ['love', 'loved', 'lovely', 'adore', 'miss you', 'beautiful', 'sweetheart', 'darling', 'hug', 'hugs'],
  proud: ['proud', 'i did it', 'did it', 'well done', 'nailed it', 'managed', 'achieved', 'finally'],
  excited: ['excited', 'exciting', "can't wait", 'yay', 'woohoo', "let's go", 'hooray'],
  laugh: ['haha', 'hahaha', 'ha ha', 'lol', 'funny', 'hilarious', 'laughing'],
  silly: ['silly', 'joke', 'joking', 'kidding', 'cheeky', 'tease', 'teasing', 'goofy'],
  joy: ['great', 'wonderful', 'amazing', 'awesome', 'fantastic', 'happy', 'glad', 'excellent', 'perfect', 'sunny', 'congratulations', 'congrats', 'brilliant', 'good news', 'delicious', 'fun'],
  curious: ['curious', 'wonder', 'wondering', 'hmm', 'interesting', 'maybe', 'perhaps', 'what if'],
  calm: ['thanks', 'thank you', 'okay', 'ok', 'fine', 'good', 'nice', 'alright', 'all right', 'better', 'relaxed', 'comfortable', 'cozy', 'calm', 'no problem', 'no worries', 'not bad'],
};

/** Phrase (space-joined tokens) → kind. Longer phrases are tried first. */
const LEXICON = new Map<string, ReactionKind>();
for (const kind of PRIORITY) for (const cue of CUES[kind]) if (!LEXICON.has(cue)) LEXICON.set(cue, kind);
const LONGEST = Math.max(...[...LEXICON.keys()].map((k) => k.split(' ').length));

const NEGATORS = new Set(['not', 'no', 'never', 'without', 'hardly', 'nothing', 'nobody']);
const negates = (token: string) => NEGATORS.has(token) || token.endsWith("n't");

const flip = (kind: ReactionKind): ReactionKind => (POSITIVE.includes(kind) ? 'sad' : 'calm');

function sentenceReaction(sentence: string, question: boolean): ReactionKind | null {
  const tokens = sentence.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z']+/g) ?? [];
  const found = new Set<ReactionKind>();
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(LONGEST, tokens.length - i); n >= 1; n--) {
      const phrase = tokens.slice(i, i + n).join(' ');
      let kind = LEXICON.get(phrase);
      if (!kind) continue;
      // A phrase that carries its own negation ("didn't sleep", "not bad") is already resolved.
      const selfNegated = n > 1 && negates(tokens[i]);
      if (!selfNegated && tokens.slice(Math.max(0, i - 3), i).some(negates)) kind = flip(kind);
      found.add(kind);
      i += n - 1;
      break;
    }
  }
  // A one-word echo question ("Really?", "Seriously?") is surprise.
  if (question && tokens.length === 1 && ['really', 'seriously', 'what'].includes(tokens[0])) found.add(tokens[0] === 'what' ? 'confused' : 'surprised');
  const kind = PRIORITY.find((k) => found.has(k) && (!question || IN_QUESTIONS.has(k))) ?? null;
  return kind === 'calm' && sentence.trim().endsWith('!') ? 'joy' : kind;
}

/** The reaction a turn's text earns, or null when it says nothing a face should answer. */
export function reactionFor(text: string): ReactionKind | null {
  let last: ReactionKind | null = null;
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (!s.trim()) continue;
    last = sentenceReaction(s, s.trim().endsWith('?')) ?? last;
  }
  return last;
}
