import assert from 'node:assert/strict';
import { EMPTY_COMPOSITION, messageText, reduce } from '../src/core/composer.ts';
import { signatureOf } from '../src/core/decoder.ts';
import { INITIAL_STATE, optionsRequestOf, primaryKey, reducer, requestOf, slotsFor, type State } from '../src/model.ts';
import { predictLocal } from '../src/prediction/local.ts';
import type { Prediction } from '../src/prediction/prediction.ts';
import { optionsOf } from '../src/words.ts';

const composition = signatureOf('want').reduce((c, group) => reduce(c, { type: 'group', group }), EMPTY_COMPOSITION);
const state: State = { ...INITIAL_STATE, screen: { kind: 'talk' }, composition };
const prediction: Prediction = {
  source: 'engine', offset: 0, total: 3, longer: 0, branch: false,
  words: [{ word: 'want', p: 0.999, complete: true }, { word: 'wait', p: 0.0009, complete: true }],
};
assert.equal(slotsFor(state, { prediction, options: ['want', 'wait'] }).primary.kind, 'options',
  'a dominant first choice must not hide other matching words');
for (const variant of [prediction, { ...prediction, source: 'local' as const }, { ...prediction, branch: true }]) {
  assert.equal(slotsFor(state, { prediction: variant, options: ['want', 'wait'] }).primary.kind, 'options');
}
assert.equal(slotsFor(state, { prediction, options: ['want'] }).primary.kind, 'options', 'even one prediction is reviewed before acceptance');
assert.equal(slotsFor(state, { prediction, options: [] }).primary.kind, 'no-match');
assert.equal(slotsFor({ ...state, composition: { ...composition, reopened: true, candidateIndex: 1 } },
  { prediction: { ...prediction, offset: 1 }, options: ['wait', 'want'] }).primary.kind, 'options', 'reopened words retain access to alternatives');

const local = predictLocal(requestOf(state));
const choices = optionsOf(composition, local, predictLocal(optionsRequestOf(state)));
assert.equal(choices[0], 'want');
assert.ok(choices.includes('wait'), 'the screenshot collision must be recoverable with the real local decoder');
assert.ok(choices.includes('wanted'), 'longer completions remain acceptable through Options');
assert.equal(new Set(choices).size, choices.length);
const earlyState = { ...state, composition: reduce(EMPTY_COMPOSITION, { type: 'group', group: 'G4' }) };
const early = predictLocal(requestOf(earlyState));
assert.ok(optionsOf(earlyState.composition, early, predictLocal(optionsRequestOf(earlyState))).includes(early.words[0].word),
  'a completion can be accepted before its full code is typed');

const source = [...choices];
const opened = reducer(state, { type: 'open-options', words: source });
assert.equal(opened.screen.kind, 'options');
if (opened.screen.kind !== 'options') throw new Error('chooser did not open');
assert.deepEqual(opened.composition, composition, 'opening Options must not accept or discard anything');
source.reverse();
assert.deepEqual(opened.screen.words, choices, 'the reviewed list must not share mutable prediction storage');
assert.notEqual(primaryKey({ kind: 'options', words: choices }), primaryKey({ kind: 'options', words: [...choices].reverse() }),
  'a changed list must invalidate an armed preview');
const backed = reducer(opened, { type: 'screen', screen: { kind: 'talk' } });
assert.deepEqual(backed.composition, composition, 'Back preserves every input group');
const picked = reducer(opened, { type: 'accept-word', word: 'wait', rank: 3 });
assert.equal(picked.screen.kind, 'talk');
assert.equal(picked.live.kind, 'quiet', 'selecting a word must not speak');
assert.equal(messageText(picked.composition), 'wait');
assert.equal(picked.composition.pending.length, 0);
const reopened = reducer(picked, { type: 'delete' });
assert.deepEqual(reopened.composition.pending, composition.pending);
assert.equal(reopened.composition.reopened, true);
const deleted = reducer(state, { type: 'delete' });
assert.equal(deleted.composition.pending.length, 3);
const empty: State = { ...state, composition: EMPTY_COMPOSITION };
assert.equal(reducer(empty, { type: 'open-options', words: choices }), empty);
assert.equal(slotsFor(empty, { prediction, options: [] }).primary.kind, 'listen');
assert.equal(slotsFor(picked, { prediction, options: [] }).primary.kind, 'speak');
assert.equal(slotsFor({ ...state, live: { kind: 'listening', transcript: '', token: 0 } },
  { prediction, options: choices }).primary.kind, 'stop-listening');
console.log('Options policy: high confidence, one choice, completions, reopen, snapshot, Back, accept and delete passed.');
