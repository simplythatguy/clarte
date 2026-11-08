/**
 * Unit tests for the two top cards' policy (`src/policy.ts`), one per branch of the Q4 priority
 * order and the Q1 rule, plus the reducer paths they rely on (Delete word paging, Done → Speak,
 * hearing → turn). Run with: node prototypes/UI/v0/s6/scripts/test-policy.ts
 *
 * The policy imports only types from the app, so this runs in Node without the browser, the
 * engine or the lexicon.
 */
import { EMPTY_COMPOSITION, type Composition } from '../../shared/composer.ts';
import { signatureOf } from '../../shared/decoder.ts';
import { CHOOSER_PAGE, INITIAL_STATE, chooserCode, chooserRequestOf, phaseOf, reducer, requestOf, type State } from '../src/model.ts';
import { conflictOf, nextWordIndex, primaryFor, primaryKey, secondaryFor, secondaryKey } from '../src/policy.ts';
import { conflictFor } from '../src/conflict.ts';
import type { Prediction } from '../src/prediction.ts';
import { canFollow, nextWordsOf, predictLocal } from '../src/local.ts';
import { displayWord, sentenceOf } from '../src/text.ts';
import { rankLetters } from '../src/spell.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const message = (words: string[]): Composition => ({
  words: words.map((text) => ({ text, groups: signatureOf(text), candidateIndex: 0, source: 'decoded' as const })),
  pending: [], candidateIndex: 0, reopened: false,
});
const typing = (c: Composition, word: string): Composition => ({ ...c, pending: signatureOf(word), candidateIndex: 0, reopened: false });

const talk: State = {
  ...INITIAL_STATE,
  screen: { kind: 'talk' },
  turns: [{ id: 1, who: 'partner', text: 'Do you want to go outside for a bit?' }],
  nextId: 2,
};
const pred = (words: [string, number, boolean][], extra: Partial<Prediction> = {}): Prediction => ({
  words: words.map(([word, p, complete]) => ({ word, p, complete })),
  total: words.length, longer: 0, offset: 0, source: 'engine', ...extra,
});
const NEXT = pred([['yes', 0.3, true], ['i', 0.2, true], ['no', 0.1, true]]);
const COMPLETION = pred([['outside', 0.6, true], ['outstanding', 0.2, false]], { longer: 0.2 });
const BRANCH = pred([['might', 0.42, true], ['night', 0.31, true], ['mighty', 0.06, false]], { longer: 0.1 });
const NONE = pred([], { total: 0 });

// ── Q1: always the predicted word ──
check('Q1 idle: the next word of an empty message', same(primaryFor(talk, NEXT), { kind: 'word', word: 'yes', rank: 0, complete: true }));
check('Q1 while the partner is being heard: still the next word', primaryFor({ ...talk, hearing: 'It is' }, NEXT).kind === 'word');
check('Q1 typing: the completion', same(primaryFor({ ...talk, composition: typing(message(['i', 'would', 'love', 'to', 'go']), 'outs') }, COMPLETION), { kind: 'word', word: 'outside', rank: 0, complete: true }));
check('Q1 reopened: the candidate at the engine offset carries its rank', primaryFor({ ...talk, composition: { ...message(['i']), pending: signatureOf('go'), candidateIndex: 2, reopened: true } }, { ...NEXT, offset: 2 }).kind === 'word'
  && (primaryFor({ ...talk, composition: { ...message(['i']), pending: signatureOf('go'), candidateIndex: 2, reopened: true } }, { ...NEXT, offset: 2 }) as { rank: number }).rank === 2);
