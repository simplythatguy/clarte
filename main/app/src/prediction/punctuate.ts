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

/**
 * Words that open a turn and take a comma after them, and that the question check looks past (NAT-52): "hello
 * what is your name" is "Hello, what is your name?". Only words that are openers whatever follows: not "no" ("no
 * problem"), "well" ("well done"), "so" ("so much") or "thanks" ("thanks for coming").
 */
const OPENERS = new Set(['hello', 'hi', 'hey', 'yes', 'yeah', 'okay', 'ok', 'oh']);
const bare = (word: string) => word.toLowerCase().replace(/[^a-z']/g, '');

/**
 * The rule used when the engine's punctuation is not there in time: sentence case, a comma after an opener,
 * "?" when the first word after the openers is a question word, else "."; text already ending in a mark keeps it.
 */
export function punctuateLocally(message: string[]): string {
  const words = message.join(' ').trim().split(/\s+/).filter(Boolean);
  let open = 0;
  while (open < words.length - 1 && OPENERS.has(bare(words[open]))) open += 1;
  // "Hello there" and "hi there" are one greeting, not a greeting and then a word.
  if (open > 0 && bare(words[open]) === 'there') open = 0;
  if (open > 0 && !/[,.?!]$/.test(words[open - 1])) words[open - 1] += ',';
  const text = sentence(words.join(' '));
  if (!text || /[.?!]["”]?$/.test(text)) return text;
  return text + (QUESTION.has(bare(words[open] ?? '')) ? '?' : '.');
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
