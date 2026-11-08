/**
 * The real eye tracker (NAT-27). `prototypes/Eye Tracking` runs in a full-window frame
 * (EyesFrame.tsx) with `?embed=clarte`: it owns the camera, calibration and the free-flow check,
 * then posts every gaze estimate here, as fractions of the window. Those samples drive the same
 * gaze engine the mouse drives, so selection stays by backend quadrant (README "Backend quadrants").
 *
 * While the tracker streams, the mouse stops feeding the engine (gaze.ts); a click or key still
 * activates a card. When the tracker is offline the simulated calibration and the mouse remain.
 */
import { useSyncExternalStore } from 'react';
import { engine } from './gaze.ts';

export const EYES_URL: string = import.meta.env.VITE_CLARTE_EYES_URL ?? 'http://localhost:4318';
const EYES_ORIGIN = new URL(EYES_URL).origin;
/** Samples older than this mean the tracker stopped streaming; the mouse takes over again. */
const STALE_MS = 700;

export function eyesFrameUrl(): string {
  const url = new URL(EYES_URL);
  url.searchParams.set('embed', 'clarte');
  url.searchParams.set('parent', location.origin);
  return url.toString();
}

export type EyesState = {
  /** The tracker page loaded and said hello. */
  connected: boolean;
  /** The tracker's phase: idle, starting, calibration, validation, compose (calibrated), … */
  phase: string | null;
  /** Gaze samples are arriving (calibrated and streaming). */
  streaming: boolean;
  /** The last sample had a face. */
  face: boolean;
};

let state: EyesState = { connected: false, phase: null, streaming: false, face: false };
let lastSampleAt = -Infinity;
const listeners = new Set<() => void>();

function set(patch: Partial<EyesState>): void {
  const next = { ...state, ...patch };
  if (Object.keys(next).every((k) => next[k as keyof EyesState] === state[k as keyof EyesState])) return;
  state = next;
  for (const listener of listeners) listener();
}

/** True while the tracker drives the gaze engine. */
export function eyesDriving(): boolean {
  return performance.now() - lastSampleAt < STALE_MS;
}

type Message =
  | { source: 'clarte-eyes'; kind: 'hello' }
  | { source: 'clarte-eyes'; kind: 'phase'; phase: string }
  | { source: 'clarte-eyes'; kind: 'gaze'; x: number | null; y: number | null; face: boolean };

function onMessage(event: MessageEvent): void {
  if (event.origin !== EYES_ORIGIN) return;
  const data = event.data as Message | null;
  if (!data || data.source !== 'clarte-eyes') return;
  if (data.kind === 'hello') set({ connected: true });
  else if (data.kind === 'phase') set({ connected: true, phase: data.phase, streaming: data.phase === 'compose' && state.streaming });
  else if (data.kind === 'gaze') {
    lastSampleAt = performance.now();
    set({ connected: true, streaming: true, face: data.face });
    if (data.x === null || data.y === null) engine.sample(null, null);
    else engine.sample(data.x * window.innerWidth, data.y * window.innerHeight);
  }
}

window.addEventListener('message', onMessage);
// A tracker that stops streaming (closed, crashed, recalibrating) hands the engine back.
setInterval(() => { if (state.streaming && !eyesDriving()) set({ streaming: false }); }, 250);

export function useEyes(): EyesState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}

export function eyesState(): EyesState {
  return state;
}