check('Q1 no match, nothing one digit off either: Spell', same(primaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, NONE), { kind: 'spell' }));
check('Q1 no match with a correction: the corrected word, marked slip', same(primaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, { ...NONE, fallback: { word: 'suzy', kind: 'corrected' } }), { kind: 'word', word: 'suzy', rank: 0, complete: false, slip: true }));
check('Q1 no match with only a prefix word: Spell, not the prefix word', primaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'thexxxx') }, { ...NONE, fallback: { word: 'the', kind: 'prefix' } }).kind === 'spell');
check('Q1 fallback only while groups are pending', primaryFor(talk, { ...NONE, fallback: { word: 'the', kind: 'prefix' } }).kind === 'no-match');
// Round 4: the word just accepted is never offered as the next word (the engine's echo, "hello hello").
const hello: State = { ...talk, composition: message(['hello']) };
const ECHO = pred([['hello', 0.5, true], ['how', 0.3, true], ['there', 0.1, true]]);
check('Q1 never repeats the word just accepted: the next distinct word, with its rank', same(primaryFor(hello, ECHO), { kind: 'word', word: 'how', rank: 1, complete: true }));
check('the repeat guard is case-blind', nextWordIndex({ ...talk, composition: message(['Hello']) }, ECHO) === 1);
check('the repeat guard leaves a one-word answer alone (Q1 is never empty)', primaryFor(hello, pred([['hello', 1, true]])).kind === 'word');
check('the repeat guard does not apply while typing (typing the code again is deliberate)', same(primaryFor({ ...talk, composition: typing(message(['no']), 'no') }, pred([['no', 0.99999, true], ['on', 0.000001, true]])), { kind: 'word', word: 'no', rank: 0, complete: true }));
{
  const named = primaryFor(talk, { ...NEXT, words: [{ word: 'priya', p: 0.9, complete: false, display: 'Priya' }] });
  check('Q1 carries the engine\'s display form', named.kind === 'word' && named.word === 'priya' && named.display === 'Priya' && named.rank === 0);
}
check('a corrected word on the first page shows in Q1 and is marked a slip', (primaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, { ...pred([['suzy', 0.7, false]]), words: [{ word: 'suzy', p: 0.7, complete: false, corrected: true }] }) as { slip?: boolean }).slip === true);
check('display: a name keeps its capital mid-sentence; the first word takes one', displayWord('priya', 3, 'Priya') === 'Priya' && displayWord('i', 2) === 'I' && displayWord('hello', 0) === 'Hello');
check('display: a display form for another word is ignored', displayWord('will', 1, 'Priya') === 'will');
check('the spoken sentence uses display forms', sentenceOf([{ text: 'is' }, { text: 'priya', display: 'Priya' }, { text: 'here' }]) === 'Is Priya here');
check('the reducer stores the display form on the accepted word', (reducer(talk, { type: 'accept', word: 'priya', rank: 0, display: 'Priya' }).composition.words[0] as { display?: string }).display === 'Priya');
const speakingState: State = { ...talk, live: { kind: 'speaking', text: 'I would love to go', word: 0, turnId: null, token: 1, draft: message(['i', 'would', 'love', 'to', 'go']) } };
check('Q1 speaking: Stop', same(primaryFor(speakingState, NEXT), { kind: 'stop-speaking' }));

