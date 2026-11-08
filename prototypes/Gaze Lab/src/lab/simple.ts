import type { Point, Viewport } from '../core/tracking';
import { blockSeed } from './protocol';
import { seededRandom, shuffle } from './layout';
import type { QuickTarget } from './quick';

/**
 * The simple flow: calibration on the 8 quadrant centres, a test on the same 8 quadrants, one result. The quadrants
 * are the app's navigation grid (4 columns × 2 rows, `inset: 76px clamp(16px, 4vw, 52px) 24px; gap: 20px`), so a hit
 * here is a hit on the real buttons. Everything in this file is pure and time-driven; the app only renders it.
 */
export const GRID = { top: 76, bottom: 24, gap: 20, sideMin: 16, sideVw: .04, sideMax: 52, columns: 4, rows: 2 } as const;
export const QUADRANT_COUNT = GRID.columns * GRID.rows;
export type Rect = { x: number; y: number; width: number; height: number };
export type Quadrant = { id: number; row: number; column: number; rect: Rect; centre: Point };

export function sideInset(viewport: Viewport): number { return Math.min(GRID.sideMax, Math.max(GRID.sideMin, GRID.sideVw * viewport.width)); }
/** The 8 quadrants in row-major order (id = row × 4 + column), exactly where the app draws its navigation buttons. */
export function quadrants(viewport: Viewport): Quadrant[] {
  const side = sideInset(viewport);
  const width = (viewport.width - 2 * side - (GRID.columns - 1) * GRID.gap) / GRID.columns;
  const height = (viewport.height - GRID.top - GRID.bottom - (GRID.rows - 1) * GRID.gap) / GRID.rows;
  return Array.from({ length: QUADRANT_COUNT }, (_, id) => {
    const row = Math.floor(id / GRID.columns), column = id % GRID.columns;
    const rect = { x: side + column * (width + GRID.gap), y: GRID.top + row * (height + GRID.gap), width, height };
    return { id, row, column, rect, centre: { x: rect.x + width / 2, y: rect.y + height / 2 } };
  });
}
/** Distance from a point to a rectangle: 0 inside, else the gap to its nearest edge or corner. */
export function rectDistance(p: Point, r: Rect): number {
  return Math.hypot(Math.max(0, r.x - p.x, p.x - (r.x + r.width)), Math.max(0, r.y - p.y, p.y - (r.y + r.height)));
}
/** The quadrant a point selects: the one containing it, else the nearest (a point in a gap or margin still selects one). Ties go to the lower id. */
export function nearestQuadrant(p: Point, qs: readonly Quadrant[]): number {
  let best = qs[0].id, bestD = Infinity;
  for (const q of qs) { const d = rectDistance(p, q.rect); if (d < bestD) { bestD = d; best = q.id; } }
  return best;
}
/** Where a 1.5 s look lands: the per-axis median of the frames' estimates (px), then the quadrant that point selects; null without frames. */
export function decideQuadrant(points: readonly Point[], qs: readonly Quadrant[]): number | null {
  const xs = points.map(p => p.x).filter(Number.isFinite), ys = points.map(p => p.y).filter(Number.isFinite);
  if (!xs.length || xs.length !== ys.length) return null;
  return nearestQuadrant({ x: medianOf(xs), y: medianOf(ys) }, qs);
}
function medianOf(values: number[]): number { const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
/** A frame counts for a decision when a face was found with open eyes and the stream has a finite estimate. */
export function usablePoint(frame: { facePresent: boolean; eyeState: string }, estimate: readonly number[] | null | undefined, viewport: Viewport): Point | null {
  if (!frame.facePresent || frame.eyeState !== 'open' || !estimate || estimate.length !== 2 || !estimate.every(Number.isFinite)) return null;
  return { x: (estimate[0] + .5) * viewport.width, y: (estimate[1] + .5) * viewport.height };
}

/** The Q8 calibration dots for this flow: the quadrant centres in snake order (top row left→right, bottom row right→left). */
export function calibrationTargets(qs: readonly Quadrant[], viewport: Viewport): QuickTarget[] {
  const top = qs.filter(q => q.row === 0).sort((a, b) => a.column - b.column), bottom = qs.filter(q => q.row === 1).sort((a, b) => b.column - a.column);
  return [...top, ...bottom].map((q, index) => ({ index, column: q.column, row: q.row, x: q.centre.x, y: q.centre.y, nx: q.centre.x / viewport.width - .5, ny: q.centre.y / viewport.height - .5, cell: q.id, validationIndex: (q.row + 1) * 4 + q.column }));
}

/** The baseline model: the primary worker with the same raised collect/train limits, shipped training and shipped blend rule. */
export const BASELINE_WORKER = { limits: { maxSamples: 200, minSamples: 24, minTargets: 8 } } as const;

/** One trial: the quadrant is highlighted with a dot at its centre; 0.9 s to settle, a 1.5 s record window, then (with feedback) 0.4 s showing the decision. */
export const TRIAL_TIMING = { settleMs: 900, recordMs: 1500, feedbackMs: 400 } as const;
export type TrialTiming = { settleMs: number; recordMs: number; feedbackMs: number };
export type TrialPhase = 'settle' | 'record' | 'feedback';
export type Trial = { index: number; round: number; quadrant: number };
export type Round = { round: number; seed: number; order: number[] };
/** `rounds` rounds, each a fresh seeded random order of all 8 quadrants (seed per round from the session seed, recorded). */
export function trialSchedule(rounds: number, sessionSeed: number): { rounds: Round[]; trials: Trial[] } {
  const out: Round[] = [];
  for (let r = 1; r <= rounds; r++) { const seed = blockSeed(sessionSeed, `R${r}`); out.push({ round: r, seed, order: shuffle(Array.from({ length: QUADRANT_COUNT }, (_, i) => i), seededRandom(seed)) }); }
  return { rounds: out, trials: out.flatMap(r => r.order.map(quadrant => ({ index: -1, round: r.round, quadrant }))).map((t, index) => ({ ...t, index })) };
}

export type TrialState =
  | { kind: 'ready' }
  | { kind: 'running'; index: number; startedAt: number }
  | { kind: 'paused'; index: number }
  | { kind: 'complete' };
export type TrialPosition = { index: number; trial: Trial; attempt: number; phase: TrialPhase; progress: number };

/**
 * Pure, time-driven run of the trials. Pausing restarts the current trial from its settle phase on resume (no partial
 * record window is kept); `back()` on a paused run steps to the previous trial so it is redone. `attempts[i]` counts
 * how often trial i was started; frames carry the attempt so the analysis keeps only the last one.
 */
export class TrialRun {
  state: TrialState = { kind: 'ready' };
  readonly attempts: number[];
  private lastFrameAt = -Infinity;
  constructor(readonly trials: readonly Trial[], readonly timing: TrialTiming = TRIAL_TIMING, readonly feedback = true) { this.attempts = trials.map(() => 0); }
  get trialMs(): number { return this.timing.settleMs + this.timing.recordMs + (this.feedback ? this.timing.feedbackMs : 0); }
  start(now: number): boolean {
    if (this.state.kind !== 'ready' && this.state.kind !== 'paused') return false;
    const index = this.state.kind === 'paused' ? this.state.index : 0;
    if (index >= this.trials.length) { this.state = { kind: 'complete' }; return false; }
    this.attempts[index]++;
    this.state = { kind: 'running', index, startedAt: now };
    return true;
  }
  pause(): boolean {
    if (this.state.kind !== 'running') return false;
    this.state = { kind: 'paused', index: this.state.index };
    return true;
  }
  /** On a paused run, steps back to the previous trial so that `start` redoes it. */
  back(): boolean {
    if (this.state.kind !== 'paused' || this.state.index === 0) return false;
    this.state = { kind: 'paused', index: this.state.index - 1 };
    return true;
  }
  /** Advances to later trials as time passes (each new trial is attempt 1 of itself); completes after the last one. */
  tick(now: number): void {
    if (this.state.kind !== 'running') return;
    let { index, startedAt } = this.state;
    while (now - startedAt >= this.trialMs) {
      startedAt += this.trialMs; index++;
      if (index >= this.trials.length) { this.state = { kind: 'complete' }; return; }
      this.attempts[index]++;
    }
    this.state = { kind: 'running', index, startedAt };
  }
  position(at: number): TrialPosition | null {
    if (this.state.kind !== 'running') return null;
    const elapsed = at - this.state.startedAt;
    if (elapsed < 0 || elapsed >= this.trialMs) return null;
    const index = this.state.index, trial = this.trials[index], attempt = this.attempts[index];
    if (elapsed < this.timing.settleMs) return { index, trial, attempt, phase: 'settle', progress: elapsed / this.timing.settleMs };
    const record = elapsed - this.timing.settleMs;
    if (record < this.timing.recordMs) return { index, trial, attempt, phase: 'record', progress: record / this.timing.recordMs };
    return { index, trial, attempt, phase: 'feedback', progress: (record - this.timing.recordMs) / this.timing.feedbackMs };
  }
  /** Classifies a camera frame captured at `at`; frames out of order or repeated are rejected. */
  classify(at: number): TrialPosition | null {
    if (!Number.isFinite(at) || at <= this.lastFrameAt) return null;
    this.lastFrameAt = at;
    return this.position(at);
  }
}

/**
 * Free look, the default test: no target, the person looks wherever they like and a 2 s look selects a quadrant. The rules
 * follow Clarte's UI gaze engine (prototypes/UI/v0/shared/gaze.ts, repeat 'leave') so the test feels like the app: the look
 * moves on once it has been off the current quadrant for holdMs, and a selected quadrant stays latched until the look has
 * been off it for rearmMs, so one long look selects once. Differences: the hold counts time off the current quadrant wherever
 * the look went, so flicker between two other quadrants cannot keep the one it left; the 2 s counts from when the look left
 * the previous quadrant, so it is 2 s of looking; and there is no grace window, because with a 150 ms hold on the way back
 * the engine's 150 ms grace can never forgive a glance, only delay the mark. The selection shows for feedbackMs, as long as
 * a guided trial's feedback.
 */
export const DWELL_TIMING = { dwellMs: 2000, holdMs: 150, rearmMs: 300, feedbackMs: TRIAL_TIMING.feedbackMs } as const;
export type DwellTiming = { dwellMs: number; holdMs: number; rearmMs: number; feedbackMs: number };
export type DwellState =
  | { kind: 'idle' }
  | { kind: 'dwelling'; quadrant: number; since: number }
  | { kind: 'selected'; quadrant: number; at: number; offSince: number | null };
export type Selection = { quadrant: number; at: number; dwellStartedAt: number };

/** Pure, frame-driven dwell over the live quadrant (capture time); `step` returns the selection a frame completes. */
export class Dwell {
  state: DwellState = { kind: 'idle' };
  /** The quadrant the look is on once the hold has passed, null when none, and when the look left the one before. */
  current: { quadrant: number; since: number } | null = null;
  /** When the live quadrant stopped being `current`; null while it is. */
  private leftAt: number | null = null;
  private lastAt = -Infinity;
  constructor(readonly timing: DwellTiming = DWELL_TIMING) {}
  /** The quadrant to mark: the one being dwelt on, else the one looked at. */
  get quadrant(): number | null { return this.state.kind === 'dwelling' ? this.state.quadrant : this.current?.quadrant ?? null; }
  /**
   * How far the marked quadrant's dwell is: none on a latched quadrant; on one the look moved to after a selection, it already
   * counts from the look's arrival (as the dwell will once the old quadrant re-arms), so the fill never jumps.
   */
  progress(now: number): number {
    const s = this.state, since = s.kind === 'dwelling' ? s.since : s.kind === 'selected' && this.current && this.current.quadrant !== s.quadrant ? this.current.since : null;
    return since === null ? 0 : Math.min(1, Math.max(0, (now - since) / this.timing.dwellMs));
  }
  step(at: number, live: number | null): Selection | null {
    if (!Number.isFinite(at) || at <= this.lastAt) return null;
    this.lastAt = at;
    this.hold(at, live);
    const looked = this.current, s = this.state;
    if (s.kind === 'selected') {
      if (looked?.quadrant === s.quadrant) { this.state = { ...s, offSince: null }; return null; }
      if (s.offSince === null) { this.state = { ...s, offSince: at }; return null; }
      if (at - s.offSince < this.timing.rearmMs) return null;
    }
    if (!looked) { this.state = { kind: 'idle' }; return null; }
    if (s.kind !== 'dwelling' || s.quadrant !== looked.quadrant) { this.state = { kind: 'dwelling', quadrant: looked.quadrant, since: looked.since }; return null; }
    if (at - s.since < this.timing.dwellMs) return null;
    this.state = { kind: 'selected', quadrant: s.quadrant, at, offSince: null };
    return { quadrant: s.quadrant, at, dwellStartedAt: s.since };
  }
  /** Once the look has been off `current` for holdMs, the live quadrant takes over; losing the look (null) takes over at once. */
  private hold(at: number, live: number | null): void {
    if (live === (this.current?.quadrant ?? null)) { this.leftAt = null; return; }
    this.leftAt ??= at;
    if (live !== null && at - this.leftAt < this.timing.holdMs) return;
    this.current = live === null ? null : { quadrant: live, since: this.leftAt };
    this.leftAt = null;
  }
}

/** Hit counts per quadrant from per-trial decisions (null decisions count as attempted, not hit). */
export function tally(trials: readonly Trial[], decisions: readonly (number | null)[]): { hits: number[]; shown: number[]; correct: number; total: number } {
  const hits = Array.from({ length: QUADRANT_COUNT }, () => 0), shown = Array.from({ length: QUADRANT_COUNT }, () => 0);
  trials.forEach((t, i) => { if (i >= decisions.length) return; shown[t.quadrant]++; if (decisions[i] === t.quadrant) hits[t.quadrant]++; });
  const total = shown.reduce((a, b) => a + b, 0);
  return { hits, shown, correct: hits.reduce((a, b) => a + b, 0), total };
}
