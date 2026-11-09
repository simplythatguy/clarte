/**
 * The style's binding to the shared gaze engine.
 *
 * One engine for the app. Two dwell classes (letter groups, everything else) are applied by
 * switching `dwellMs` as soon as the engine starts dwelling on an action, which the shared engine
 * allows through `configure`. The per-tile dwell rendering lives in `Tile.tsx`.
 */
import { useEffect, useState } from 'react';
import { GazeEngine, type GazeSnapshot } from './core/gaze.ts';
import { actionIn, collectActionables, validateLayout, viewportOf, type QuadrantId } from './core/quadrants.ts';

export const engine = new GazeEngine({ mode: 'dwell', dwellMs: 900, soundActions: ['accept-centre'] });

export const GROUP_ACTIONS = new Set(['G1', 'G2', 'G3', 'G4']);

/** Nothing is drawn for the first 150 ms on a letter group and 250 ms on a control (R-6 §3.1). */
export function intentDelay(action: string): number {
  return GROUP_ACTIONS.has(action) ? 150 : 250;
}

let dwell = { letters: 600, controls: 900 };
let letterRepeat: 'leave' | 'redwell' = 'leave';
let groupsAreLetters = true;

/**
 * Set the two dwell classes. `groupsAreLetters` is false on screens where Q5–Q8 hold menu items.
 * The repeat mode applies to letter groups only: "Hold" (redwell) is for double letters, and a
 * control must never fire again under a resting gaze (no auto-repeat).
 */
export function setDwellClasses(letters: number, controls: number, lettersActive: boolean, repeat: 'leave' | 'redwell'): void {
  dwell = { letters, controls };
  letterRepeat = repeat;
  groupsAreLetters = lettersActive;
  applyDwellFor(engine.snapshot.action);
}

function isLetter(action: string | null): boolean {
  return Boolean(action && groupsAreLetters && GROUP_ACTIONS.has(action));
}

function applyDwellFor(action: string | null): void {
  const dwellMs = isLetter(action) ? dwell.letters : dwell.controls;
  const repeat = isLetter(action) ? letterRepeat : 'leave';
  if (engine.settings.dwellMs !== dwellMs || engine.settings.repeat !== repeat) engine.configure({ dwellMs, repeat });
}

engine.subscribe((snapshot) => applyDwellFor(snapshot.action));

export function resolveQuadrant(quadrant: QuadrantId): string | null {
  return actionIn(quadrant, collectActionables(), viewportOf())?.id ?? null;
}

export function validateNow() {
  return validateLayout(collectActionables(), viewportOf());
}

/** The action the gaze is on, re-rendering only when it changes. */
export function useLooked(): string | null {
  const [looked, setLooked] = useState<string | null>(engine.snapshot.looked);
  useEffect(() => engine.subscribe((s: GazeSnapshot) => setLooked((prev) => (prev === s.looked ? prev : s.looked))), []);
  return looked;
}

/**
 * The mouse as a gaze tracker, while `active()` says so (App: the eye tracker is off, failed or
 * not yet calibrated, outside Welcome and calibration, and never with keyboard and mouse). A real tracker streams samples continuously; a still mouse sends
 * no events, and the shared engine counts 600 ms without samples as lost gaze. So, like
 * `attachPointer`, this feeds pointer positions, and it also repeats the last position at 30 Hz
 * while the pointer is over the page (which also keeps simulator noise moving). Leaving the
 * window is looking away.
 */
export function attachPointerStream(target: GazeEngine = engine, active: () => boolean = () => true): () => void {
  let last: { x: number; y: number } | null = null;
  const move = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; if (!active()) return; outside = false; target.sample(last.x, last.y, e.timeStamp); };
  // Leaving the page is looking away: cancel the dwell now (blink grace is for blinks, not exits).
  const leave = () => { last = null; if (!active()) return; outside = true; target.sample(null, null); target.cancel(); };
  // Off the page is "no eyes": keep reporting it, so the engine drops the quadrant after its
  // 200 ms blink grace and cancels the dwell (looking off screen cancels, BRIEF "Selection").
  const timer = setInterval(() => { if (!active()) { outside = false; return; } if (last) target.sample(last.x, last.y); else target.sample(null, null); }, 33);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerdown', move);
  document.addEventListener('pointerleave', leave);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerdown', move);
    document.removeEventListener('pointerleave', leave);
  };
}

/**
 * Quadrant guard. After any selection, a *different* action in the same quadrant cannot dwell
 * until gaze has left that quadrant. Without it, a selection that changes what a quadrant holds
 * (Menu → Settings puts "Button dwell" where "Settings" was) fires the new action under a gaze
 * that never moved, 300 ms after the engine's latch re-arms. The same action keeps the engine's
 * own latch and repeat rules, so "redwell" double letters still work.
 */
let guard: { quadrant: QuadrantId; action: string } | null = null;

export function guardQuadrant(quadrant: QuadrantId | null, action: string): void {
  guard = quadrant ? { quadrant, action } : null;
}

export function isGuarded(action: string, snapshot: GazeSnapshot = engine.snapshot): boolean {
  // Only a dwell can fire under a resting gaze. In confirm mode every selection is an explicit
  // Space, click, switch or sound, so the new card in a quadrant needs no look away first.
  if (engine.settings.mode !== 'dwell') return false;
  return guard !== null && snapshot.quadrant === guard.quadrant && action !== guard.action;
}

/** Whether a tile should draw no dwell state: guarded, or showing a latch the guard swallowed. */
export function isQuiet(action: string, snapshot: GazeSnapshot): boolean {
  return isGuarded(action, snapshot) || (ignored === action && snapshot.state === 'selected' && snapshot.action === action);
}

/** A selection the guard swallowed still latches inside the engine; its latch is not drawn. */
let ignored: string | null = null;
export function markIgnored(action: string | null): void { ignored = action; }

/**
 * A quadrant whose owner changes while gaze rests in it (a quiet tile becomes active when speech
 * ends, a slot relabels from rest to "Not now") is guarded too: gaze has not moved, so nothing
 * there may fire until it leaves and comes back, even an action with the same id as the last
 * selection (Q4 is `delete` whether it says One moment, Not now or Menu).
 */
let previous: { quadrant: QuadrantId | null; looked: string | null } = { quadrant: null, looked: null };
engine.subscribe((s) => {
  if (guard && s.quadrant !== guard.quadrant) guard = null;
  if (s.quadrant && s.quadrant === previous.quadrant && s.looked !== previous.looked && s.looked) {
    guard = { quadrant: s.quadrant, action: '' };
  }
  previous = { quadrant: s.quadrant, looked: s.looked };
});

/**
 * Whether the selection being emitted came from a key. Keyboard-triggered actions get no motion
 * (MOTION.md), so tiles skip the bloom for them. Set just before `engine.activate`, cleared
 * after the select event has been handled.
 */
let byKey = false;
export function noteKeyActivation(value: boolean): void { byKey = value; }
export function lastActivationByKey(): boolean { return byKey; }

/** True while the pointer (the simulated eyes) is off the page; no dwell may select then. */
let outside = false;
export function gazeOutside(): boolean { return outside; }

/**
 * Keyboard-triggered actions get no motion (MOTION.md): a key press sets `data-instant` on the
 * root for the frames its state change renders in, which turns transitions off.
 */
export function suppressMotionBriefly(): void {
  const root = document.documentElement;
  root.setAttribute('data-instant', '');
  window.clearTimeout(instantTimer);
  instantTimer = window.setTimeout(() => root.removeAttribute('data-instant'), 160);
}
let instantTimer = 0;
