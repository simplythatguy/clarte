import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('test page uses correlated suggestions and changes draft only on Accept', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '', textContent: '', disabled: false, dataset: {},
      addEventListener(type, callback) { this[type] = callback; }});
    return elements.get(id);
  };
  const calls = [];
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.document = {getElementById: element};
  globalThis.fetch = (_, options) => new Promise(resolve => {
    const {request_id, ...input} = JSON.parse(options.body);
    calls.push({input, finish(word) { resolve({ok: true, json: async () => ({request_id, input,
      status: 'suggestion', word, probability: 1, probability_kind: 'conditional_model_mass', alternatives: []})}); }});
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      .replace("'./client.mjs'", JSON.stringify(new URL('./client.mjs', import.meta.url).href));
    await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
    assert.equal(element('accept').disabled, true);
    element('partner').value = 'New context';
    element('partner').oninput();
    assert.deepEqual(calls[1].input.history, [['partner', 'New context']]);
    calls[1].finish('current');
    await settle();
    calls[0].finish('stale');
    await settle();
    assert.match(element('completion').textContent, /^current /);
    assert.equal(element('message').value, '');
    assert.equal(element('accept').disabled, false);
    element('accept').onclick();
    assert.equal(element('message').value, 'current');
    assert.equal(element('accept').disabled, true);
    calls[2].finish('next');
    await settle();
    assert.equal(element('message').value, 'current');
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
