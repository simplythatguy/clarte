import type { Viewport } from '../core/tracking';
import { COLUMNS, cellOf, type Target } from './layout';

/**
 * Q8, the quick calibration under test: 8 dots at the 4×2 cell centres, in snake order, each shown with the block dot's
 * visuals and timing (600 ms CSS move + 300 ms wait, the "0.9 s to settle" the offline budget run depended on), then a
 * 1.0 s collection window in which every fresh frame with a face and open eyes is a label. A 2 s one-line intro precedes
 * the dots. It runs in a shadow worker initialised with QUICK_WORKER (pose input rows frozen, caps lifted, geometric
 * share of the blend capped), before the shipped calibration, so any recency advantage goes to the shipped one.
 */
export const QUICK_TIMING = { introMs: 2000, moveMs: 600, waitMs: 300, collectMs: 1000 } as const;
export const QUICK_ROWS = [.25, .75] as const;
export const QUICK_WORKER = {
  fixes: { freezePose: true },
  limits: { maxSamples: 200, minSamples: 24, minTargets: 8 },
  blend: { geometricShareMax: .2 },
} as const;
export const QUICK_BLOCK = 'Q8';
export const QUICK_INTRO = 'Look at each dot';

/** A Q8 dot: `index` is its snake-order position (0..7); `validationIndex` the same place in the 16-dot validation grid. */
export type QuickTarget = Target & { validationIndex: number };

export function quickTargets(viewport: Viewport): QuickTarget[] {
  return QUICK_ROWS.flatMap((ry, row) => {
    const columns = row % 2 === 0 ? [...COLUMNS.keys()] : [...COLUMNS.keys()].reverse();
    return columns.map((column, k) => {
      const x = COLUMNS[column] * viewport.width, y = ry * viewport.height;
      return { index: row * COLUMNS.length + k, column, row, x, y, nx: COLUMNS[column] - .5, ny: ry - .5, cell: cellOf({ x, y }, viewport)!, validationIndex: (row + 1) * 4 + column };
    });
  });
}

export type QuickPhase = 'intro' | 'move' | 'wait' | 'collect';
export type QuickState =
  | { kind: 'ready' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'paused'; index: number }
  | { kind: 'collected' }
  | { kind: 'training' }
  | { kind: 'complete' }
  | { kind: 'failed'; reason: string };
export type QuickPosition =
  | { phase: 'intro'; index: null; progress: number }
  | { phase: 'move' | 'wait' | 'collect'; index: number; progress: number };

/** Pure, time-driven run of Q8: intro, then per dot move → wait → collect; pausing restarts the current dot on resume. */
export class QuickRun {
  state: QuickState = { kind: 'ready' };
  private lastFrameAt = -Infinity;
  constructor(readonly targets: readonly QuickTarget[], readonly timing: typeof QUICK_TIMING = QUICK_TIMING) {}
  get dotMs(): number { return this.timing.moveMs + this.timing.waitMs + this.timing.collectMs; }
  get totalMs(): number { return this.timing.introMs + this.targets.length * this.dotMs; }
  start(now: number): boolean {
    if (this.state.kind === 'ready') { this.state = { kind: 'running', startedAt: now }; return true; }
    if (this.state.kind === 'paused') { this.state = { kind: 'running', startedAt: now - this.timing.introMs - this.state.index * this.dotMs }; return true; }
    return false;
  }
  pause(now: number): boolean {
    if (this.state.kind !== 'running') return false;
    const pos = this.position(now);
    this.state = { kind: 'paused', index: pos && pos.phase !== 'intro' ? pos.index : 0 };
    return true;
  }
  /** Completes collection once the last window has passed. */
  tick(now: number): void {
    if (this.state.kind === 'running' && now - this.state.startedAt >= this.totalMs) this.state = { kind: 'collected' };
  }
  position(at: number): QuickPosition | null {
    if (this.state.kind !== 'running') return null;
    const elapsed = at - this.state.startedAt;
    if (elapsed < 0 || elapsed >= this.totalMs) return null;
    if (elapsed < this.timing.introMs) return { phase: 'intro', index: null, progress: elapsed / this.timing.introMs };
    const inDots = elapsed - this.timing.introMs, index = Math.floor(inDots / this.dotMs), t = inDots - index * this.dotMs;
    if (t < this.timing.moveMs) return { phase: 'move', index, progress: t / this.timing.moveMs };
    if (t < this.timing.moveMs + this.timing.waitMs) return { phase: 'wait', index, progress: (t - this.timing.moveMs) / this.timing.waitMs };
    return { phase: 'collect', index, progress: (t - this.timing.moveMs - this.timing.waitMs) / this.timing.collectMs };
  }
  /** Classifies a camera frame captured at `at`; frames out of order or repeated are rejected. */
  classify(at: number): QuickPosition | null {
    if (!Number.isFinite(at) || at <= this.lastFrameAt) return null;
    this.lastFrameAt = at;
    return this.position(at);
  }
  beginTraining(): boolean { if (this.state.kind !== 'collected') return false; this.state = { kind: 'training' }; return true; }
  finishTraining(): boolean { if (this.state.kind !== 'training') return false; this.state = { kind: 'complete' }; return true; }
  fail(reason: string): void { this.state = { kind: 'failed', reason }; }
}
