/**
 * The engine's answer for the conversation as it stands. `peek` answers at once (the cache, else
 * the local decoder), so the screen always has a word; the engine's answer replaces it when it
 * arrives within the client's 250 ms race, and this hook re-renders on it.
 *
 * Speculative prefetch (audit L1). Once the current answers are in, the four requests the next
 * group could make (the pending groups plus G1, G2, G3 or G4) are fetched too, so the engine's
 * word is already cached the moment a group is selected instead of racing the 250 ms clock. The
 * Options page (a full lexicon scan) is prefetched only for the group the eyes rest on.
 */
import { useEffect, useState } from 'react';
import { discover, engineOrigin, fetchPrediction, keyOf, peek, subscribe, type PredictRequest } from './prediction/prediction.ts';
import { optionsRequestOf, requestOf, type State, type Words } from './model.ts';
import { GROUP_IDS, type GroupId } from './core/decoder.ts';
import { optionsOf } from './words.ts';
import { loadPhrases, phraseChoices, phraseContextKey, rankContextPhrases, subscribePhrases } from './phrases.ts';

/** The answer the state calls for now, without fetching: for reducers, callbacks and the debug hook. */
export function wordsNow(state: State): Words {
  if (state.screen.kind === 'options') return {
    prediction: peek(requestOf(state)), phrases: state.screen.phrases, options: state.screen.words,
  };
  const phrases = phraseChoices(state);
  if (!state.composition.pending.length) return { prediction: peek(requestOf(state)), phrases, options: phrases };
  const prediction = peek(requestOf(state));
  return { prediction, phrases, options: [...new Set([...phrases, ...optionsOf(state.composition, prediction, peek(optionsRequestOf(state)))])] };
}

/** The request the word card makes once `group` is selected (selecting a group resets the rank to 0). */
export function nextRequestOf(state: State, group: GroupId): PredictRequest {
  const base = requestOf(state);
  return { ...base, groups: base.groups + group.slice(1), offset: 0 };
}

/** `lookedGroup`: the letter group the eyes rest on, if any (its Options page is prefetched). */
export function useWords(state: State, lookedGroup: GroupId | null = null): Words {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => discover(), []);
  useEffect(() => subscribePhrases(() => bump((n) => n + 1)), []);
  useEffect(() => { void loadPhrases(); }, []);
  const typing = state.composition.pending.length > 0;
  const req = requestOf(state);
  const options = optionsRequestOf(state);
  const phraseKey = JSON.stringify([phraseContextKey(state), state.screen.kind, state.settings.suggestions]);
  useEffect(() => { void rankContextPhrases(state); }, [phraseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const composing = state.screen.kind === 'talk';
  useEffect(() => {
    if (!typing && !composing) return;
    let live = true;
    const current = typing ? [fetchPrediction(req), fetchPrediction(options)] : [fetchPrediction(req)];
    // After the current answers, so the prefetch never queues ahead of what is on screen.
    void Promise.allSettled(current).then(() => {
      if (!live) return;
      for (const group of GROUP_IDS) void fetchPrediction(nextRequestOf(state, group)).catch(() => {});
    });
    return () => { live = false; };
    // Again when the engine is found (or lost): what the local decoder said meanwhile was forgotten.
  }, [typing, composing, keyOf(req), keyOf(options), engineOrigin()]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookedOptions = lookedGroup ? { ...nextRequestOf(state, lookedGroup), complete: true, limit: options.limit } : null;
  useEffect(() => {
    if (!lookedOptions || !composing) return;
    // Only once the look has rested a moment: a glance across the row is not a reason for a scan.
    const t = setTimeout(() => void fetchPrediction(lookedOptions).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [composing, lookedOptions && keyOf(lookedOptions)]); // eslint-disable-line react-hooks/exhaustive-deps
  return wordsNow(state);
}