// ── Q4: the priority order, one check per branch ──
check('Q4 1. speaking: unavailable', same(secondaryFor(speakingState, NEXT), { kind: 'unavailable' }));
check('Q4 1. speaking beats pending groups', same(secondaryFor({ ...speakingState, composition: typing(EMPTY_COMPOSITION, 'mi') }, BRANCH), { kind: 'unavailable' }));
const branching: State = { ...talk, composition: typing(message(['i']), 'might') };
check('Q4 2. two close words: the second word, ranked', same(secondaryFor(branching, BRANCH), { kind: 'second', word: 'night', rank: 1 }));
check('Q4 2. the branch is reported', same(conflictOf(branching, BRANCH), { first: 'might', second: 'night' }));
check('Q4 2. not from one group', secondaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'm') }, BRANCH).kind === 'delete');
check('Q4 2. not when the second is far behind', secondaryFor(branching, pred([['might', 0.6, true], ['night', 0.2, true]])).kind === 'delete');
check('Q4 2. not when longer words carry the mass', secondaryFor(branching, pred([['might', 0.3, true], ['night', 0.25, true]], { longer: 0.4 })).kind === 'delete');
check('Q4 2. not when the second is not whole', secondaryFor(branching, pred([['might', 0.4, true], ['mighty', 0.3, false]])).kind === 'delete');
check('Q4 2. not past the first page', secondaryFor(branching, { ...BRANCH, offset: 1 }).kind === 'delete');
check('Q4 2. the engine says branch: the second word, whatever the local rule thinks', same(secondaryFor(branching, pred([['might', 0.6, true], ['night', 0.2, true]], { branch: true })), { kind: 'second', word: 'night', rank: 1 }));
check('Q4 2. the engine says no branch: Delete, whatever the local rule thinks', secondaryFor(branching, { ...BRANCH, branch: false }).kind === 'delete');
check('Q4 2. the engine\'s branch is not read on a later page', conflictFor({ ...BRANCH, branch: true, offset: 1 }, 5) === null);
check('Q4 2. the engine\'s branch needs two words', conflictFor(pred([['might', 1, true]], { branch: true }), 5) === null);
check('Q4 2. a local answer with a branch flag still uses the local rule', conflictFor({ ...pred([['might', 0.6, true], ['night', 0.2, true]]), source: 'local', branch: true }, 5) === null);
check('Q4 2. not when the best word is not whole, even if two whole words follow', secondaryFor(branching, pred([['mighty', 0.4, false], ['might', 0.3, true], ['night', 0.25, true]])).kind === 'delete');
check('Q4 2. not when the first word is unsure (p below 0.2, the engine\'s round-3 rule)', secondaryFor(branching, pred([['might', 0.15, true], ['night', 0.12, true]])).kind === 'delete');
check('Q4 2. not on a slip page (corrected words)', secondaryFor(branching, { ...pred([['might', 0.4, true], ['night', 0.3, true]]), words: [{ word: 'might', p: 0.4, complete: true, corrected: true }, { word: 'night', p: 0.3, complete: true }] }).kind === 'delete');
check('Q4 2. the second word carries its display form', (secondaryFor(branching, { ...BRANCH, words: [BRANCH.words[0], { ...BRANCH.words[1], display: 'Night' }, BRANCH.words[2]] }) as { display?: string }).display === 'Night');
check('Q4 2. not after a reopen', secondaryFor({ ...branching, composition: { ...branching.composition, reopened: true, candidateIndex: 1 } }, BRANCH).kind === 'delete');

// ── Q1 exact length first (owner, 2026-11-08: "the" typed in full showed "what") ──
const theTyped: State = { ...talk, composition: typing(message([]), 'the') };
const WHAT_THE = pred([['what', 0.764, false], ['the', 0.122, true], ['where', 0.026, false]], { branch: false });
check('Q1 exact length first: "the" typed in full shows the, not what', same(primaryFor(theTyped, WHAT_THE), { kind: 'word', word: 'the', rank: 1, complete: true }));
check('Q1 exact length first: not when the whole word is under 3% of the completion', (primaryFor(theTyped, pred([['what', 0.9, false], ['the', 0.02, true]], { branch: false })) as { word?: string }).word === 'what');
check('Q1 exact length first: a slip correction is never preferred', (primaryFor(theTyped, { ...WHAT_THE, words: [WHAT_THE.words[0], { ...WHAT_THE.words[1], corrected: true }] }) as { word?: string }).word === 'what');
check('Q1 exact length first: not after a reopen (Delete word pages the ranking)', (primaryFor({ ...theTyped, composition: { ...theTyped.composition, reopened: true, candidateIndex: 1 } }, WHAT_THE) as { word?: string }).word === 'what');

