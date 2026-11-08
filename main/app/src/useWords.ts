/**
 * The engine's answer for the conversation as it stands. `peek` answers at once (the cache, else
 * the local decoder), so the screen always has a word; the engine's answer replaces it when it
 * arrives within the client's 250 ms race, and this hook re-renders on it.
 */
import { useEffect, useState } from 'react';
import { discover, fetchPrediction, keyOf, peek, subscribe } from './prediction/prediction.ts';
import { optionsRequestOf, requestOf, type State, type Words } from './model.ts';
import { optionsOf } from './words.ts';

/** The answer the state calls for now, without fetching: for reducers, callbacks and the debug hook. */
export function wordsNow(state: State): Words {
  if (!state.composition.pending.length) return { prediction: peek(requestOf(state)), options: [] };
  return { prediction: peek(requestOf(state)), options: optionsOf(peek(optionsRequestOf(state))) };
}

export function useWords(state: State): Words {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => discover(), []);
  const typing = state.composition.pending.length > 0;
  const req = requestOf(state);
  const options = optionsRequestOf(state);
  useEffect(() => {
    if (!typing) return;
    void fetchPrediction(req);
    void fetchPrediction(options);
  }, [typing, keyOf(req), keyOf(options)]); // eslint-disable-line react-hooks/exhaustive-deps
  return wordsNow(state);
}
