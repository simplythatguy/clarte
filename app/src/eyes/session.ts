/**
 * The eyes of the app: one tracker for the whole session, the saved calibration, the quick
 * calibration run, and the feed into the gaze engine.
 *
 * Calibration is Gaze Lab's quick Q8 run (DEC-097): a 2 s intro, then one dot at the centre of each
 * backend quadrant in snake order (top row left to right, bottom row right to left). Each dot moves
 * for 600 ms, waits 300 ms, and collects for 1 s: every fresh frame with a face and open eyes is a
 * label. About 20 s in all, then the worker trains. The learned head is saved on this browser and
 * restored at every launch, until the person recalibrates from the menu or the camera or window
 * changes enough that the saved one no longer fits.
 *
 * Every run starts in a fresh worker (`EyeTracker.reset`): a worker accepts labels only before it
 * has trained or restored a calibration, and keeps a failed run's samples. The calibration in use
 * is kept in memory, so leaving a run or a run that does not train puts it back.
 *
 * While a calibration drives looks, every frame feeds the gaze engine: the smoothed point, or no
 * gaze when no face is found or the eyes are closed (the engine's blink grace covers a blink).
 */
import { useEffect, useState } from 'react';
import { EyeTracker, type EyeFrame } from './tracker.ts';
import { SavedCalibrationStore, calibrationCompatibility, type CalibrationGeometry, type LearnedCalibration } from './core/saved-calibration';
import { quadrantRect, type QuadrantId, type Viewport } from '../core/quadrants.ts';
import type { GazeEngine } from '../core/gaze.ts';

