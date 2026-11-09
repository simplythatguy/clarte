/**
 * Punctuation for the spoken sentence (NAT-38): the engine's `POST /api/v1/punctuate`.
 *
 * The voice (ElevenLabs, or the system voice) changes its intonation and pauses with punctuation, so
 * the message is spoken as the engine writes it: "are you okay" → "Are you okay?". The engine's
 * language model places the end mark, commas and quotes.
 *
 * It is asked ahead, while the message is ready to speak, so the answer is usually there by the time
 * Speak is selected. At Speak, `spokenText` takes the engine's answer if it has it, waits a moment for
 * one on its way, and otherwise (no engine, a slow one, or a rescorer that cannot punctuate) falls back
 * to a rule: "?" after a question word, else ".".
 */
import { engineOrigin, type Role } from './prediction.ts';
import { sentence } from '../text.ts';

const GIVE_UP_MS = 3000;
/** At Speak, how long an answer still on its way may hold the voice back. */
const WAIT_AT_SPEAK_MS = 700;
const CACHE_SIZE = 32;

type Key = string;
const cache = new Map<Key, string>();
const inflight = new Map<Key, Promise<string | null>>();
let nextId = 1;

const keyOf = (history: [Role, string][], message: string[]): Key => JSON.stringify([history, message]);

const QUESTION = new Set(['what', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'which', 'is', 'are', 'am', 'was', 'were',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'have', 'has', 'had',
  "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "can't", "couldn't", "won't", "wouldn't", "shouldn't"]);

/** The rule used without the engine: sentence case, "?" after a question word, else "."; text already ending in a mark keeps it. */
export function punctuateLocally(message: string[]): string {
  const text = sentence(message.join(' '));
  if (!text || /[.?!]["”]?$/.test(text)) return text;
  const first = (message.join(' ').trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z']/g, '');
  return text + (QUESTION.has(first) ? '?' : '.');
}

function remember(key: Key, text: string): void {
  cache.delete(key);
  cache.set(key, text);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Ask the engine now (idempotent), so the answer is cached by the time Speak is selected. */
export function prefetchPunctuation(history: [Role, string][], message: string[]): void {
  void ask(history, message);
}

function ask(history: [Role, string][], message: string[]): Promise<string | null> {
  const key = keyOf(history, message);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const base = engineOrigin();
  if (base === null || !message.length) return Promise.resolve(null);
  const id = nextId++;
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), GIVE_UP_MS);
  const request = fetch(`${base}/api/v1/punctuate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, history, message }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) return null; // an engine from before NAT-38
      const body = (await res.json()) as { id?: unknown; available?: unknown; text?: unknown };
      if (!body || body.id !== id || body.available !== true || typeof body.text !== 'string' || !body.text.trim()) return null;
      remember(key, body.text.trim());
      return body.text.trim();
    })
    .catch(() => null)
    .finally(() => { clearTimeout(giveUp); inflight.delete(key); });
  inflight.set(key, request);
  return request;
}

/** The message as it should be spoken: the engine's punctuation when it arrives in time, else the rule. */
export async function spokenText(history: [Role, string][], message: string[]): Promise<string> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_AT_SPEAK_MS));
  const engine = await Promise.race([ask(history, message), timeout]);
  return engine ?? punctuateLocally(message);
}
