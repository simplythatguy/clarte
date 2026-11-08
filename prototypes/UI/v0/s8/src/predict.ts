/**
 * The real language model behind the letter groups (NAT-27).
 *
 * Two local services answer, both from `prototypes/`:
 * - Word Prediction v0 (`POST /api/predict`, port 8765): the two-choice product contract of PR #16,
 *   `likely` = the two best matching words for the typed groups, in context. Its order is the order
 *   the cards offer them.
 * - Autocomplete v1 (`POST /api/complete`, port 8767, PR #15): one completion with its probability
 *   and up to three alternatives, normalised over every word with that group prefix. The
 *   probabilities decide when two words are close enough to branch (conflict.ts).
 *
 * Both get the whole conversation (partner and user turns) and the words already in the message.
 * Results are cached per context and group sequence; the composer reads them synchronously through
 * the shared decoder's override hook, and the app re-renders when an answer arrives. Until the
 * first answer for a sequence (and whenever the services are offline) the shared stand-in decoder
 * answers instead, so typing never waits on the network.
 */
import { useSyncExternalStore } from 'react';
import { setDecodeOverride, signatureOf, type Candidate, type GroupId } from '../../shared/decoder.ts';

const PREDICT_URL: string = import.meta.env.VITE_CLARTE_PREDICT_URL ?? 'http://127.0.0.1:8765/api/predict';
const COMPLETE_URL: string = import.meta.env.VITE_CLARTE_AUTOCOMPLETE_URL ?? 'http://127.0.0.1:8767/api/complete';
const TIMEOUT_MS = 15000;
const RETRY_MS = 5000;
const CACHE_LIMIT = 600;

export type Role = 'partner' | 'user';
export type HistoryTurn = [Role, string];
type Scored = { word: string; probability: number };
type Result = { likely: string[]; completion: (Scored & { alternatives: Scored[] }) | null };

let history: HistoryTurn[] = [];
let message: string[] = [];
let contextKey = '[[],[]]';
const cache = new Map<string, Result>();
const inflight = new Set<string>();
const service = { predict: null as boolean | null, complete: null as boolean | null };
let lastFailure = { predict: -Infinity, complete: -Infinity };
let version = 0;
const listeners = new Set<() => void>();
const session = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
let requestCount = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

const digits = (groups: readonly GroupId[]): string => groups.map((g) => g.slice(1)).join('');

/** What the model conditions on: the conversation so far and the message being composed. */
export function setPredictionContext(turns: HistoryTurn[], words: string[]): void {
  const key = JSON.stringify([turns, words]);
  if (key === contextKey) return;
  history = turns;
  message = words;
  contextKey = key;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

function request(key: string, groups: string): void {
  if (inflight.has(key)) return;
  inflight.add(key);
  const body = { history, message, groups };
  const now = performance.now();
  const wantComplete = service.complete !== false || now - lastFailure.complete > RETRY_MS;
  const predict = post<{ likely?: string[] }>(PREDICT_URL, body).then(
    (r) => { service.predict = true; return Array.isArray(r.likely) ? r.likely : []; },
    (error) => { service.predict = false; lastFailure.predict = performance.now(); console.warn('[predict] word prediction offline', error); return null; },
  );
  const complete = wantComplete
    ? post<{ status: string; word: string; probability: number; alternatives: Scored[] }>(COMPLETE_URL, { request_id: `s8-${session}:${++requestCount}`, ...body }).then(
      (r) => { service.complete = true; return r.status === 'suggestion' ? { word: r.word, probability: r.probability, alternatives: r.alternatives ?? [] } : null; },
      (error) => { if (service.complete !== false) console.warn('[predict] autocomplete offline', error); service.complete = false; lastFailure.complete = performance.now(); return null; },
    )
    : Promise.resolve(null);
  void Promise.all([predict, complete]).then(([likely, completion]) => {
    inflight.delete(key);
    if (likely === null && completion === null) { notify(); return; }
    cache.set(key, { likely: likely ?? (completion ? [completion.word, ...completion.alternatives.map((a) => a.word)] : []), completion });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    notify();
  });
}

function lookup(groups: readonly GroupId[]): Result | null {
  const typed = digits(groups);
  const key = `${contextKey}#${typed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const offline = service.predict === false && service.complete === false;
  if (!offline || performance.now() - Math.max(lastFailure.predict, lastFailure.complete) > RETRY_MS) request(key, typed);
  return null;
}

/** The words a result offers, the engine's two choices first, each with its group signature checked. */
function wordsOf(result: Result, groups: readonly GroupId[]): string[] {
  const words = [...result.likely];
  if (result.completion) words.push(result.completion.word, ...result.completion.alternatives.map((a) => a.word));
  const typed = groups.join('');
  const seen = new Set<string>();
  return words.filter((w) => {
    const word = w.toLowerCase();
    if (!word || seen.has(word) || !signatureOf(word).join('').startsWith(typed)) return false;
    seen.add(word);
    return true;
  });
}

function liveDecode(groups: readonly GroupId[]): Candidate[] | null {
  const result = lookup(groups);
  if (!result) return null;
  const words = wordsOf(result, groups);
  return words.map((word, i) => ({ word: word.toLowerCase(), complete: signatureOf(word).length === groups.length, score: 1000 - i }));
}

setDecodeOverride((groups) => liveDecode(groups));

/**
 * The model's probabilities for the whole words of a sequence, when Autocomplete has answered:
 * each word's mass over every word with that group prefix, and the mass left for longer words.
 * Undefined while there is no live answer (the stand-in's Zipf estimate applies then).
 */
export function liveProbabilities(groups: readonly GroupId[]): { whole: Scored[]; longer: number } | undefined {
  const result = cache.get(`${contextKey}#${digits(groups)}`);
  if (!result?.completion) return undefined;
  const scored = [result.completion, ...result.completion.alternatives];
  const whole = scored.filter((s) => signatureOf(s.word).length === groups.length).sort((a, b) => b.probability - a.probability);
  const wholeMass = whole.reduce((sum, s) => sum + s.probability, 0);
  return { whole, longer: Math.max(0, 1 - wholeMass) };
}

/** Re-render when an answer arrives. */
export function usePredictions(): number {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => version);
}

/** Which services answered last: true online, false offline, null not asked yet. */
export function predictionServices(): { predict: boolean | null; complete: boolean | null } {
  return { ...service };
}