// ── Q1 Spell: no dictionary word fits and none is one slip away (owner, 2026-11-08: polyphiloprogenitive) ──
const unknown: State = { ...talk, composition: typing(message([]), 'polyphiloprogenitive') };
check('Q1 Spell: nothing matches and the only fallback is a word for a shorter prefix', primaryFor(unknown, { ...pred([]), total: 0, fallback: { word: 'private', kind: 'prefix' } }).kind === 'spell');
check('Q1 Spell: nothing matches and there is no fallback at all', primaryFor(unknown, { ...pred([]), total: 0 }).kind === 'spell');
check('Q1 Spell: not while a healthy engine is still answering (the local decoder\'s lexicon is smaller): No word until it does', primaryFor(unknown, { ...pred([]), total: 0, source: 'local', provisional: true }).kind === 'no-match');
check('Q1 Spell: a one-slip correction is still offered as the word', (primaryFor(unknown, { ...pred([]), total: 0, fallback: { word: 'please', kind: 'corrected' } }) as { word?: string }).word === 'please');
check('Q1 Spell: phase', phaseOf(unknown, { ...pred([]), total: 0, fallback: { word: 'private', kind: 'prefix' } }) === 'composing-spell');
check('Q1 Spell: phase of the open page', phaseOf({ ...unknown, screen: { kind: 'spell', letters: 'po', page: 0 } }, pred([])) === 'spell');
{
  const g = signatureOf('polyphiloprogenitive');
  const ranks = [...'polyphiloprogenitive'].map((ch, i) => rankLetters('polyphiloprogenitive'.slice(0, i), g).indexOf(ch));
  check('Spell: every letter is among its group\'s letters, ranked', ranks.every((r) => r >= 0), ranks.join(','));
  check('Spell: most letters are first or second (letter model)', ranks.filter((r) => r <= 1).length >= 16, ranks.join(','));
  check('Spell: no letters past the last group', rankLetters('polyphiloprogenitive', g).length === 0);
}

