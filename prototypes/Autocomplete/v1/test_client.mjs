import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutocomplete} from './client.mjs';

function controlled() {
  const calls = [];
  const client = createAutocomplete({fetch: (_, options) => new Promise((resolve, reject) => {
    const {request_id, ...input} = JSON.parse(options.body);
    calls.push({input, request_id, signal: options.signal, reject,
      invalidJson() { resolve({ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); }}); },
      finish(overrides = {}, ok = true) {
        resolve({ok, json: async () => ({request_id, input, status: 'suggestion',
          word: 'hello', probability: 0.7, probability_kind: 'conditional_model_mass',
          alternatives: [], ...overrides})});
      }});
  })});
  return {client, calls};
}

for (const field of ['history', 'message', 'groups']) {
  test(`changed ${field} invalidates ready and pending responses, even after ABA edits`, async () => {
    const {client, calls} = controlled();
    const input = {history: [], message: [], groups: ''};
    let work = client.update(input);
    calls[0].finish();
    await work;
    const oldId = client.state.requestId;
    const changed = {...input, [field]: field === 'history' ? [['partner', 'new']]
      : field === 'message' ? ['new'] : '2'};
    const pending = client.update(changed);
    assert.equal(client.state.status, 'pending');
    assert.equal(client.state.result, null);
    assert.equal(client.accept(oldId), null);
    work = client.update(input);
    assert.equal(calls[1].signal.aborted, true);
    calls[2].finish({word: 'current'});
    await work;
    calls[1].finish({word: 'stale'});
    await pending;
    assert.equal(client.state.result.word, 'current');
    assert.equal(client.accept(oldId), null);
  });
}

test('responses never commit; explicit acceptance is current, detached, and single use', async () => {
  const {client, calls} = controlled();
  const input = {history: [['partner', 'Hi']], message: ['say'], groups: '2'};
  const work = client.update(input);
  input.message.push('external');
  calls[0].finish();
  await work;
  assert.deepEqual(client.state.input.message, ['say']);
  assert.throws(() => { client.state.result.word = 'tamper'; });
  assert.equal(client.accept('wrong'), null);
  const id = client.state.requestId;
  assert.deepEqual(client.accept(id), {history: [['partner', 'Hi']], message: ['say', 'hello'], groups: ''});
  assert.equal(client.accept(id), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(input.history, [['partner', 'Hi']]);
});

test('empty groups request next word; no matches cannot be accepted', async () => {
  const {client, calls} = controlled();
  const work = client.update();
  assert.equal(calls[0].input.groups, '');
  calls[0].finish({status: 'no_match', word: '', probability: 0});
  await work;
  assert.equal(client.state.status, 'no_match');
  assert.equal(client.accept(client.state.requestId), null);
});

for (const kind of ['http', 'network', 'identity', 'input', 'malformed', 'json']) {
  test(`${kind} failure clears suggestion and permits retry`, async () => {
    const {client, calls} = controlled();
    let work = client.update();
    if (kind === 'network') calls[0].reject(new Error('offline'));
    else if (kind === 'json') calls[0].invalidJson();
    if (kind !== 'network' && kind !== 'json') calls[0].finish(kind === 'http' ? {status: 'error', error: 'Engine failed'}
      : kind === 'identity' ? {request_id: 'other'} : kind === 'input' ? {input: {history: [], message: [], groups: '4'}}
      : {probability: null}, kind !== 'http');
    await work;
    assert.equal(client.state.status, 'error');
    assert.equal(client.state.result, null);
    assert.equal(client.accept(client.state.requestId), null);
    work = client.update();
    calls[1].finish();
    await work;
    assert.equal(client.state.status, 'ready');
  });
}

test('late failure cannot clear a newer ready suggestion', async () => {
  const {client, calls} = controlled();
  const old = client.update();
  const fresh = client.update({groups: '1'});
  calls[1].finish();
  await fresh;
  calls[0].reject(new Error('old failure'));
  await old;
  assert.equal(client.state.status, 'ready');
});

test('cancel invalidates an in-flight response', async () => {
  const {client, calls} = controlled();
  const work = client.update();
  client.cancel();
  calls[0].finish();
  await work;
  assert.equal(client.state.status, 'idle');
  assert.equal(client.accept('1'), null);
});

test('cancel settles pending work even when transport ignores abort', async () => {
  const client = createAutocomplete({fetch: () => new Promise(() => {})});
  const work = client.update();
  client.cancel();
  await work;
  assert.equal(client.state.status, 'idle');
});

test('request identities remain distinct across client instances', async () => {
  const first = controlled(), second = controlled();
  const old = first.client.update(), fresh = second.client.update();
  first.calls[0].finish();
  second.calls[0].finish();
  await Promise.all([old, fresh]);
  assert.notEqual(first.client.state.requestId, second.client.state.requestId);
  assert.equal(second.client.accept(first.client.state.requestId), null);
});

test('validation error without echoed input preserves the service error', async () => {
  const {client, calls} = controlled();
  const work = client.update({groups: 'bad'});
  calls[0].finish({status: 'error', input: undefined, error: 'Invalid groups'}, false);
  await work;
  assert.equal(client.state.error, 'Invalid groups');
});

test('timeout terminates pending even if transport ignores abort', async () => {
  const client = createAutocomplete({timeoutMs: 5, fetch: () => new Promise(() => {})});
  await client.update();
  assert.equal(client.state.status, 'error');
  assert.match(client.state.error, /timed out/);
});