// Temporarily 1600 ms a dot for the demo video (owner, 2026-11-09): a slow camera or a blink no longer fails the run (was 1000).
export const TIMING = { introMs: 2000, moveMs: 600, waitMs: 300, collectMs: 1600 } as const;
const DOT_MS = TIMING.moveMs + TIMING.waitMs + TIMING.collectMs;
/** Q1 Q2 Q3 Q4, then Q8 Q7 Q6 Q5: the dot never jumps across the screen. */
export const ORDER: readonly QuadrantId[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q8', 'Q7', 'Q6', 'Q5'];
export const RUN_MS = TIMING.introMs + ORDER.length * DOT_MS;

export type Dot = { quadrant: QuadrantId; x: number; y: number };
export type RunPosition =
  | { phase: 'intro'; progress: number }
  | { phase: 'move' | 'wait' | 'collect'; index: number; dot: Dot; progress: number };

export function dotsFor(viewport: Viewport): Dot[] {
  return ORDER.map((quadrant) => {
    const r = quadrantRect(quadrant, viewport);
    return { quadrant, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
}

/** Where a run is `elapsed` ms after it started; null once every dot has collected. */
export function positionAt(elapsed: number, dots: readonly Dot[]): RunPosition | null {
  if (elapsed < 0 || elapsed >= RUN_MS) return null;
  if (elapsed < TIMING.introMs) return { phase: 'intro', progress: elapsed / TIMING.introMs };
  const inDots = elapsed - TIMING.introMs;
  const index = Math.floor(inDots / DOT_MS);
  const t = inDots - index * DOT_MS;
  const dot = dots[index];
  if (t < TIMING.moveMs) return { phase: 'move', index, dot, progress: t / TIMING.moveMs };
  if (t < TIMING.moveMs + TIMING.waitMs) return { phase: 'wait', index, dot, progress: (t - TIMING.moveMs) / TIMING.waitMs };
  return { phase: 'collect', index, dot, progress: (t - TIMING.moveMs - TIMING.waitMs) / TIMING.collectMs };
}

export type EyesStatus =
  | { kind: 'off' }
  | { kind: 'starting' }
  /** A calibration is in use: looks drive the app. */
  | { kind: 'tracking'; calibratedAt: number }
  /** The camera runs but no calibration is in use; `reason` says why a saved one was not used. */
  | { kind: 'uncalibrated'; reason: string | null }
  /** A fresh worker is starting for a run. */
  | { kind: 'preparing' }
  | { kind: 'calibrating'; startedAt: number | null; labels: number }
  | { kind: 'training' }
  /** A run did not train. With `fallback`, the calibration in use before it is back and drives looks. */
  | { kind: 'run-failed'; reason: string; fallback: boolean }
  /** The camera or the tracker stopped. */
  | { kind: 'failed'; message: string };

const store = new SavedCalibrationStore();
const tracker = new EyeTracker();
let status: EyesStatus = { kind: 'off' };
let target: GazeEngine | null = null;
let run: { startedAt: number | null; dots: Dot[]; labels: number; viewport: Viewport } | null = null;
/** The calibration the tracker is using, kept so a cancelled or failed run can put it back. */
let inUse: { learned: LearnedCalibration; savedAt: number } | null = null;
let faceSeen = false;
const listeners = new Set<() => void>();

function set(next: EyesStatus): void {
  status = next;
  for (const fn of listeners) fn();
}

/** True when the camera or the tracker has failed since the caller last awaited. */
const stopped = () => status.kind === 'failed';

export function eyesStatus(): EyesStatus { return status; }

/** Whether looks come from the eyes now (else the mouse stands in). */
export function eyesDrive(): boolean {
  return status.kind === 'tracking' || (status.kind === 'run-failed' && status.fallback);
}

export function useEyesStatus(): EyesStatus {
  const [, bump] = useState(0);
  useEffect(() => { const fn = () => bump((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  return status;
}

/** Whether a face was in the last frame: the calibration screen waits for one before its dots. */
export function faceInView(): boolean { return faceSeen; }

function geometryNow(): CalibrationGeometry | null {
  const camera = tracker.geometry();
  return camera ? { viewport: { width: window.innerWidth, height: window.innerHeight }, camera, pixelRatio: window.devicePixelRatio || 1 } : null;
}

function onFrame({ at, face, frame }: EyeFrame): void {
  if (face !== faceSeen) { faceSeen = face; for (const fn of listeners) fn(); }
  if (run) { label(at, face); return; }
  if (!eyesDrive() || !target) return;
  if (frame.point) target.sample(frame.point.x, frame.point.y);
  else target.sample(null, null);
}

function label(at: number, face: boolean): void {
  const r = run;
  if (!r || r.startedAt === null) return;
  const pos = positionAt(at - r.startedAt, r.dots);
  if (!pos || pos.phase !== 'collect' || !face) return;
  const norm: [number, number] = [pos.dot.x / r.viewport.width - 0.5, pos.dot.y / r.viewport.height - 0.5];
  void tracker.collect(norm, at).then((ok) => {
    if (ok && run === r && status.kind === 'calibrating') { r.labels++; set({ kind: 'calibrating', startedAt: r.startedAt, labels: r.labels }); }
  });
}

function onFailure(error: unknown): void {
  run = null;
  inUse = null;
  set({ kind: 'failed', message: messageOf(error) });
}

function messageOf(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'The camera is blocked. Allow it for this page, then try again.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No camera was found.';
  return error instanceof Error ? error.message : 'The eye tracker stopped.';
}

/** Put `learned` into a fresh worker. False when the tracker refused it. */
async function useCalibration(learned: LearnedCalibration): Promise<boolean> {
  await tracker.reset();
  return !stopped() && (await tracker.restore(learned));
}

/**
 * Start the camera and the tracker, then restore the saved calibration when it fits this camera
 * and window. Resolves to the status it reached: `tracking`, `uncalibrated` or `failed`.
 */
export async function startEyes(engine: GazeEngine): Promise<EyesStatus> {
  target = engine;
  if (status.kind !== 'off' && status.kind !== 'failed') return status;
  set({ kind: 'starting' });
  try {
    await tracker.start(onFrame, onFailure);
  } catch (error) {
    tracker.stop();
    set({ kind: 'failed', message: messageOf(error) });
    return status;
  }
  let reason: string | null = null;
  try {
    const saved = store.load();
    const geometry = geometryNow();
    if (saved && geometry) {
      // Browsers do not keep a camera's deviceId across page loads (Safari changes it every session), so
      // only the camera's shape and the window size decide whether the saved calibration still fits.
      const fit = calibrationCompatibility(saved.geometry, { ...geometry, camera: { ...geometry.camera, deviceId: saved.geometry.camera.deviceId } });
      if (fit.compatible && (await tracker.restore(saved.learned))) {
        inUse = { learned: saved.learned, savedAt: saved.savedAt };
        set({ kind: 'tracking', calibratedAt: saved.savedAt });
        return status;
      }
      reason = fit.compatible ? 'The saved calibration could not be restored.' : fit.message;
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : 'The saved calibration could not be read.';
  }
  if (!stopped()) set({ kind: 'uncalibrated', reason });
  return status;
}

/** Arm a calibration run in a fresh worker; its dots start with `beginRun` once a face is in view. */
export async function prepareRun(): Promise<void> {
  if (!tracker.running() || !['tracking', 'uncalibrated', 'run-failed'].includes(status.kind)) return;
  set({ kind: 'preparing' });
  target?.sample(null, null);
  try {
    await tracker.reset();
  } catch (error) {
    if (!stopped()) onFailure(error);
    return;
  }
  if (stopped()) return;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  run = { startedAt: null, dots: dotsFor(viewport), labels: 0, viewport };
  set({ kind: 'calibrating', startedAt: null, labels: 0 });
}

export function beginRun(at = performance.now()): void {
  if (!run || run.startedAt !== null) return;
  run.startedAt = at;
  set({ kind: 'calibrating', startedAt: at, labels: 0 });
}

export function runDots(): Dot[] { return run?.dots ?? []; }

/** Called every animation frame by the calibration screen: ends the run on time even without frames. */
export function tickRun(now = performance.now()): void {
  if (run?.startedAt != null && now - run.startedAt >= RUN_MS) void finishRun();
}

/** Leave a run without training: the calibration in use before it, if any, is put back. */
export async function cancelRun(): Promise<void> {
  if (!['preparing', 'calibrating', 'run-failed'].includes(status.kind)) return;
  run = null;
  if (status.kind === 'run-failed' && status.fallback && inUse) { set({ kind: 'tracking', calibratedAt: inUse.savedAt }); return; }
  const previous = inUse;
  if (!previous) { set({ kind: 'uncalibrated', reason: null }); return; }
  try {
    if (await useCalibration(previous.learned)) { set({ kind: 'tracking', calibratedAt: previous.savedAt }); return; }
  } catch (error) {
    if (stopped()) return;
  }
  if (stopped()) return;
  inUse = null;
  set({ kind: 'uncalibrated', reason: 'The calibration in use could not be put back.' });
}

async function finishRun(): Promise<void> {
  if (!run || status.kind !== 'calibrating') return;
  run = null;
  set({ kind: 'training' });
  try {
    await tracker.train();
    const learned = await tracker.exportCalibration();
    const geometry = geometryNow();
    if (stopped()) return;
    if (!learned || !geometry) throw new Error('Calibration did not finish.');
    // Another tab may have saved since this one last read: read it, then this run's calibration wins.
    const saved = store.save(learned, geometry, store.lease) ?? (store.load(), store.save(learned, geometry, store.lease));
    inUse = { learned, savedAt: saved?.savedAt ?? Date.now() };
    set({ kind: 'tracking', calibratedAt: inUse.savedAt });
  } catch (error) {
    if (stopped()) return;
    const reason = 'Calibration did not finish. Keep your face in view and look at each dot until its ring closes.';
    let fallback = false;
    if (inUse) { try { fallback = await useCalibration(inUse.learned); } catch { fallback = false; } }
    if (stopped()) return;
    if (!fallback) inUse = null;
    set({ kind: 'run-failed', reason, fallback });
  }
}
