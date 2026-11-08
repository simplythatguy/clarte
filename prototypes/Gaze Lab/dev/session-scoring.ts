import { compareCorrections, type CorrectionReport } from '../src/core/calibration-models';
import { compareEstimators, type EstimatorReport } from '../src/core/geometric-gaze';
import type { Estimates, Point, Viewport } from '../src/core/tracking';

/** Pure scoring helpers for replayed test sessions; shared by the runner page and unit tests. */
export type ScoredSample = { estimate: Point; target: number; t: number; estimates?: Estimates<Point> | null };
export type RegionScore = { name: 'center' | 'edges' | 'corners'; samples: number; medianPx: number | null };
export type CheckScore = {
  samples: number; medianPx: number; p90Px: number;
  regions: RegionScore[]; corrections: CorrectionReport | null;
  bias: { dx: number; dy: number };
  /** The network and geometric estimators alone and their best blend, in pixels (null when the worker reported none). */
  estimators: EstimatorReport | null;
};

export const median = (values: number[]) => { if (!values.length) return NaN; const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const p90 = (values: number[]) => { if (!values.length) return NaN; const s = [...values].sort((a, b) => a - b); return s[Math.ceil(.9 * s.length) - 1]; };

/** Normalized [-0.5, 0.5] screen coordinates to pixels for the recording's viewport. */
export const toPixels = (x: number, y: number, v: Viewport): Point => ({ x: (x + .5) * v.width, y: (y + .5) * v.height });

/** Which screen region a normalized target falls in: within 20% of both edges is a corner, of one edge an edge. */
export function region(x: number, y: number): RegionScore['name'] {
  const nearX = Math.abs(x) > .3, nearY = Math.abs(y) > .3;
  return nearX && nearY ? 'corners' : nearX || nearY ? 'edges' : 'center';
}

/**
 * For each event time, the index of the nearest frame time within `maxGapMs`, or -1.
 * Frame times must be ascending.
 */
export function nearestFrames(frameTimes: number[], eventTimes: number[], maxGapMs: number): number[] {
  return eventTimes.map(t => {
    let lo = 0, hi = frameTimes.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (frameTimes[mid] < t) lo = mid + 1; else hi = mid; }
    const best = lo > 0 && Math.abs(frameTimes[lo - 1] - t) <= Math.abs(frameTimes[lo] - t) ? lo - 1 : lo;
    return Math.abs(frameTimes[best] - t) <= maxGapMs ? best : -1;
  });
}

/** Scores check samples (pixels) against their targets (normalized), app-style plus region and model breakdowns. */
export function scoreCheck(samples: ScoredSample[], targets: { x: number; y: number }[], viewport: Viewport): CheckScore | null {
  if (!samples.length) return null;
  const targetPx = targets.map(t => toPixels(t.x, t.y, viewport));
  const errors = samples.map(s => Math.hypot(s.estimate.x - targetPx[s.target].x, s.estimate.y - targetPx[s.target].y));
  const regions: RegionScore[] = (['center', 'edges', 'corners'] as const).map(name => {
    const own = samples.flatMap((s, i) => (region(targets[s.target].x, targets[s.target].y) === name ? [errors[i]] : []));
    return { name, samples: own.length, medianPx: own.length ? median(own) : null };
  });
  const bias = { dx: median(samples.map(s => s.estimate.x - targetPx[s.target].x)), dy: median(samples.map(s => s.estimate.y - targetPx[s.target].y)) };
  const pair = (p: Point | null | undefined) => (p ? [p.x, p.y] : null);
  const estimators = compareEstimators(samples.flatMap(s => (s.estimates ? [{ network: pair(s.estimates.network), geometric: pair(s.estimates.geometric), target: [targetPx[s.target].x, targetPx[s.target].y] }] : [])));
  return { samples: samples.length, medianPx: median(errors), p90Px: p90(errors), regions, corrections: compareCorrections(samples.map(s => ({ estimate: s.estimate, target: s.target })), targetPx, viewport), bias, estimators };
}
