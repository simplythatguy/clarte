import type { Point, Viewport } from './tracking';

/**
 * Screen-space correction models, compared side by side. Each one maps where the tracker
 * said the person looked to where they actually looked, fitted from one pair per reference
 * point (the median estimate for that point and its true position).
 *
 * Coordinates are "units": centred on the screen and divided by its longer side, so both
 * axes share one scale (needed for the thin-plate spline's distances) and lie within ±0.5.
 */
export type CorrectionPair = { estimate: Point; target: Point };
export type Correction = (point: Point) => Point;
export type CorrectionModel = 'none' | 'affine' | 'ransac-affine' | 'quadratic' | 'thin-plate';
export const CORRECTION_MODELS: readonly CorrectionModel[] = ['none', 'affine', 'ransac-affine', 'quadratic', 'thin-plate'];

export const MODEL = {
  /** Ridge on the x², xy, y² terms, pulling the quadratic toward a plain affine fit. */
  quadraticRidge: .002,
  /** Thin-plate smoothing: 0 passes exactly through every pair; larger bends less. */
  thinPlateSmoothing: .002,
  /** A pair within this many units of an affine hypothesis agrees with it (≈ 6% of the longer side). */
  ransacInlier: .06,
  /** The best hypothesis must be backed by at least this share of pairs, or all pairs are used. */
  ransacMinimumShare: .6,
  /** Exhaustive RANSAC enumerates every triple, so pairs are capped. */
  maxPairs: 24,
  /** Reference points need this many samples to contribute a median estimate. */
  minimumSamples: 3,
} as const;

export const toUnits = (p: Point, v: Viewport): Point => { const s = Math.max(v.width, v.height); return { x: (p.x - v.width / 2) / s, y: (p.y - v.height / 2) / s }; };
export const fromUnits = (p: Point, v: Viewport): Point => { const s = Math.max(v.width, v.height); return { x: p.x * s + v.width / 2, y: p.y * s + v.height / 2 }; };
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Gaussian elimination with partial pivoting for A·X = B with several right-hand columns. */
export function solveLinear(a: number[][], b: number[][]): number[][] | null {
  const n = a.length, cols = b[0]?.length ?? 0;
  const m = a.map((row, i) => [...row, ...b[i]]);
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12 * scale) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      if (factor) for (let k = col; k < n + cols; k++) m[row][k] -= factor * m[col][k];
    }
  }
  const x = m.map((row, i) => row.slice(n).map(v => v / m[i][i]));
  return x.flat().every(Number.isFinite) ? x : null;
}

/** Ridge least squares on a feature map, both axes at once; `penalty[k]` regularizes feature k toward zero. */
function leastSquares(pairs: CorrectionPair[], features: (p: Point) => number[], penalty: number[]): Correction | null {
  const k = penalty.length;
  const m = penalty.map((p, r) => penalty.map((_, c) => (r === c ? p : 0)));
  const rhs = penalty.map(() => [0, 0]);
  for (const { estimate, target } of pairs) {
    const f = features(estimate);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) m[r][c] += f[r] * f[c];
      rhs[r][0] += f[r] * target.x; rhs[r][1] += f[r] * target.y;
    }
  }
  const w = solveLinear(m, rhs);
  if (!w) return null;
  return p => { const f = features(p); let x = 0, y = 0; for (let i = 0; i < k; i++) { x += w[i][0] * f[i]; y += w[i][1] * f[i]; } return { x, y }; };
}

/** The current model: shift, scale, rotation and shear, the same everywhere on screen. */
export function fitAffine(pairs: CorrectionPair[]): Correction | null {
  return pairs.length < 3 ? null : leastSquares(pairs, p => [p.x, p.y, 1], [0, 0, 0]);
}

/** Affine plus x², xy and y² terms (12 numbers), ridge-pulled toward affine so few pairs cannot bend it wildly. */
export function fitQuadratic(pairs: CorrectionPair[], ridge: number = MODEL.quadraticRidge): Correction | null {
  return pairs.length < 3 ? null : leastSquares(pairs, p => [p.x, p.y, 1, p.x * p.x, p.x * p.y, p.y * p.y], [0, 0, 0, ridge, ridge, ridge]);
}

const kernel = (r: number) => (r > 1e-12 ? r * r * Math.log(r) : 0);

