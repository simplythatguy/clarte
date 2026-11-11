import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openPhrases } from '../phrase-store.mjs';
import { INITIAL_STATE, reducer } from '../src/model.ts';
import { EMPTY_COMPOSITION, messageText } from '../src/core/composer.ts';
import { signatureOf } from '../src/core/decoder.ts';
import { loadPhrases, phraseChoices, rankContextPhrases } from '../src/phrases.ts';
import { setEngine } from '../src/prediction/prediction.ts';
import { wordsNow } from '../src/useWords.ts';

const dir = mkdtempSync(join(tmpdir(), 'clarte-phrase-learning-'));
const path = join(dir, 'phrases.sqlite');
const hungry = "I'm hungry", followup = 'What do you want to get';
let db = openPhrases(path);
const originalFetch = globalThis.fetch;
try {
  const idle = { ...INITIAL_STATE, screen: { kind: 'talk' as const },
    turns: [{ id: 1, who: 'me' as const, text: hungry }] };
  setEngine('http://127.0.0.1:8765');
  // The learned pair must survive a late generic-model preference, even after one observation.
  for (const repeats of [1, 3]) {
    for (let i = 0; i < repeats; i++) {
      db.record(hungry, `${repeats}-hungry-${i}`);
      db.record(followup, `${repeats}-followup-${i}`);
    }
    db.record(hungry, `${repeats}-last`);
    const snapshot = db.snapshot();
    globalThis.fetch = async () => new Response(JSON.stringify(snapshot));
    await loadPhrases();
    assert.equal(phraseChoices(idle)[0], followup, 'personal successor appears immediately');
    let deliver!: () => void;
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      return new Promise<Response>((resolve) => { deliver = () => resolve(new Response(JSON.stringify({
        id: request.id, available: true,
        phrases: [...request.phrases].sort((a, b) => Number(b === 'Thank you.') - Number(a === 'Thank you.'))
          .map((text) => ({ text, probability: text === 'Thank you.' ? .99 : .0001 })),
      }))); });
    };
    const pending = rankContextPhrases(idle);
    const shown = wordsNow(idle);
    const review = reducer(idle, { type: 'open-options', words: shown.options, phrases: shown.phrases, next: true });
    deliver(); await pending;
    assert.equal(phraseChoices(idle)[0], followup, 'late RNN cannot displace the observed personal successor');
    assert.equal(phraseChoices({ ...idle, live: { kind: 'spoken', turnId: 1 } })[0], followup);
    assert.deepEqual(wordsNow(review).options, shown.options, 'open review remains frozen');
    const chosen = reducer(review, { type: 'accept-phrase', text: followup });
    assert.equal(messageText(chosen.composition), followup);
    assert.equal(chosen.live.kind, 'quiet', 'acceptance does not speak');
    assert.equal(phraseChoices({ ...idle, settings: { ...idle.settings, suggestions: false } }).length, 0);
    const typing = { ...idle, composition: { ...EMPTY_COMPOSITION, pending: signatureOf('what') } };
    assert.ok(phraseChoices(typing).includes(followup));
    assert.equal(phraseChoices({ ...idle, composition: { ...EMPTY_COMPOSITION, pending: signatureOf('please') } }).includes(followup), false);
  }

  // Presentation removes apostrophes; this must not create an unrelated personal context.
  db.record('Im hungry', 'without-apostrophe');
  assert.ok(db.snapshot().find((p) => p.text === followup).follows > 0, 'punctuation-free selection reuses learned context');
  const uses = db.snapshot().find((p) => p.text === followup).uses;
  db.record(followup, 'once'); db.record(followup, 'once');
  assert.equal(db.snapshot().find((p) => p.text === followup).uses, uses + 1, 'retry IDs remain idempotent');
  db.record(hungry, 'before-reload'); db.close(); db = openPhrases(path);
  assert.ok(db.snapshot().find((p) => p.text === followup).follows > 0, 'learning survives reopening SQLite');

  // Retain and combine historical rows that already split the two spellings, without deleting data.
  const raw = new DatabaseSync(path);
  raw.prepare('INSERT OR IGNORE INTO phrases VALUES(?,?,?,?)').run("i'm hungry", "I'm hungry", 1, 0);
  raw.prepare('INSERT OR IGNORE INTO phrases VALUES(?,?,?,?)').run('im hungry', 'Im hungry', 2, 0);
  raw.prepare('INSERT INTO transitions VALUES(?,?,?) ON CONFLICT(previous,next) DO UPDATE SET uses=uses+excluded.uses')
    .run('im hungry', 'what do you want to get', 2);
  const before = db.snapshot().find((p) => p.text === followup).follows;
  raw.prepare('UPDATE context SET previous=? WHERE id=1').run('im hungry');
  assert.equal(db.snapshot().find((p) => p.text === followup).follows, before, 'old context aliases expose the same combined transitions');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM phrases WHERE key IN (?,?)').get("i'm hungry", 'im hungry').n, 2,
    'legacy rows are retained');
  raw.close();
  // Optional integration run against the actual trained local RNN; SQLite stays temporary.
  if (process.env.PHRASE_RNN_TEST_ORIGIN) {
    setEngine(process.env.PHRASE_RNN_TEST_ORIGIN);
    let neuralAvailable = false;
    globalThis.fetch = async (url, options) => {
      if (url === '/api/phrases') return new Response(JSON.stringify(db.snapshot()));
      const response = await originalFetch(url, options);
      neuralAvailable = (await response.clone().json()).available === true;
      return response;
    };
    await loadPhrases();
    assert.equal(phraseChoices(idle)[0], followup);
    await rankContextPhrases(idle);
    assert.ok(neuralAvailable, 'integration run requires the trained RNN to answer');
    assert.equal(phraseChoices(idle)[0], followup, 'actual RNN response preserves the personal successor');
    console.log('Actual local trained-RNN integration passed.');
  }
  console.log('Personal follow-ups survive delayed neural ranking, punctuation variants, retries and reload.');
} finally { globalThis.fetch = originalFetch; db.close(); rmSync(dir, { recursive: true, force: true }); }
