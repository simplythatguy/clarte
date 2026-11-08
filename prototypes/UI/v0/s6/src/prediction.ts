/**
 * The prediction client (`prototypes/Word Prediction/v1/CONTRACT.md`).
 *
 * Finding the engine. An engine is a server whose `GET /api/v1/health` answers `{ ok: true,
 * vocabulary: n }`; an open port is not enough (the owner's research server also sits on 8765).
 * `?engine=<origin>` names one candidate (the switcher passes the port it started); otherwise the
 * default port and the few after it are probed. Until one answers, and whenever the one in use
 * stops answering, the local decoder (`local.ts`) stands in and the health probe repeats every
 * two seconds, so a cold engine (about 30 s) is picked up the moment it binds. `?engine=off`
 * keeps the local decoder only.
 *
 * Every request carries an id; a response whose id is not the latest for its key is dropped.
 * The engine is raced against a 250 ms clock and the local decoder: a slow, broken or unreachable
 * engine never shows as a spinner, "loading" or a blank card, the local word simply stands; the
 * engine's answer takes its place when it arrives, and a label changes only once gaze has left
 * the card (App: useSettled), never under a resting look or an armed dwell. When the engine comes
 * up, answers the local decoder gave are forgotten so the next request is the engine's. Results
 * are cached by request, so the prefetched next word is there the moment a word is accepted.
 */
import { predictLocal } from './local.ts';

const PARAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('engine') : null;
export const DEFAULT_PORT = 8765;
/** Where an engine may be: the named one, else the default port and the four after it. */
export const CANDIDATES: string[] = PARAM === 'off' ? [] : PARAM ? [PARAM.replace(/\/$/, '')] : [0, 1, 2, 3, 4].map((i) => `http://127.0.0.1:${DEFAULT_PORT + i}`);
/** A slower engine loses to the local decoder for that request (the contract's "instant" fallback). */
export const SLOW_MS = 250;
/** A request still unanswered after this is abandoned, so a hung engine never piles up connections. */
const GIVE_UP_MS = 4000;
const HEALTH_MS = 1500;
const PROBE_EVERY_MS = 2000;
/** Consecutive request failures that count as the engine being gone. */
const FAILURES_TO_LOSE = 2;
const LIMIT = 8;
const CACHE_SIZE = 64;

export type Role = 'partner' | 'user';
export type PredictRequest = {
  history: [Role, string][];
  message: string[];
  groups: string;
  offset: number;
  /** Only words whose code has exactly the typed length (the Other words chooser). */
  complete?: boolean;
  limit?: number;
};
export type PredictedWord = {
  word: string;
  p: number;
  complete: boolean;
  /** The written form, when the engine knows one ("Priya"); absent for ordinary words and from the local decoder. */
  display?: string;
  /** A probable gaze-slip correction: its code differs from the typed groups in one digit (round 3). */
  corrected?: boolean;
};
/** The engine's answer as sent: a word may be a gaze-slip correction when nothing matched. */
type EngineWord = PredictedWord & { corrected?: boolean; display?: unknown };
type EngineBody = { id: number; words: EngineWord[]; total: number; longer: number; branch?: boolean };
/** When nothing matches the typed groups, a word the person can still accept. */
export type Fallback = {
  word: string;
  /** `corrected`: one digit off (a gaze slip). `prefix`: the best word for the longest matching prefix. */
  kind: 'corrected' | 'prefix';
  display?: string;
};
export type Prediction = {
  words: PredictedWord[];
  total: number;
  /** Summed p of matching words longer than the typed groups. */
  longer: number;
  /** The offset actually used (a wrapped page comes back as 0). */
  offset: number;
  source: 'engine' | 'local';
  /** The engine's own call on offering `words[1]` in Q4 (round 2); absent when it did not say. */
  branch?: boolean;
  fallback?: Fallback;
};

export function keyOf(req: PredictRequest): string {
  return JSON.stringify([req.history, req.message, req.groups, req.offset, req.complete ?? false, req.limit ?? LIMIT]);
}

const cache = new Map<string, Prediction>();
const inflight = new Map<string, Promise<Prediction>>();
let nextId = 1;
const listeners = new Set<() => void>();

function remember(key: string, value: Prediction): Prediction {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return value;
}

