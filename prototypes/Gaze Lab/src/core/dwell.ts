export const STALE_MS = 600;
export const REARM_MS = 400;

export type DwellState =
  | { kind: 'idle' }
  | { kind: 'dwelling'; target: string; since: number; lastSample: number; progress: number }
  | { kind: 'latched'; target: string }
  | { kind: 'locked' }
  | { kind: 'rearming'; target: string | null; since: number; lastSample: number };

export type DwellEvent =
  | { type: 'sample'; target: string | null; at: number; now: number }
  | { type: 'lost' }
  | { type: 'tick'; now: number }
  | { type: 'reset' }
  | { type: 'activate'; target: string };

export type DwellResult = { state: DwellState; selected: string | null };
export const initialDwell: DwellState = { kind: 'locked' };

function cancel(state: DwellState): DwellState {
  if (state.kind === 'rearming') return state.target ? { kind: 'latched', target: state.target } : { kind: 'locked' };
  if (state.kind === 'dwelling') return { kind: 'idle' };
  return state;
}

/** Selection requires a fresh sample. Silence never counts as leaving or completing a dwell. */
export function stepDwell(state: DwellState, event: DwellEvent, duration: number): DwellResult {
  const result = (next: DwellState, selected: string | null = null): DwellResult => ({ state: next, selected });
  if (event.type === 'reset') return result(initialDwell);
  if (event.type === 'activate') return result({ kind: 'latched', target: event.target });
  if (event.type === 'lost') return result(cancel(state));
  if (event.type === 'tick') {
    if ((state.kind === 'dwelling' || state.kind === 'rearming') && event.now - state.lastSample > STALE_MS) return result(cancel(state));
    return result(state);
  }
  if (!Number.isFinite(event.at) || event.at > event.now || event.now - event.at > STALE_MS) return result(cancel(state));
  if ((state.kind === 'dwelling' || state.kind === 'rearming') && event.at <= state.lastSample) return result(state);
  if ((state.kind === 'dwelling' || state.kind === 'rearming') && event.at - state.lastSample > STALE_MS) state = cancel(state);

  if (state.kind === 'latched' || state.kind === 'locked') {
    if (event.target !== null) return result(state);
    return result({ kind: 'rearming', target: state.kind === 'latched' ? state.target : null, since: event.at, lastSample: event.at });
  }
  if (state.kind === 'rearming') {
    if (event.target !== null) return result(state.target ? { kind: 'latched', target: state.target } : { kind: 'locked' });
    if (event.at - state.since >= REARM_MS) return result({ kind: 'idle' });
    return result({ ...state, lastSample: event.at });
  }
  if (event.target === null) return result({ kind: 'idle' });
  if (state.kind !== 'dwelling' || state.target !== event.target) {
    return result({ kind: 'dwelling', target: event.target, since: event.at, lastSample: event.at, progress: 0 });
  }
  const progress = Math.min(1, (event.at - state.since) / duration);
  if (progress >= 1) return result({ kind: 'latched', target: event.target }, event.target);
  return result({ ...state, lastSample: event.at, progress });
}
