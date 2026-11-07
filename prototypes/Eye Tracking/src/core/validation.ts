import { calibrationPoints, READING_MS } from './calibration';
import { compareCorrections, type CorrectionReport } from './calibration-models';
import { STALE_MS } from './dwell';
import type { GazeFrame, Point, Viewport } from './tracking';

export const VALIDATION = {
  durationMs: 60_000, targets: 10, slotMs: 6000, moveMs: 1200, settleMs: 1200,
  binMs: 100, minimumCoverage: .5, minimumTargets: 8, minimumBins: 100,
} as const;
export type CheckCondition = 'still' | 'turn';
export type CheckMotion = 'smooth' | 'reduced';
export type PauseReason = 'manual' | 'hidden' | 'focus' | 'settings';
export type CancelReason = 'manual' | 'restart' | 'viewport' | 'motion' | 'session';
type Metrics = { coverage: number; measurementMs: number; coveredMs: number; bins: number; targets: number };
export type ValidationResult = Metrics & { condition: CheckCondition; motion: CheckMotion; viewport: Viewport } & (
  /** `corrections`: how each screen-space correction model would score on this run, leave-one-target-out. */
  | { kind: 'measured'; medianPx: number; p90Px: number; corrections: CorrectionReport | null }
  | { kind: 'insufficient' }
);
export type ValidationState =
  | { kind: 'ready' }
  | { kind: 'intro'; remainingMs: number }
  | { kind: 'intro-paused'; remainingMs: number; reason: PauseReason }
  | { kind: 'running'; elapsedMs: number }
  | { kind: 'paused'; elapsedMs: number; reason: PauseReason }
  | { kind: 'complete'; result: ValidationResult }
  | { kind: 'cancelled'; reason: CancelReason };
export type ValidationPosition = { point: Point; target: Point; index: number; stage: 'moving' | 'settling' | 'measuring' };