/** Notified when a cached answer arrives or the engine's reachability changes. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => listeners.forEach((fn) => fn());

// ── Discovery ──

let origin: string | null = null;
let failures = 0;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;

/** The engine in use, or null while the local decoder stands in. */
export function engineOrigin(): string | null { return origin; }
export function engineDown(): boolean { return origin === null; }

async function healthy(candidate: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_MS);
  try {
    const res = await fetch(`${candidate}/api/v1/health`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown; vocabulary?: unknown };
    return Boolean(body) && body.ok === true && typeof body.vocabulary === 'number';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function found(candidate: string): void {
  origin = candidate;
  failures = 0;
  // The engine answers from now on: forget what the local decoder said while it was away.
  for (const [key, value] of cache) if (value.source === 'local') cache.delete(key);
  notify();
}

function lost(): void {
  if (origin === null) return;
  origin = null;
  failures = 0;
  notify();
  scheduleProbe(0);
}

async function probe(): Promise<void> {
  if (probing || origin !== null || !CANDIDATES.length) return;
  probing = true;
  try {
    const results = await Promise.all(CANDIDATES.map(healthy));
    const i = results.indexOf(true);
    if (origin === null && i >= 0) found(CANDIDATES[i]);
  } finally {
    probing = false;
    if (origin === null) scheduleProbe(PROBE_EVERY_MS);
  }
}

function scheduleProbe(ms: number): void {
  if (!CANDIDATES.length) return;
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(() => { probeTimer = null; void probe(); }, ms);
}

/** Start looking for the engine (idempotent). Returns the unsubscribe for the probe loop. */
export function discover(): () => void {
  scheduleProbe(0);
  return () => { if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; } };
}

/** Tests and demos: forget the engine (it is probed again) or name one outright. */
export function setEngine(next: string | null): void {
  if (next === null) { lost(); return; }
  found(next.replace(/\/$/, ''));
}

// ── Answers ──

/** The answer for `req` now: the cached one, else the local decoder's. Never empty-handed. */
export function peek(req: PredictRequest): Prediction {
  return cache.get(keyOf(req)) ?? predictLocal(req, req.limit ?? LIMIT);
}

/** Seed an answer (debug phases, tests). */
export function seed(req: PredictRequest, value: Prediction): void {
  remember(keyOf(req), value);
}

function isWord(w: unknown): w is EngineWord {
  return Boolean(w) && typeof (w as EngineWord).word === 'string' && (w as EngineWord).word.length > 0 && typeof (w as EngineWord).p === 'number';
}

/** The engine's word as the screen keeps it: `display` only when it is the same word written differently. */
function keep({ word, p, complete, display, corrected }: EngineWord): PredictedWord {
  const shown: PredictedWord = { word, p, complete: Boolean(complete) };
  if (typeof display === 'string' && display !== word && display.toLowerCase() === word.toLowerCase()) shown.display = display;
  if (corrected === true) shown.corrected = true;
  return shown;
}

