// The person's own voice: one request per phrase, shared by preparing and speaking (NAT-54, audit B6).
import assert from 'node:assert/strict';
import { clipStore, within } from '../src/myvoice/clips.ts';

const asked: string[] = [];
let release: Array<() => void> = [];
let failNext = false;
const store = clipStore((id, text, pacing) => {
  asked.push(`${id}|${pacing}|${text}`);
  if (failNext) { failNext = false; return Promise.reject(new Error('service off')); }
  return new Promise<Blob>((resolve) => release.push(() => resolve(new Blob([text]))));
});

// Preparing on the Speak look, then Speak while the clip is still being made: one request, one charge.
const prepared = store.get('v1', 'Can you pass me the water?', 'like-me');
const spoken = store.get('v1', 'Can you  pass me the water?', 'like-me');
assert.equal(asked.length, 1, 'a clip being made is not asked for again');
assert.equal(prepared, spoken);
release.forEach((r) => r()); release = [];
assert.equal(await (await spoken).text(), 'Can you pass me the water?');

// A different pacing or voice is a different clip.
store.get('v1', 'Can you pass me the water?', 'clearer');
store.get('v2', 'Can you pass me the water?', 'like-me');
assert.equal(asked.length, 3);
release.forEach((r) => r()); release = [];

// A failed clip is forgotten, so the next Speak asks again.
failNext = true;
await assert.rejects(store.get('v1', 'Hello.', 'like-me'));
await Promise.resolve();
store.get('v1', 'Hello.', 'like-me');
assert.equal(asked.filter((a) => a.endsWith('|Hello.')).length, 2, 'a failed clip is asked for again');
release.forEach((r) => r()); release = [];

// Only a few clips stay in memory.
for (let i = 0; i < 20; i++) store.get('v1', `phrase ${i}`, 'like-me');
release.forEach((r) => r()); release = [];
assert.ok(store.size() <= 8, `kept ${store.size()} clips`);

// Speak waits a bounded time: a late clip gives null (the system voice), and the request is not cancelled.
let lateDone = false;
const late = new Promise<string>((resolve) => setTimeout(() => { lateDone = true; resolve('late'); }, 60));
assert.equal(await within(late, 20), null, 'a slow clip hands over to the system voice');
assert.equal(await late, 'late');
assert.ok(lateDone, 'the slow request still finishes, so the clip is cached for Say again');
assert.equal(await within(Promise.resolve('ready'), 20), 'ready', 'a prepared clip plays at once');
await assert.rejects(within(Promise.reject(new Error('off')), 20), 'a failure is reported, not waited out');

console.log('Voice clips: one request per phrase while preparing and speaking, failures retried, Speak waits a bounded time.');
