import assert from 'node:assert/strict';
import { openPhrases } from '../phrase-store.mjs';
import { INITIAL_STATE } from '../src/model.ts';
import { loadPhrases, phraseChoices, rankContextPhrases } from '../src/phrases.ts';
import { setEngine } from '../src/prediction/prediction.ts';
import { phraseIdentity } from '../src/phrase-identity.ts';

// Explicit equivalent entry forms, not arbitrary word orders or inferred intentions.
const forms = [
  ["I'm hungry", 'im hungry', 'I’m hungry', 'I am hungry', 'i m hungry'],
  ['What do you want to get', 'what do you wanna get', 'what do u want to get', 'what do you want 2 get'],
  ['chicken'],
  ["let's go", 'lets go', 'let’s go', 'let us go', 'let s go'],
];
const variants = forms.map(group => [...new Set(group.flatMap(text =>
  [text, text.toLowerCase(), text.toUpperCase()].flatMap(cased =>
    [cased, ` “${cased}?” `, `${cased}!`, `${cased}.`].flatMap(punctuated =>
      [punctuated, punctuated.replace(/ /g, '  '), punctuated.replace(/ /g, '\t')]))))]);
const base = forms.map(group => group[0]);
const expected = ['What do you want to get', 'chicken', 'lets go', 'Im hungry'];
const originalFetch = globalThis.fetch;
let checks = 0, liveChecks = 0;
setEngine('http://127.0.0.1:8765');

async function check(db, stage, text, live = false) {
  const state = { ...INITIAL_STATE, screen: { kind: 'talk' as const },
    turns: [{ id: 1, who: 'me' as const, text }] };
  globalThis.fetch = async () => new Response(JSON.stringify(db.snapshot()));
  await loadPhrases();
  assert.equal(phraseIdentity(phraseChoices(state)[0] ?? ''), phraseIdentity(expected[stage]), `successor for ${JSON.stringify(text)}`);
  let available = false;
  globalThis.fetch = async (url, options) => {
    if (live) {
      const response = await originalFetch(url, options);
      available = (await response.clone().json()).available === true;
      return response;
    }
    const request = JSON.parse(String(options?.body));
    // Simulate an adversarial late generic model preferring Thank you over the routine.
    return new Response(JSON.stringify({ id: request.id, available: true,
      phrases: [...request.phrases].sort((a, b) => Number(b === 'Thank you.')-Number(a === 'Thank you.'))
        .map(text => ({ text, probability: text === 'Thank you.' ? .99 : .0001 })) }));
  };
  await rankContextPhrases(state);
  if (live) { assert.ok(available, 'actual trained local RNN answered'); liveChecks++; }
  assert.equal(phraseIdentity(phraseChoices(state)[0] ?? ''), phraseIdentity(expected[stage]), `stable successor after neural result for ${JSON.stringify(text)}`);
  checks++;
}

try {
  for (const [different, original] of [["I'm not hungry", "I'm hungry"], ['he lets go', 'lets go'],
    ['chicken nuggets', 'chicken'], ['What do you want to get tomorrow', 'What do you want to get'],
    ['take 1.5 tablets', 'take 15 tablets'], ['Are you hungry', "I'm hungry"]]) {
    assert.notEqual(phraseIdentity(different), phraseIdentity(original), 'different intent/content is not merged');
  }
  for (let stage = 0; stage < 4; stage++) for (const text of variants[stage]) {
    const db = openPhrases(':memory:');
    try {
      base.forEach((phrase, i) => db.record(phrase, `train-${i}`));
      assert.equal(db.snapshot().some(p => p.follows), false, 'no invented learned follow-up after the final phrase');
      if (stage === 3) db.record(base[0], 'explicit-next-cycle');
      db.record(text, 'query');
      await check(db, stage, text);
    } finally { db.close(); }
  }
  // Rotate all stage variants through mixed-entry training, including every lets-go variant.
  const mixed = Math.max(...variants.map(group => group.length));
  for (let n = 0; n < mixed; n++) {
    const db = openPhrases(':memory:');
    try {
      forms.forEach((_, stage) => db.record(variants[stage][n % variants[stage].length], `mixed-${stage}`));
      for (let stage = 0; stage < 3; stage++) {
        db.record(base[stage], `query-${stage}`);
        await check(db, stage, base[stage]);
      }
      checks++;
    } finally { db.close(); }
  }
  if (process.env.PHRASE_RNN_TEST_ORIGIN) {
    setEngine(process.env.PHRASE_RNN_TEST_ORIGIN);
    for (let stage = 0; stage < 3; stage++) {
      const db = openPhrases(':memory:');
      try { base.forEach((text, i) => db.record(text, `live-${i}`)); db.record(base[stage], 'query'); await check(db, stage, base[stage], true); }
      finally { db.close(); }
    }
  }
  console.log(JSON.stringify({ variantsPerStage: variants.map(group => group.length), checks, liveChecks,
    learnedRecommendations: base.slice(0, 3).map((after, i) => ({ after, next: expected[i] })) }));
} finally { globalThis.fetch = originalFetch; }