async function fromEngine(base: string, req: PredictRequest, id: number, signal: AbortSignal): Promise<Prediction> {
  const limit = req.limit ?? LIMIT;
  const res = await fetch(`${base}/api/v1/predict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, history: req.history, message: req.message, groups: req.groups, limit, offset: req.offset, ...(req.complete ? { complete: true } : {}) }),
    signal,
  });
  if (!res.ok) throw new Error(`engine ${res.status}`);
  const body = (await res.json()) as Partial<EngineBody>;
  if (!body || body.id !== id) throw new Error('stale or malformed response');
  if (!Array.isArray(body.words) || typeof body.total !== 'number') throw new Error('malformed response');
  const sent = body.words.filter(isWord);
  const total = body.total;
  const longer = typeof body.longer === 'number' ? body.longer : 0;
  // An engine that does not yet filter by `complete` pages over every match: its best 64 are
  // sifted for exact-length words instead, with the local decoder's exact-length words after them.
  if (req.complete && sent.some((w) => !w.complete || w.corrected)) return completeWithoutSupport(base, req, id, signal);
  // Round 3: a page with exact matches may carry gaze-slip corrections among them, ranked by
  // probability; they are shown where they rank (Q1 when first) and marked. With nothing matching,
  // the corrections are the fallback below.
  const matching = (total > 0 ? sent : sent.filter((w) => !w.corrected)).map(keep);
  // Past the last page: wrap to the first, so paging always reaches a word.
  if (matching.length === 0 && total > 0 && req.offset > 0) {
    const first = await fromEngine(base, { ...req, offset: 0 }, id, signal);
    return { ...first, offset: 0 };
  }
  const prediction: Prediction = { words: matching, total, longer, offset: req.offset, source: 'engine' };
  if (typeof body.branch === 'boolean') prediction.branch = body.branch;
  if (total === 0 && req.groups) {
    // Nothing matches: the engine's top correction (a gaze slip, one digit off) is still a word
    // the person can accept; failing that, the local decoder's best word for the longest prefix.
    const corrected = sent.find((w) => w.corrected);
    prediction.fallback = corrected ? { word: corrected.word, kind: 'corrected', display: keep(corrected).display } : predictLocal(req, limit).fallback;
  }
  return prediction;
}

const ENGINE_MAX_LIMIT = 64;

/** The Other words page from an engine without `complete`: its best exact-length words, then the local decoder's. */
async function completeWithoutSupport(base: string, req: PredictRequest, id: number, signal: AbortSignal): Promise<Prediction> {
  const limit = req.limit ?? LIMIT;
  const res = await fetch(`${base}/api/v1/predict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, history: req.history, message: req.message, groups: req.groups, limit: ENGINE_MAX_LIMIT, offset: 0 }),
    signal,
  });
  if (!res.ok) throw new Error(`engine ${res.status}`);
  const body = (await res.json()) as Partial<EngineBody>;
  if (!body || body.id !== id || !Array.isArray(body.words)) throw new Error('malformed response');
  const exact = body.words.filter(isWord).filter((w) => w.complete && !w.corrected).map(keep);
  const seen = new Set(exact.map((w) => w.word));
  const local = predictLocal({ ...req, offset: 0, limit: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER).words.filter((w) => !seen.has(w.word));
  const all = [...exact, ...local];
  const total = all.length;
  const offset = total ? req.offset % total : 0;
  return { words: all.slice(offset, offset + limit), total, longer: 0, offset, source: 'engine' };
}

/**
 * Fetch `req` into the cache. Resolves with the answer that stands for this request: the engine's
 * when it arrives within SLOW_MS, else the local decoder's. The engine's late answer is dropped
 * (a label that already settled is not changed under the person).
 */
export function fetchPrediction(req: PredictRequest): Promise<Prediction> {
  const key = keyOf(req);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const base = origin;
  // The local answer stands only while nothing better is cached; it never overwrites the engine's.
  const local = () => cache.get(key) ?? remember(key, predictLocal(req, req.limit ?? LIMIT));
  if (base === null) {
    const value = local();
    notify();
    return Promise.resolve(value);
  }
  const id = nextId++;
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), GIVE_UP_MS);
  const engine = fromEngine(base, req, id, controller.signal).then(
    (value) => { clearTimeout(giveUp); if (origin === base) failures = 0; return value; },
    (error: unknown) => {
      clearTimeout(giveUp);
      // One failure is one request's; a run of them means the engine is gone (the probe takes over).
      if (origin === base && ++failures >= FAILURES_TO_LOSE) lost();
      throw error;
    },
  );
  const settled: Promise<Prediction> = Promise.race<Prediction>([
    engine,
    new Promise<Prediction>((resolve) => setTimeout(() => resolve(local()), SLOW_MS)),
  ]).catch(() => local());
  // Whoever lost the race must not overwrite the answer that stood.
  const done = settled.then((value) => {
    if (!cache.has(key)) remember(key, value);
    inflight.delete(key);
    notify();
    return cache.get(key)!;
  });
  // The engine's answer replaces a local one whenever it arrives: a label changes only once gaze
  // has left its card (App: useSettled), and an activation always takes the word that was shown,
  // so a late answer can improve the next look but never what the person is acting on. A chooser
  // page (`complete`) is read as a whole, so the list that first stood stays until it is left.
  void engine.then((value) => {
    const standing = cache.get(key);
    if (!standing || (standing.source === 'local' && !req.complete)) { remember(key, value); notify(); }
  }, () => {});
  inflight.set(key, done);
  return done;
}

/** Tell the engine a word was accepted (it may learn from it). Fire and forget. */
export function commit(word: string, history: [Role, string][], message: string[]): void {
  const base = origin;
  if (base === null) return;
  void fetch(`${base}/api/v1/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ word, history, message }),
  }).catch(() => {});
}
