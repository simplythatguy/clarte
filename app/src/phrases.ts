// phrase prediction model implementation and file using that model
import { historyOf, type Live, type State } from './model.ts';
import { signatureOf } from './core/decoder.ts';
import { engineOrigin } from './prediction/prediction.ts';
import { STARTERS } from './phrase-defaults.ts';
import { phraseText } from './phrase-text.ts';

type Phrase = { text: string; uses: number; prior: number; follows: number; previous?: string; probability?: number };
// Keep starter phrases usable before SQLite loads and if the local API is unavailable.
let phrases: Phrase[] = STARTERS.map((text) => ({ text, uses: 0, prior: 1, follows: 0 }));
let latest = 0;
let operations: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const contextual = new Map<string, string[]>();
let rankingId = 0;
export const phraseContextKey = (state: State) => JSON.stringify([engineOrigin(), historyOf(state),
  state.composition.words.map((w) => w.text), state.composition.pending, phrases]);
const contextKey = phraseContextKey;

/**
 * Research credit for contextual ranking: Keith Vertanen, "Towards Improving Predictive AAC
 * using Crowdsourced Dialogues and Partner Context", ASSETS '17, pp. 347-348.
 * https://doi.org/10.1145/3132525.3134814
 * This client integrates Clarte's saved-phrase adaptation; the regression/store are separate.
 * Ephemeral partner context goes only to the local engine, never the phrase database.
 */
export async function rankContextPhrases(state: State): Promise<void> {
  const base = engineOrigin();
  if (!base || !state.settings.suggestions || state.screen.kind === 'options' || !phrases.length) return;
  const key = contextKey(state);
  if (contextual.has(key)) return;
  const id = ++rankingId;
  // Bound inference work; matching is applied first so typing cannot lose eligible phrases.
  const candidates = matchingPhrases(state).slice(0, 64).map((p) => p.text);
  if (!candidates.length) return;
  try {
    const response = await fetch(`${base}/api/v1/phrases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, history: historyOf(state), phrases: candidates }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.id !== id || id !== rankingId || !result.available || !Array.isArray(result.phrases)) return;
    const ranked = result.phrases;
    if (ranked.length !== candidates.length || ranked.some((p: { text: string; probability: number }) =>
      !p || !candidates.includes(p.text) || !Number.isFinite(p.probability) || p.probability < 0) ||
      new Set(ranked.map((p: { text: string }) => p.text)).size !== candidates.length) return;
    contextual.set(key, ranked.map((p: { text: string }) => p.text));
    if (contextual.size > 16) contextual.delete(contextual.keys().next().value!);
    listeners.forEach((fn) => fn());
  } catch { /* Existing phrase regression remains available. */ }
}
export function completedPersonalPhrase(before: Live, state: State): string | null {
  if (state.live.kind !== 'spoken' || before.kind !== 'speaking' || !before.token || before.turnId !== null || before.holder) return null;
  const id = state.live.turnId;
  const turn = state.turns.find((t) => t.id === id);
  return turn?.who === 'me' && !turn.holder ? turn.text : null;
}
export function subscribePhrases(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function loadPhrases(text?: string, id?: string): Promise<void> {
  // Preserve utterance order even when HTTP requests finish at different speeds.
  const operation = operations.then(() => fetchPhrases(text, id));
  operations = operation.catch(() => {});
  return operation;
}
async function fetchPhrases(text?: string, id?: string): Promise<void> {
  const request = ++latest;
  try {
    const response = await fetch('/api/phrases', text === undefined ? { signal: AbortSignal.timeout(4000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, id }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Phrase database unavailable');
    const result = await response.json();
    if (request !== latest) return;
    if (!Array.isArray(result) || result.some((p) => !p || typeof p.text !== 'string' ||
      !Number.isFinite(p.uses) || !Number.isFinite(p.prior) || !Number.isFinite(p.follows) ||
      (p.probability !== undefined && !Number.isFinite(p.probability)))) throw new Error('Invalid phrase response');
    phrases = result;
    listeners.forEach((fn) => fn());
  } catch (error) { console.warn('Phrase database unavailable; ordinary typing remains available.', error); }
}

/** Match committed words literally and pending groups against the next word, with no fuzzy substitutions. */
export function phraseChoices(state: State): string[] {
  const matching = matchingPhrases(state);
  const ranked = contextual.get(contextKey(state));
  const allowed = new Set(matching.map((p) => p.text));
  // The public-corpus RNN is a backoff, not evidence against the person's observed routine.
  // Keep all matching learned successors in personal-regression order when a late result arrives.
  const learned = matching.filter((p) => p.follows > 0).map((p) => p.text);
  const observed = new Set(learned);
  const ordered = ranked ? [...learned, ...ranked.filter((text) => allowed.has(text) && !observed.has(text)),
    ...matching.map((p) => p.text).filter((text) => !observed.has(text) && !ranked.includes(text))]
    : matching.map((p) => p.text);
  return [...new Set(ordered.map(phraseText).filter(Boolean))].slice(0, 3);
}

function matchingPhrases(state: State): Phrase[] {
  if (!state.settings.suggestions || state.composition.reopened) return [];
  const idle = !state.composition.words.length && !state.composition.pending.length;
  if (idle && !['quiet', 'spoken'].includes(state.live.kind)) return [];
  if (!idle && !state.composition.pending.length) return [];
  const accepted = state.composition.words.map((w) => w.text).join(' ').toLowerCase().replace(/[^a-z0-9' ]/g, '').trim();
  const pending = state.composition.pending.join(',');
  return phrases.filter((p) => {
    if (idle) return true;
    const clean = p.text.toLowerCase().replace(/[^a-z0-9' ]/g, '').trim();
    if (accepted && !clean.startsWith(accepted + ' ')) return false;
    const next = (accepted ? clean.slice(accepted.length + 1) : clean).split(/\s+/)[0];
    return signatureOf(next).join(',').startsWith(pending);
  }).sort((a, b) => Number(b.follows > 0) - Number(a.follows > 0) ||
    (b.probability ?? 0) - (a.probability ?? 0) || b.follows - a.follows || (b.uses + b.prior) - (a.uses + a.prior) || a.text.localeCompare(b.text))
    ;
}
