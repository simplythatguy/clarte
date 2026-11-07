import { freshFeatures } from './calibration';
import type { GazeFrame, Point, Viewport } from './tracking';

/**
 * One-dot refit after the camera moved with the screen (a lid tilt). The pointer's offset is the
 * one thing such a move changes for everyone, so a single centre dot re-measures it: settle, then
 * sample a second of open-eye estimates and pair their median with the dot. The pair seeds the
 * learned screen correction; confirmed selections refine it from there as usual. Memory-only.
 */
export const QUICK_REFIT = { settleMs: 1200, sampleMs: 1000, minimumSamples: 8, timeoutMs: 6000, maximumOffset: .45 };
export type RefitState = { kind: 'settling' | 'sampling'; point: Point };
export type RefitResult = { kind: 'running' } | { kind: 'measured'; pair: { estimate: Point; target: Point }; samples: number } | { kind: 'failed' };

export class QuickRefit {
  readonly point: Point;
  state: RefitState;
  private readonly estimates: Point[] = [];
  private lastAt = -Infinity;
  constructor(readonly viewport: Viewport, private readonly startedAt: number) {
    this.point = { x: viewport.width / 2, y: viewport.height / 2 };
    this.state = { kind: 'settling', point: this.point };
  }
  expired(now: number): boolean { return now - this.startedAt > QUICK_REFIT.timeoutMs; }
  /** Uncorrected frames only: the refit measures the estimator, not the correction it replaces. */
  observe(frame: GazeFrame, now: number): RefitResult {
    if (this.expired(now)) return this.finish();
    const elapsed = now - this.startedAt;
    if (elapsed < QUICK_REFIT.settleMs) return { kind: 'running' };
    this.state = { kind: 'sampling', point: this.point };
    const raw = frame.rawPoint;
    if (freshFeatures(frame, now) && raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && frame.at > this.lastAt) { this.lastAt = frame.at; this.estimates.push({ x: raw.x, y: raw.y }); }
    return elapsed >= QUICK_REFIT.settleMs + QUICK_REFIT.sampleMs ? this.finish() : { kind: 'running' };
  }
  private finish(): RefitResult {
    if (this.estimates.length < QUICK_REFIT.minimumSamples) return { kind: 'failed' };
    const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const estimate = { x: median(this.estimates.map(p => p.x)), y: median(this.estimates.map(p => p.y)) };
    const far = Math.hypot((estimate.x - this.point.x) / this.viewport.width, (estimate.y - this.point.y) / this.viewport.height) > QUICK_REFIT.maximumOffset;
    return far ? { kind: 'failed' } : { kind: 'measured', pair: { estimate, target: { ...this.point } }, samples: this.estimates.length };
  }
}