/** Affine plus one smooth local bend per pair; `smoothing` trades exactness at the pairs for less bending. */
export function fitThinPlate(pairs: CorrectionPair[], smoothing: number = MODEL.thinPlateSmoothing): Correction | null {
  const n = pairs.length;
  if (n < 3) return null;
  const e = pairs.map(p => p.estimate), size = n + 3;
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const b = Array.from({ length: size }, () => [0, 0]);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i][j] = kernel(Math.hypot(e[i].x - e[j].x, e[i].y - e[j].y)) + (i === j ? smoothing : 0);
    const poly = [1, e[i].x, e[i].y];
    for (let k = 0; k < 3; k++) { a[i][n + k] = poly[k]; a[n + k][i] = poly[k]; }
    b[i] = [pairs[i].target.x, pairs[i].target.y];
  }
  const w = solveLinear(a, b);
  if (!w) return null;
  return p => {
    let x = w[n][0] + w[n + 1][0] * p.x + w[n + 2][0] * p.y, y = w[n][1] + w[n + 1][1] * p.x + w[n + 2][1] * p.y;
    for (let i = 0; i < n; i++) { const u = kernel(Math.hypot(p.x - e[i].x, p.y - e[i].y)); x += w[i][0] * u; y += w[i][1] * u; }
    return { x, y };
  };
}

/**
 * Exhaustive RANSAC: every triple of pairs proposes an exact affine fit; the one most pairs
 * agree with wins, and the final affine is refitted on just those pairs. A reference point
 * spoiled by a blink, a glance away or fatigue then cannot drag the whole fit.
 */
export function fitRansacAffine(pairs: CorrectionPair[]): Correction | null {
  const n = pairs.length;
  if (n < 3 || n > MODEL.maxPairs) return n < 3 ? null : fitAffine(pairs);
  let best: number[] = [], bestCost = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const model = fitAffine([pairs[i], pairs[j], pairs[k]]);
    if (!model) continue;
    const residuals = pairs.map(p => { const q = model(p.estimate); return Math.hypot(q.x - p.target.x, q.y - p.target.y); });
    const inliers = residuals.flatMap((r, index) => (r < MODEL.ransacInlier ? [index] : []));
    const cost = inliers.reduce((s, index) => s + residuals[index], 0);
    if (inliers.length > best.length || (inliers.length === best.length && cost < bestCost)) { best = inliers; bestCost = cost; }
  }
  if (best.length < Math.max(3, Math.ceil(n * MODEL.ransacMinimumShare))) return fitAffine(pairs);
  return fitAffine(best.map(index => pairs[index])) ?? fitAffine(pairs);
}

export function fitCorrection(model: CorrectionModel, pairs: CorrectionPair[]): Correction | null {
  switch (model) {
    case 'none': return p => p;
    case 'affine': return fitAffine(pairs);
    case 'ransac-affine': return fitRansacAffine(pairs);
    case 'quadratic': return fitQuadratic(pairs);
    case 'thin-plate': return fitThinPlate(pairs);
  }
}

export type CorrectionSample = { estimate: Point; target: number };
export type CorrectionScore = { model: CorrectionModel; medianPx: number; p90Px: number } | { model: CorrectionModel; medianPx: null; p90Px: null };
/** Median uncorrected error vector at each reference point: a pattern across the screen means a non-affine error. */
export type CorrectionOffset = { target: Point; dx: number; dy: number; samples: number };
export type CorrectionReport = { scores: CorrectionScore[]; offsets: CorrectionOffset[]; references: number };

/**
 * Leave-one-reference-out comparison: each model is fitted on every other reference point and
 * scored, in pixels, on the samples of the point it never saw. Memory-only; returns aggregates.
 */
export function compareCorrections(samples: readonly CorrectionSample[], targets: readonly Point[], viewport: Viewport): CorrectionReport | null {
  const groups = targets.map((target, index) => ({ target, index, points: samples.filter(s => s.target === index && finite(s.estimate)).map(s => s.estimate) }))
    .filter(g => finite(g.target) && g.points.length >= MODEL.minimumSamples);
  if (groups.length < 4 || groups.length > MODEL.maxPairs) return null;
  const pairs = groups.map(g => ({ estimate: toUnits({ x: median(g.points.map(p => p.x)), y: median(g.points.map(p => p.y)) }, viewport), target: toUnits(g.target, viewport) }));
  const scores = CORRECTION_MODELS.map((model): CorrectionScore => {
    const errors: number[] = [];
    groups.forEach((held, h) => {
      const correction = fitCorrection(model, pairs.filter((_, i) => i !== h));
      if (!correction) return;
      for (const point of held.points) {
        const q = fromUnits(correction(toUnits(point, viewport)), viewport);
        const error = Math.hypot(q.x - held.target.x, q.y - held.target.y);
        if (Number.isFinite(error)) errors.push(error);
      }
    });
    if (!errors.length) return { model, medianPx: null, p90Px: null };
    errors.sort((a, b) => a - b);
    return { model, medianPx: median(errors), p90Px: errors[Math.ceil(.9 * errors.length) - 1] };
  });
  const offsets = groups.map(g => ({ target: { ...g.target }, dx: median(g.points.map(p => p.x)) - g.target.x, dy: median(g.points.map(p => p.y)) - g.target.y, samples: g.points.length }));
  return { scores, offsets, references: groups.length };
}