// ── Q1 Options: several whole words fit and none is close enough to branch on (owner, 2026-11-08) ──
const hosting: State = { ...talk, composition: typing(message(['computer', 'science', 'is']), 'hosting') };
const AMBIGUOUS = pred([['growing', 0.9998, true], ['hosting', 0.00024, true], ['issuing', 0.0001, true]], { branch: false });
check('Q1 Options: growing and hosting share the code, the engine is sure of neither branch', primaryFor(hosting, AMBIGUOUS).kind === 'options');
check('Q1 Options: Q4 stays Delete', secondaryFor(hosting, AMBIGUOUS).kind === 'delete');
check('Q1 Options: phase', phaseOf(hosting, AMBIGUOUS) === 'composing-options');
check('Q1 Options: not when the second whole word is far below 1e-4 of the first', primaryFor(hosting, pred([['growing', 0.99999, true], ['hosting', 0.00000005, true]], { branch: false })).kind === 'word');
check('Q1 Options: not when the second word is not whole (typing more decides)', primaryFor(hosting, pred([['growing', 0.6, true], ['growingly', 0.3, false]], { branch: false })).kind === 'word');
check('Q1 Options: also when the exact-length word Q1 would show has a whole-word rival further down (the hero / less)', primaryFor(hosting, pred([['message', 0.44, false], ['happy', 0.22, false], ['less', 0.056, true], ['hero', 0.047, true]], { branch: false })).kind === 'options');
check('Q1 Options: not when a longer completion is shown and no whole word is near it', primaryFor(hosting, pred([['grow', 0.9, false], ['growing', 0.02, true], ['hosting', 0.0001, true]], { branch: false })).kind === 'word');
check('Q1 Options: the next whole word below the exact-length word at 1% of it (round 4)', primaryFor(hosting, pred([['grow', 0.9, false], ['growing', 0.05, true], ['hosting', 0.04, true]], { branch: false })).kind === 'options');
check('Q1 Options: not when the only whole word is the one shown', primaryFor(hosting, pred([['message', 0.44, false], ['less', 0.3, true], ['happy', 0.2, false]], { branch: false })).kind === 'word');
check('Q1 Options: not when the engine branches (Q4 offers the second word)', primaryFor(branching, BRANCH).kind === 'word' && secondaryFor(branching, BRANCH).kind === 'second');
check('Q1 Options: not with nothing typed', primaryFor({ ...talk, composition: message(['computer', 'science', 'is']) }, AMBIGUOUS).kind === 'word');
check('Q1 Options: not after a reopen', primaryFor({ ...hosting, composition: { ...hosting.composition, reopened: true, candidateIndex: 1 } }, AMBIGUOUS).kind === 'word');
check('Q1 Options: not on a slip page', primaryFor(hosting, { ...AMBIGUOUS, words: AMBIGUOUS.words.map((w) => ({ ...w, corrected: true })) }).kind === 'word');
check('Q1 Options: the chooser asks for whole words of the typed code, the message unchanged', (() => { const r = chooserRequestOf({ ...hosting, screen: { kind: 'other', page: 1, pending: true } }, 1); return r.groups === '2334222' && r.complete === true && r.offset === CHOOSER_PAGE && r.message.join(' ') === 'computer science is'; })());
check('Q1 Options: phase of the open page', phaseOf({ ...hosting, screen: { kind: 'other', page: 0, pending: true } }, AMBIGUOUS) === 'options');
check('Q4 3. groups pending: Delete', same(secondaryFor({ ...talk, composition: typing(message(['i']), 'outs') }, COMPLETION), { kind: 'delete', word: false }));
check('Q4 3. reopened: Delete word', same(secondaryFor({ ...talk, composition: { ...message(['i']), pending: signatureOf('go'), candidateIndex: 1, reopened: true } }, NEXT), { kind: 'delete', word: true }));
check('Q4 3. pending while the partner is heard: still Delete', secondaryFor({ ...talk, hearing: 'It is', composition: typing(EMPTY_COMPOSITION, 'outs') }, COMPLETION).kind === 'delete');
check('Q4 3. pending with no match: still Delete', secondaryFor({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, NONE).kind === 'delete');
check('Q4 4. words and nothing pending: Done', same(secondaryFor({ ...talk, composition: message(['i', 'would']) }, NEXT), { kind: 'done' }));
check('Q4 4. Done even in the Say again window', secondaryFor({ ...talk, live: { kind: 'spoken', turnId: 1 }, composition: message(['yes']) }, NEXT).kind === 'done');
check('Q4 5. just spoken, message empty: Say again', same(secondaryFor({ ...talk, live: { kind: 'spoken', turnId: 7 } }, NEXT), { kind: 'say-again', turnId: 7 }));
check('Q4 6. message empty: Menu', same(secondaryFor(talk, NEXT), { kind: 'menu' }));
check('Q4 6. message empty while the partner is heard: Menu', secondaryFor({ ...talk, hearing: 'It is' }, NEXT).kind === 'menu');

// ── Keys: a label holds while gaze rests only when its identity is unchanged ──
check('keys distinguish words', secondaryKey({ kind: 'second', word: 'night', rank: 1 }) !== secondaryKey({ kind: 'second', word: 'might', rank: 0 }));
check('keys distinguish Delete from Delete word', secondaryKey({ kind: 'delete', word: false }) !== secondaryKey({ kind: 'delete', word: true }));
check('primary keys name the word', primaryKey({ kind: 'word', word: 'yes', rank: 0, complete: true }) === 'word:yes');

// ── Reducer paths the cards rely on ──
let s = reducer({ ...talk, composition: message(['i', 'would', 'love', 'to', 'go']) }, { type: 'screen', screen: { kind: 'done' } });
check('Done page phase', phaseOf(s, NEXT) === 'done');
s = reducer(s, { type: 'delete' });
check('Delete word from Done reopens the last word one place on', s.composition.reopened && s.composition.candidateIndex === 1 && same(s.composition.pending, signatureOf('go')) && s.composition.words.length === 4);
check('reopened Q4 is Delete word', secondaryFor({ ...s, screen: { kind: 'talk' } }, { ...NEXT, offset: 1 }).kind === 'delete');
s = reducer(s, { type: 'accept', word: 'to', rank: 1 });
check('accepting the next candidate remembers its rank', s.composition.words[4].candidateIndex === 1 && s.composition.words[4].text === 'to');
s = reducer(s, { type: 'delete' });
check('Delete word again pages to the third candidate', s.composition.candidateIndex === 2 && s.composition.reopened);
s = reducer(s, { type: 'delete' });
check('a second Delete straight after a reopen removes the word', s.composition.pending.length === 0 && s.composition.words.length === 4 && !s.composition.reopened);

// A slip word remembers its own code, so Delete word and Other words reopen what was said.
s = reducer({ ...talk, composition: { ...EMPTY_COMPOSITION, pending: ['G3', 'G4', 'G3', 'G4'] } }, { type: 'accept', word: 'suzy', rank: 0 });
check('accepting a corrected word stores the word\'s own code', same(s.composition.words[0].groups, signatureOf('suzy')) && s.composition.pending.length === 0);
s = reducer({ ...talk, composition: { ...EMPTY_COMPOSITION, pending: signatureOf('thexxxxxx') } }, { type: 'accept', word: 'the', rank: 0 });
check('accepting a prefix word stores its own, shorter code', same(s.composition.words[0].groups, signatureOf('the')));
s = reducer({ ...talk, composition: typing(message(['i']), 'outs') }, { type: 'accept', word: 'outside', rank: 0 });
check('accepting a completion keeps the typed groups (unchanged)', s.composition.words[1].groups.length === 4);

// ── Other words (the chooser) ──
const ready: State = { ...talk, composition: message(['i', 'would', 'love', 'to', 'go']) };
check('the chooser reopens the last word\'s own code', chooserCode(ready) === '23');
const req0 = chooserRequestOf(ready, 0);
check('page 1 asks for exact-length words, three at a time, without the word itself in the message', req0.complete === true && req0.limit === CHOOSER_PAGE && req0.offset === 0 && req0.groups === '23' && same(req0.message, ['i', 'would', 'love', 'to']));
check('page 3 starts at offset 6 (three words a page)', chooserRequestOf(ready, 2).offset === 6);
check('the chooser code of an empty message is empty', chooserCode(talk) === '');
check('the chooser uses the groups typed for the last word, not its completion', chooserCode({ ...talk, composition: reducer({ ...talk, composition: typing(message(['i']), 'up') }, { type: 'accept', word: 'upstairs', rank: 0 }).composition }) === '43');
check('after a slip correction is accepted, the chooser uses the groups typed', chooserCode({ ...talk, composition: reducer({ ...talk, composition: typing(message([]), 'xyz') }, { type: 'accept', word: 'you', rank: 0 }).composition }) === '444');
s = reducer(ready, { type: 'screen', screen: { kind: 'other', page: 0 } });
check('the chooser phase', phaseOf(s, NEXT) === 'other-words');
s = reducer(s, { type: 'replace-word', word: 'no', rank: 1 });
check('picking replaces the last word and remembers its rank', s.composition.words.length === 5 && s.composition.words[4].text === 'no' && s.composition.words[4].candidateIndex === 1 && same(s.composition.words[4].groups, signatureOf('no')));
check('the earlier words are untouched', s.composition.words.slice(0, 4).map((w) => w.text).join(' ') === 'i would love to');
check('replacing with nothing to replace does nothing', reducer(talk, { type: 'replace-word', word: 'no', rank: 0 }) === talk);
s = reducer({ ...s, screen: { kind: 'talk' } }, { type: 'delete' });
check('Delete word after a replacement reopens the replacement one place on', s.composition.reopened && s.composition.candidateIndex === 2 && same(s.composition.pending, signatureOf('no')));

// Round 4: calibration remembers where it was opened from.
{
  const cal = reducer({ ...talk, screen: { kind: 'done' }, composition: message(['yes']) }, { type: 'screen', screen: { kind: 'calibration', step: 'position', from: { kind: 'done' } } });
  check('calibration keeps the screen it was opened from', cal.screen.kind === 'calibration' && cal.screen.from.kind === 'done' && cal.composition.words.length === 1);
  check('calibration phase names are unchanged', phaseOf(cal, NEXT) === 'calibrate-position');
}

s = reducer({ ...talk, hearing: 'see you at three', composition: message(['yes']) }, { type: 'speak-start', text: 'Yes', turnId: null, token: 3 });
check('speaking keeps what the partner was saying as a turn, empties the composer, returns to talk',
  s.turns.at(-1)?.text === 'see you at three' && s.hearing === '' && s.composition.words.length === 0 && s.screen.kind === 'talk' && s.live.kind === 'speaking');
s = reducer(s, { type: 'speak-end', token: 3 });
check('after speech: the message is a turn and Say again is offered', s.turns.at(-1)?.text === 'Yes' && s.live.kind === 'spoken' && secondaryFor(s, NEXT).kind === 'say-again');
check('Q1 after speech: the next word', primaryFor(s, NEXT).kind === 'word');
s = reducer(s, { type: 'group', group: 'G1' });
check('typing ends the Say again window', s.live.kind === 'quiet');

s = reducer({ ...talk, hearing: 'do you' }, { type: 'hearing', text: 'do you want' });
check('interim words update what is heard', s.hearing === 'do you want');
s = reducer(s, { type: 'heard', text: 'do you want tea' });
check('a final phrase becomes a partner turn', s.hearing === '' && s.turns.at(-1)?.text === 'do you want tea');
check('an empty final adds no turn', reducer(s, { type: 'heard', text: '  ' }).turns.length === s.turns.length);
check('hearing-ended keeps interim words as a turn', reducer({ ...s, hearing: 'and' }, { type: 'hearing-ended' }).turns.at(-1)?.text === 'and');

// ── The local fallback alone (round 4): the partner's turn counts, chains differ, nothing loops ──
{
  const chainFor = (text: string, n = 8): string[] => {
    let st: State = { ...talk, turns: [{ id: 1, who: 'partner', text }], nextId: 2 };
    const chain: string[] = [];
    for (let i = 0; i < n; i++) {
      const fn = primaryFor(st, predictLocal(requestOf(st)));
      if (fn.kind !== 'word') break;
      chain.push(fn.word);
      st = reducer(st, { type: 'accept', word: fn.word, rank: fn.rank });
    }
    return chain;
  };
  const chains = new Map(['Where would you like to go for dinner tonight?', 'Do you want tea or coffee?', 'Are you cold?', 'Hello'].map((t) => [t, chainFor(t)]));
  for (const [text, chain] of chains) {
    const adjacent = chain.some((w, i) => i > 0 && w === chain[i - 1]);
    const abab = chain.some((_, i) => i + 3 < chain.length && chain[i] === chain[i + 2] && chain[i + 1] === chain[i + 3]);
    const repeats = chain.length - new Set(chain).size;
    check(`fallback "${text}": eight words, no adjacent repeat, no ABAB, at most one word used twice`, chain.length === 8 && !adjacent && !abab && repeats <= 1, chain.join(' '));
    // Every step is a continuation the tables know, or a word of the partner's own turn.
    const partner = new Set(text.toLowerCase().match(/[a-z']+/g));
    const grounded = chain.every((w, i) => nextWordsOf(i === 0 ? null : chain[i - 1], i > 1 ? chain[i - 2] : null).includes(w) || partner.has(w));
    check(`fallback "${text}": every step is a known continuation or the partner's word`, grounded, chain.join(' '));
  }
  check('fallback: the chains differ between partner lines', new Set([...chains.values()].map((c) => c.join(' '))).size >= 2, [...chains.values()].map((c) => c.join(' ')).join(' | '));
  check('fallback "Are you cold?": the partner\'s word is in the first four', chains.get('Are you cold?')!.slice(0, 4).includes('cold'), chains.get('Are you cold?')!.join(' '));
  check('fallback: a partner word is placed only where the model allows it', canFollow('cold', 'not') && canFollow('dinner', 'for') && !canFollow('cold', 'i') && !canFollow('tea', 'not') && !canFollow('coffee', 'am'));
}

check('phase: slip', phaseOf({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, { ...NONE, fallback: { word: 'suzy', kind: 'corrected' } }) === 'composing-slip');
check('phase: no match is spell', phaseOf({ ...talk, composition: typing(EMPTY_COMPOSITION, 'suzy') }, NONE) === 'composing-spell');
check('phase: hearing', phaseOf({ ...talk, hearing: 'It is' }, NEXT) === 'hearing');
check('phase: hearing while typing', phaseOf({ ...talk, hearing: 'It is', composition: message(['yes']) }, NEXT) === 'hearing-typing');
check('phase: branch', phaseOf(branching, BRANCH) === 'composing-branch');
check('phase: ready', phaseOf({ ...talk, composition: message(['yes']) }, NEXT) === 'composing-ready');

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('policy ok');
