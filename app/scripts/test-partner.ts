// The partner's speech cutter (NAT-49, src/listen/partner.ts): synthetic audio in, utterances out.
import assert from 'node:assert/strict';
import { UtteranceCutter, toPcm16, type Cut } from '../src/listen/partner.ts';

const RATE = 16000;
let seed = 1;
const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2e-4; };
const quiet = (s: number) => Float32Array.from({ length: Math.round(s * RATE) }, noise);
const voice = (s: number, amp = 0.1) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * 180 * i) / RATE) + noise());
/** Speech-like: 250 ms syllables with 80 ms near-silent gaps, which keep the noise floor down. */
const talk = (s: number, amp = 0.1) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => ((i / RATE) % 0.33 < 0.25 ? amp * Math.sin((2 * Math.PI * 180 * i) / RATE) : 0) + noise());
const join = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/** Feed in 1024-sample blocks, as the microphone's worklet does. */
function cut(audio: Float32Array, cutter = new UtteranceCutter()): Cut[] {
  const out: Cut[] = [];
  for (let i = 0; i < audio.length; i += 1024) out.push(...cutter.push(audio.subarray(i, i + 1024)));
  return out;
}

const one = cut(join(quiet(1), voice(2.5), quiet(1.2)));
const finals = one.filter((c) => c.kind === 'final');
assert.equal(finals.length, 1, 'one utterance, one final');
assert.ok(Math.abs(finals[0].speechMs - 2500) <= 400, `its speech lasts about 2.5 s (${finals[0].speechMs} ms)`);
assert.ok(finals[0].audio.length / RATE >= 2.5 && finals[0].audio.length / RATE <= 3.3, `the final keeps the speech and a little either side (${(finals[0].audio.length / RATE).toFixed(2)} s)`);
assert.ok(one.filter((c) => c.kind === 'interim').length >= 2, 'the utterance so far is sent about once a second');
assert.ok(one.every((c, i) => i === 0 || c.audio.length >= one[i - 1].audio.length || c.kind === 'final'), 'interim cuts grow');

assert.deepEqual(cut(quiet(5)), [], 'a quiet room sends nothing');

const two = cut(join(quiet(1), voice(1), quiet(1), voice(1), quiet(1))).filter((c) => c.kind === 'final');
assert.deepEqual(two.map((c) => c.utterance), [1, 2], 'a pause of a second ends one utterance and the next begins');

const knock = cut(join(quiet(1), voice(0.12, 0.3), quiet(1))).filter((c) => c.kind === 'final');
assert.ok(knock.every((c) => c.speechMs < 250), 'a knock is too short to be words (the listener drops it)');

const long = cut(join(quiet(0.5), talk(32), quiet(1))).filter((c) => c.kind === 'final');
assert.ok(long.length >= 3 && long.every((c) => c.audio.length <= 15.1 * RATE), 'a long turn is sent in pieces Whisper can hear');

const hum = cut(join(voice(4, 0.01), voice(1.5, 0.15), voice(2, 0.01))).filter((c) => c.kind === 'final');
assert.equal(hum.length, 1, 'a steady hum becomes the floor; speech over it is still heard');

const flushed = new UtteranceCutter();
cut(join(quiet(1), voice(1)), flushed);
assert.equal(flushed.flush()?.kind, 'final', 'stopping mid-sentence sends what was said');

const pcm = new Int16Array(toPcm16(Float32Array.from([0, 0.05, -0.1])));
assert.equal(Math.max(...pcm.map(Math.abs)), Math.round(0.9 * 32767), 'quiet speech is raised to a 0.9 peak');

console.log('Partner listening: utterances, interim cuts, quiet rooms, knocks, long turns, hum and flush passed.');
