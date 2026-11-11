import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPhrases, STARTERS } from '../phrase-store.mjs';
import { INITIAL_STATE, reducer } from '../src/model.ts';
import { EMPTY_COMPOSITION, messageText } from '../src/core/composer.ts';
import { signatureOf } from '../src/core/decoder.ts';
import { completedPersonalPhrase, loadPhrases, phraseChoices, rankContextPhrases } from '../src/phrases.ts';
import { setEngine } from '../src/prediction/prediction.ts';
import { wordsNow } from '../src/useWords.ts';
import { slotsFor } from '../src/model.ts';
import { predictNextPhrases } from '../phrase-regression.mjs';
import { phraseText } from '../src/phrase-text.ts';

const dir = mkdtempSync(join(tmpdir(), 'clarte-phrases-'));
const path = join(dir, 'phrases.sqlite');
let db = openPhrases(path);
try {
  assert.equal(phraseText('“Hello, there!”'), 'Hello there');
  assert.equal(phraseText('Take 1.5 tablets.'), 'Take 1 point 5 tablets', 'decimal meaning survives removing punctuation');
  assert.equal(db.list().length, 8);
  const fresh = { ...INITIAL_STATE, screen: { kind: 'talk' as const } };
  assert.equal(phraseChoices(fresh).length, 3, 'starter suggestions exist before the API loads');
  assert.equal(slotsFor(fresh, wordsNow(fresh)).primary.kind, 'options', 'fresh conversation exposes the phrase chooser');
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    globalThis.fetch = async () => { throw new Error('offline'); };
    await loadPhrases();
    assert.equal(phraseChoices(fresh).length, 3, 'API failure retains usable starters');
  } finally { console.warn = originalWarn; }
  globalThis.fetch = async () => new Response(JSON.stringify(db.snapshot()));
  await loadPhrases();
  assert.equal(phraseChoices(fresh).length, 3, 'fresh SQLite without personal history still recommends phrases');
  assert.equal(phraseChoices({ ...fresh, settings: { ...fresh.settings, suggestions: false } }).length, 0);
  const speaking = { kind: 'speaking' as const, text: 'Hello.', word: 0, turnId: null, holder: false, token: 1, draft: null };
  const spoken = { ...INITIAL_STATE, live: { kind: 'spoken' as const, turnId: 1 }, turns: [{ id: 1, who: 'me' as const, text: 'Hello.' }] };
  assert.equal(completedPersonalPhrase(speaking, spoken), 'Hello.');
  assert.equal(completedPersonalPhrase({ kind: 'quiet' }, spoken), null, 'debug spoken frames cannot train');
  assert.equal(completedPersonalPhrase({ ...speaking, token: 0 }, spoken), null);
  assert.equal(completedPersonalPhrase({ ...speaking, turnId: 1 }, spoken), null, 'replays cannot train');
  assert.equal(completedPersonalPhrase(speaking, { ...spoken, live: { kind: 'quiet' } }), null, 'cancelled speech cannot train');
  assert.deepEqual(db.list().map((p) => p.text).sort(), [...STARTERS].sort());
  db.record('Hello.', '1'); db.record('Please help me.', '2');
  db.record('Hello.', '3'); db.record('Please help me.', '4');
  db.record('Hello.', '5');
  db.record('Hello.', '5'); // A retried request must not count twice or change context.
  assert.equal(db.snapshot().find((p) => p.text === 'Please help me.').follows, 2);
  assert.equal(db.snapshot().find((p) => p.text === 'Hello.').uses, 3);
  db.record('Please hold.', '6'); db.record('Hello.', '7');
  db.close(); db = openPhrases(path);
  assert.equal(db.list().find((p) => p.text === 'Please hold.').uses, 1);
  globalThis.fetch = async () => new Response(JSON.stringify(db.snapshot()));
  await loadPhrases();
  const state = { ...INITIAL_STATE, screen: { kind: 'talk' as const },
    composition: { ...EMPTY_COMPOSITION, pending: signatureOf('please') } };
  const choices = phraseChoices(state);
  assert.deepEqual(choices, ['Please help me', 'Please hold']);
  const options = reducer(state, { type: 'open-options', words: choices, phrases: choices });
  assert.equal(messageText(options.composition), '', 'opening choices cannot accept text');
  const chosen = reducer(options, { type: 'accept-phrase', text: choices[0] });
  assert.equal(messageText(chosen.composition), 'Please help me');
  assert.equal(chosen.live.kind, 'quiet', 'acceptance does not speak');
  const continued = reducer(state, { type: 'group', group: 'G4' });
  assert.equal(phraseChoices(continued).length, 0, 'incompatible input removes phrase matches');
  const withWord = reducer(state, { type: 'accept', word: 'please', rank: 0 });
  const next = reducer(withWord, { type: 'group', group: 'G2' });
  assert.equal(messageText(reducer(next, { type: 'accept-phrase', text: 'Please help me.' }).composition), 'Please help me', 'accepted prefix must not be duplicated');
  assert.equal(db.snapshot().find((p) => p.text === 'Please help me.').uses, 2, 'preview and acceptance do not train');
  const sequence = openPhrases(':memory:');
  try {
    for (let i = 0; i < 20; i++) sequence.record('Thank you.', `frequent-${i}`);
    sequence.record('Hi', 'hi-1');
    sequence.record('I am good', 'good-1');
    sequence.record('Hi!', 'hi-2');
    const ranked = sequence.snapshot().sort((a, b) => b.probability - a.probability);
    assert.equal(ranked[0].text, 'I am good', 'one observed Hi -> I am good transition beats an unrelated frequent phrase');
    assert.ok(Math.abs(ranked.reduce((sum, p) => sum + p.probability, 0) - 1) < 1e-10);
    globalThis.fetch = async () => new Response(JSON.stringify(sequence.snapshot()));
    await loadPhrases();
    const idle = { ...INITIAL_STATE, screen: { kind: 'talk' as const } };
    assert.equal(phraseChoices(idle)[0], 'I am good', 'next phrases appear without entering a group');
    assert.equal(phraseChoices(idle).length, 3);
    const nextWords = wordsNow(idle);
    const nextSlots = slotsFor(idle, nextWords);
    assert.equal(nextSlots.primary.kind, 'options');
    assert.equal(nextSlots.groups, true, 'typing remains available');
    assert.equal(nextSlots.second.kind, 'menu', 'menu remains available');
    const review = reducer(idle, { type: 'open-options', words: nextWords.options, phrases: nextWords.phrases, next: true });
    assert.equal(review.screen.kind, 'options', 'open next phrases with an empty draft');
    assert.equal(messageText(review.composition), '');
    const frozen = wordsNow(review).options;
    sequence.record('Something else', 'new-1');
    await loadPhrases();
    assert.deepEqual(wordsNow(review).options, frozen, 'late training cannot change a chooser snapshot');
    assert.equal(phraseChoices({ ...idle, settings: { ...idle.settings, suggestions: false } }).length, 0);
    assert.equal(phraseChoices({ ...idle, live: { kind: 'listening', token: 1, transcript: 'partner' } }).length, 0);
    const chosenNext = reducer(review, { type: 'accept-phrase', text: 'I am good' });
    assert.equal(messageText(chosenNext.composition), 'I am good');
    assert.equal(chosenNext.live.kind, 'quiet');
    // Unseen contexts back off to personal frequency rather than claiming a learned transition.
    const cold = predictNextPhrases([{ uses: 9, prior: 1, follows: 0 }, { uses: 0, prior: 1, follows: 0 }]);
    assert.ok(cold[0] > cold[1]);
    // Tests the client integration of Keith Vertanen's ASSETS '17 partner-context method:
    // "Towards Improving Predictive AAC using Crowdsourced Dialogues and Partner Context".
    // https://doi.org/10.1145/3132525.3134814 (Clarte saved-phrase adaptation, mocked here).
    // The same personal history may yield different choices for different partner questions.
    setEngine('http://127.0.0.1:8765');
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      const texts = request.phrases;
      const target = request.history.at(-1)[1] === 'Need anything?' ? 'Something else' : 'Thank you.';
      return new Response(JSON.stringify({ id: request.id, available: true,
        phrases: [target, ...texts.filter((t) => t !== target)].map((text) => ({ text, probability: 1/texts.length })) }));
    };
    const asked = { ...idle, turns: [{ id: 101, who: 'partner' as const, text: 'Need anything?' }] };
    await rankContextPhrases(asked);
    assert.equal(phraseChoices(asked)[0], 'Something else');
    const otherQuestion = { ...asked, turns: [{ id: 102, who: 'partner' as const, text: 'Finished?' }] };
    await rankContextPhrases(otherQuestion);
    assert.equal(phraseChoices(otherQuestion)[0], 'Thank you');
    assert.deepEqual(wordsNow(review).options, frozen, 'context ranking cannot rewrite open Options');
    globalThis.fetch = async () => { throw new Error('engine offline'); };
    await rankContextPhrases({ ...asked, turns: [] });
    assert.ok(phraseChoices(asked).length, 'engine failures preserve saved phrases');
  } finally { sequence.close(); }
  console.log('Phrase persistence, transitions, collisions, continued typing and explicit acceptance passed.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