const anchors = [[.1, .12], [.46, .1], [.88, .1], [.11, .47], [.4, .4], [.88, .47], [.1, .88], [.46, .88], [.88, .88], [.65, .65]];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Bounded stratified jitter plus a finite fallback grid; never reuse an eye/head training reference. */
export function validationTargets(viewport: Viewport, random = Math.random): Point[] {
  if (![viewport.width, viewport.height].every(n => Number.isFinite(n) && n >= 160)) throw new Error('The window is too small for a reference check. Enlarge it and try again.');
  const margin = Math.max(24, Math.min(56, viewport.width * .1, viewport.height * .1));
  const width = viewport.width - margin * 2, height = viewport.height - margin * 2;
  const training = [...calibrationPoints(viewport), ...calibrationPoints(viewport, 'head')];
  const separation = Math.min(40, Math.min(viewport.width, viewport.height) * .065);
  const unit = () => { const n = random(); return Number.isFinite(n) ? Math.max(0, Math.min(1 - Number.EPSILON, n)) : .5; };
  const result: Point[] = [];
  const usable = (point: Point) => !(point.x > viewport.width - 80 && point.y < 80) && training.every(p => distance(p, point) >= separation) && result.every(p => distance(p, point) >= separation);
  for (const [x, y] of anchors) {
    let chosen: Point | undefined;
    for (let attempt = 0; attempt < 12; attempt++) {
      const point = { x: margin + (x + (unit() - .5) * .05) * width, y: margin + (y + (unit() - .5) * .05) * height };
      if (usable(point)) { chosen = point; break; }
    }
    // Even a constant/broken random source has a bounded deterministic fallback.
    for (let cell = 0; !chosen && cell < 169; cell++) {
      const point = { x: margin + (cell % 13) / 12 * width, y: margin + Math.floor(cell / 13) / 12 * height };
      if (usable(point)) chosen = point;
    }
    if (!chosen) throw new Error('There is not enough room for separate check targets. Enlarge the window.');
    result.push(chosen);
  }
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(unit() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** One active-time schedule drives both the displayed position and captured-time admission. */
export function validationPosition(targets: readonly Point[], viewport: Viewport, elapsedMs: number, motion: CheckMotion): ValidationPosition {
  const time = Math.max(0, Math.min(VALIDATION.durationMs - .001, elapsedMs));
  const index = Math.floor(time / VALIDATION.slotMs), local = time % VALIDATION.slotMs;
  const target = targets[index];
  const from = index ? targets[index - 1] : { x: viewport.width / 2, y: viewport.height / 2 };
  const t = Math.min(1, local / VALIDATION.moveMs), eased = t * t * (3 - 2 * t);
  const point = motion === 'reduced' ? target : { x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased };
  return { point, target, index, stage: local < VALIDATION.moveMs ? 'moving' : local < VALIDATION.moveMs + VALIDATION.settleMs ? 'settling' : 'measuring' };
}

/** Pure, memory-only run. No camera, collection, adaptation, DOM, persistence or speech access. */
export class ValidationRun {
  state: ValidationState = { kind: 'ready' };
  readonly targets: readonly Point[];
  readonly viewport: Viewport;
  private segment: { wallStart: number; activeStart: number } | null = null;
  private lastWall = -Infinity;
  private lastFrame = -Infinity;
  /** The reference the most recently admitted sample was measured against (for development replay only). */
  lastAdmitted: { at: number; target: Point; index: number } | null = null;
  private settleUntil = 0;
  private readonly eligible = new Float64Array(VALIDATION.durationMs / VALIDATION.binMs);
  private readonly samples: ({ error: number; target: number; raw: Point } | undefined)[] = Array.from({ length: this.eligible.length });

  constructor(viewport: Viewport, readonly condition: CheckCondition, readonly motion: CheckMotion, random = Math.random) {
    this.viewport = { ...viewport };
    this.targets = validationTargets(viewport, random);
  }
  get position(): ValidationPosition | null {
    if (this.state.kind !== 'running' && this.state.kind !== 'paused') return null;
    const position = validationPosition(this.targets, this.viewport, this.state.elapsedMs, this.motion);
    return position.stage === 'measuring' && this.state.elapsedMs < this.settleUntil ? { ...position, stage: 'settling' } : position;
  }
  introduce(now: number): void {
    if (this.state.kind !== 'ready') return;
    this.state = { kind: 'intro', remainingMs: READING_MS }; this.lastWall = now;
  }
  start(now: number): boolean {
    if (!['ready', 'intro', 'intro-paused'].includes(this.state.kind) || !Number.isFinite(now)) return false;
    this.segment = { wallStart: now, activeStart: 0 }; this.lastWall = now; this.lastFrame = now;
    this.state = { kind: 'running', elapsedMs: 0 }; return true;
  }
  tick(now: number, visible = true): void {
    if (!Number.isFinite(now) || now < this.lastWall) return;
    if (this.state.kind === 'intro') {
      if (!visible) { this.state = { ...this.state, kind: 'intro-paused', reason: 'focus' }; return; }
      const remainingMs = Math.max(0, this.state.remainingMs - (now - this.lastWall));
      this.lastWall = now;
      if (remainingMs) this.state = { kind: 'intro', remainingMs };
      else this.start(now);
      return;
    }
    if (this.state.kind !== 'running' || !this.segment) return;
    // If a visibility notification was missed, do not advance or animate hidden time.
    if (!visible) { this.pause(this.lastWall, 'hidden'); return; }
    const elapsedMs = Math.min(VALIDATION.durationMs, this.segment.activeStart + now - this.segment.wallStart);
    for (let index = Math.floor(this.state.elapsedMs / VALIDATION.binMs); index < this.eligible.length && index * VALIDATION.binMs < elapsedMs; index++) {
      const slotStart = Math.floor(index * VALIDATION.binMs / VALIDATION.slotMs) * VALIDATION.slotMs;
      const from = Math.max(this.state.elapsedMs, index * VALIDATION.binMs, slotStart + VALIDATION.moveMs + VALIDATION.settleMs, this.settleUntil);
      const to = Math.min(elapsedMs, (index + 1) * VALIDATION.binMs);
      this.eligible[index] += Math.max(0, to - from);
    }
    this.lastWall = now;
    this.state = elapsedMs < VALIDATION.durationMs ? { kind: 'running', elapsedMs } : { kind: 'complete', result: this.result() };
    if (this.state.kind === 'complete') { this.segment = null; this.releaseSamples(); }
  }
  pause(now: number, reason: PauseReason): void {
    if (this.state.kind === 'intro') { this.state = { ...this.state, kind: 'intro-paused', reason }; return; }
    this.tick(now);
    if (this.state.kind !== 'running') return;
    this.state = { kind: 'paused', elapsedMs: this.state.elapsedMs, reason }; this.segment = null;
  }
  resume(now: number): boolean {
    if (!Number.isFinite(now) || now < this.lastWall) return false;
    if (this.state.kind === 'intro-paused') { this.state = { kind: 'intro', remainingMs: this.state.remainingMs }; this.lastWall = now; return true; }
    if (this.state.kind !== 'paused') return false;
    const { elapsedMs } = this.state;
    this.segment = { wallStart: now, activeStart: elapsedMs }; this.lastWall = now; this.lastFrame = now;
    // A new complete settle consumes active time inside the same 60-second budget.
    this.settleUntil = Math.min(VALIDATION.durationMs, elapsedMs + VALIDATION.settleMs);
    this.state = { kind: 'running', elapsedMs }; return true;
  }
  admit(frame: GazeFrame, now: number, visible = true): boolean {
    if (!Number.isFinite(now) || now < this.lastWall) return false;
    this.tick(now, visible);
    if (this.state.kind !== 'running' || !this.segment || !Number.isFinite(frame.at) || frame.at <= this.lastFrame || frame.at < this.segment.wallStart || frame.at > now || now - frame.at > STALE_MS) return false;
    this.lastFrame = frame.at;
    // rawPoint is the pre-Kalman, unclipped estimator output; never fall back to the visual point.
    const raw = frame.rawPoint;
    if (!frame.face || !frame.facePresent || frame.eyeState !== 'open' || !raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return false;
    const time = this.segment.activeStart + frame.at - this.segment.wallStart;
    const position = validationPosition(this.targets, this.viewport, time, this.motion);
    if (time >= VALIDATION.durationMs || time < this.settleUntil || position.stage !== 'measuring') return false;
    const index = Math.floor(time / VALIDATION.binMs);
    if (this.samples[index]) return false;
    const error = distance(raw, position.target);
    if (!Number.isFinite(error)) return false;
    this.samples[index] = { error, target: position.index, raw: { x: raw.x, y: raw.y } };
    this.lastAdmitted = { at: frame.at, target: { ...position.target }, index: position.index };
    return true;
  }
  cancel(reason: CancelReason): void {
    this.state = { kind: 'cancelled', reason }; this.segment = null; this.releaseSamples();
  }
  private releaseSamples(): void { this.samples.fill(undefined); this.eligible.fill(0); }
  private result(): ValidationResult {
    const errors: number[] = [], targets = new Set<number>();
    let measurementMs = 0, coveredMs = 0;
    for (let index = 0; index < this.eligible.length; index++) {
      const duration = this.eligible[index], sample = this.samples[index]; measurementMs += duration;
      if (duration > 0 && sample) { coveredMs += duration; errors.push(sample.error); targets.add(sample.target); }
    }
    const coverage = measurementMs > 0 ? coveredMs / measurementMs : 0;
    const metrics = { coverage, measurementMs, coveredMs, bins: errors.length, targets: targets.size, condition: this.condition, motion: this.motion, viewport: this.viewport };
    if (coverage < VALIDATION.minimumCoverage || errors.length < VALIDATION.minimumBins || targets.size < VALIDATION.minimumTargets) return { ...metrics, kind: 'insufficient' };
    const corrections = compareCorrections(this.samples.flatMap((sample, index) => (sample && this.eligible[index] > 0 ? [{ estimate: sample.raw, target: sample.target }] : [])), this.targets, this.viewport);
    errors.sort((a, b) => a - b);
    const middle = Math.floor(errors.length / 2);
    return { ...metrics, kind: 'measured', medianPx: errors.length % 2 ? errors[middle] : errors[middle - 1] + (errors[middle] - errors[middle - 1]) / 2, p90Px: errors[Math.ceil(.9 * errors.length) - 1], corrections };
  }
}
