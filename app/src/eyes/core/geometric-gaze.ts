import { solveLinear } from './calibration-models';

/**
 * Geometric gaze estimator: where the eyes point, worked out from the iris position inside each
 * eye and the head's pose, instead of learned from eye-strip pixels.
 *
 * Model. The iris sits on the eyeball, which is fixed in the head. Its offset from the eye's
 * corner midpoint in the image is, to first order, the angle between the gaze line and the line
 * from the eye to the camera. Because the camera lies in the screen plane, the point of regard on
 * that plane is simply depth × that angle: head translation cancels out and only depth remains.
 * The resting offset of the iris (eyeball centre and kappa, the angle between the eye's optical
 * and visual axes) differs per person, and because the eyeball centre lies behind the eye corners
 * its apparent resting offset shifts with head yaw and pitch. The screen's scale, mirroring and
 * the camera's position on it are an affine map. Vertically the iris barely moves in the image
 * (a few pixels over the whole screen height at webcam resolution), but the eyelids follow the
 * eye, so the upper and lower lid heights carry most of the vertical signal and are included.
 *
 * All of that is linear in twelve features (per eye: iris x, iris y, upper lid, lower lid; then
 * depth, head yaw, head pitch, one), so one bounded ridge regression per person fits it from the
 * calibration labels. Nothing here is learned from pixels; it is independent of the gaze network
 * and is blended with it. Coordinates: normalized screen space in [-0.5, 0.5].
 *
 * Measured on one recorded replay set (1512×789 screen, 1280×720 camera, 60-pixel-wide eyes):
 * leave-one-dot-out median 138 px, check median 115 px; the same frames' network estimate with an
 * affine-only calibration scored 140 px. Per-frame iris jitter is about 0.4 px, which is about 3%
 * of the screen width, so single frames are noisy and the pointer smoothing matters.
 */
export type FaceFrame = {
  /** MediaPipe face landmarks, 478 points, as objects or a flat x, y, z array; x and y normalized to the frame. */
  landmarks: ArrayLike<number> | readonly { x: number; y: number; z: number }[];
  /** MediaPipe face transformation matrix, 16 numbers, column-major; null when unavailable. */
  faceRt: ArrayLike<number> | null | undefined;
  /** Eye midpoint in camera space (cm), from the tracker's face reconstruction; z is depth. */
  origin: readonly number[];
  frame: { width: number; height: number };
};

/** One eye in the corner-line frame, in eye widths: +x toward image right, +y toward image bottom. */
export type EyeFeatures = {
  /** Iris centre offset from the corner midpoint. */
  iris: [number, number];
  /** Upper and lower lid heights at the eye's middle. */
  upper: number; lower: number;
  /** Lid gap. */
  openness: number;
};
export type GazeFeatures = {
  /** Right and left eye; an eye that was not usable (closed, occluded, degenerate) repeats the other one. */
  right: EyeFeatures; left: EyeFeatures;
  /** How many eyes were usable (1 or 2). */
  eyes: number;
  /** Lid gap over eye width, averaged over the usable eyes. */
  openness: number;
  /** x and y of the head's forward axis in camera space (image axes: +y down). */
  forward: [number, number];
  /** Depth of the eyes in cm. */
  depth: number;
};

export const GEOMETRIC = {
  /** Landmarks: outer corner, inner corner, iris centre, upper lid, lower lid. */
  rightEye: { outer: 33, inner: 133, iris: 468, upper: 159, lower: 145 },
  leftEye: { inner: 362, outer: 263, iris: 473, upper: 386, lower: 374 },
  /** Eye width in pixels below which iris position is too coarse to use. */
  minimumEyeWidthPx: 18,
  /** Lid gap over eye width below which the iris centre is occluded. */
  minimumOpenness: .12,
  /** Iris offsets beyond this many eye widths are landmark failures. */
  maximumOffset: .6,
  /** Depth bounds in cm; the reconstruction's scale is approximate, the affine absorbs it. */
  depth: [20, 200] as const,
  /** Depth is divided by this before fitting so all features are of order one. */
  referenceDepthCm: 60,
  /** Ridge on the eye terms, the head-rotation terms and the depth term; the intercept is free. */
  ridge: { eye: 1e-3, rotation: 3e-3, depth: 1e-3 },
  /** Fits need this many samples on this many distinct targets. */
  minimumSamples: 12, minimumTargets: 6,
  /** Samples whose fit residual exceeds this multiple of the median residual (and `outlierFloor`, in normalized units) are refitted without. */
  outlierFactor: 4, outlierFloor: .02,
  /** Predictions beyond this far outside the screen are treated as missing. */
  maximumPrediction: 1,
  /** Blend weight bounds: the estimator can never fully replace the network nor be fully ignored once it fits. */
  weightRange: [0, .85] as const,
};

const FEATURES = 12;
const finite = (...v: number[]) => v.every(Number.isFinite);

function landmark(points: FaceFrame['landmarks'], index: number, frame: { width: number; height: number }): [number, number] | null {
  let x: number, y: number;
  if (typeof (points as ArrayLike<number>)[0] === 'number' || (points as ArrayLike<number>).length > 478) {
    const flat = points as ArrayLike<number>;
    if (flat.length < 478 * 3) return null;
    x = flat[index * 3]; y = flat[index * 3 + 1];
  } else {
    const list = points as readonly { x: number; y: number }[];
    if (list.length < 478) return null;
    x = list[index].x; y = list[index].y;
  }
  return finite(x, y) ? [x * frame.width, y * frame.height] : null;
}

function eyeFeatures(points: FaceFrame['landmarks'], eye: { outer: number; inner: number; iris: number; upper: number; lower: number }, frame: { width: number; height: number }, towardRight: boolean): EyeFeatures | null {
  const outer = landmark(points, eye.outer, frame), inner = landmark(points, eye.inner, frame), centre0 = landmark(points, eye.iris, frame);
  const upper = landmark(points, eye.upper, frame), lower = landmark(points, eye.lower, frame);
  if (!outer || !inner || !centre0 || !upper || !lower) return null;
  // u runs along the corner line toward image right for both eyes; v is perpendicular, toward image bottom.
  const [from, to] = towardRight ? [outer, inner] : [inner, outer];
  const width = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(width >= GEOMETRIC.minimumEyeWidthPx)) return null;
  const ux = (to[0] - from[0]) / width, uy = (to[1] - from[1]) / width;
  const centre = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const dx = centre0[0] - centre[0], dy = centre0[1] - centre[1];
  const iris: [number, number] = [(dx * ux + dy * uy) / width, (-dx * uy + dy * ux) / width];
  const height = (p: [number, number]) => (-(p[0] - centre[0]) * uy + (p[1] - centre[1]) * ux) / width;
  const up = height(upper), lo = height(lower), openness = lo - up;
  if (!finite(iris[0], iris[1], up, lo) || [iris[0], iris[1], up, lo].some(v => Math.abs(v) > GEOMETRIC.maximumOffset)) return null;
  return { iris, upper: up, lower: lo, openness };
}

/** Pose and iris features of one frame; null when the face geometry is unusable (no eyes open, degenerate landmarks, bad depth). */
export function gazeFeatures(face: FaceFrame): GazeFeatures | null {
  const { frame } = face;
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const depth = face.origin[2];
  if (!finite(depth) || depth < GEOMETRIC.depth[0] || depth > GEOMETRIC.depth[1]) return null;
  const open = (eye: EyeFeatures | null): eye is EyeFeatures => eye !== null && eye.openness >= GEOMETRIC.minimumOpenness;
  const rightEye = eyeFeatures(face.landmarks, GEOMETRIC.rightEye, frame, true), leftEye = eyeFeatures(face.landmarks, GEOMETRIC.leftEye, frame, false);
  const usable = [rightEye, leftEye].filter(open);
  if (!usable.length) return null;
  const right = open(rightEye) ? rightEye : usable[0], left = open(leftEye) ? leftEye : usable[0];
  // Head forward axis: third column of the column-major rotation; MediaPipe's camera y points up, the image's points down.
  let forward: [number, number] = [0, 0];
  const m = face.faceRt;
  if (m && m.length === 16 && finite(m[8], m[9], m[10]) && Math.abs(Math.hypot(m[8], m[9], m[10]) - 1) < .1) forward = [m[8], -m[9]];
  return { right, left, eyes: usable.length, openness: usable.reduce((s, e) => s + e.openness, 0) / usable.length, forward, depth };
}

/** The twelve regressors: depth-scaled iris and lid positions of each eye, depth, depth-scaled head rotation, and one. */
export function featureVector(f: GazeFeatures): number[] {
  const z = f.depth / GEOMETRIC.referenceDepthCm;
  const eye = (e: EyeFeatures) => [z * e.iris[0], z * e.iris[1], z * e.upper, z * e.lower];
  return [...eye(f.right), ...eye(f.left), z, z * f.forward[0], z * f.forward[1], 1];
}

export type GeometricSample = { features: GazeFeatures; label: [number, number] };
export type GeometricFit = {
  /** 2 × 12 regression weights (x row, y row). */
  weights: number[][];
  samples: number; targets: number; outliers: number;
  /** Held-out mean squared error per axis in normalized units: one sample per target held out, the same protocol as the network's training report. Null when no target has two samples. */
  heldOutMse: number | null;
  /** Fit root-mean-square residual in normalized units. */
  residual: number;
};

function ridgeFit(rows: number[][], labels: [number, number][]): number[][] | null {
  const { eye, depth, rotation } = GEOMETRIC.ridge;
  const penalty = [eye, eye, eye, eye, eye, eye, eye, eye, depth, rotation, rotation, 0];
  const m = penalty.map((p, r) => penalty.map((_, c) => (r === c ? p : 0)));
  const rhs = penalty.map(() => [0, 0]);
  rows.forEach((f, i) => {
    for (let r = 0; r < FEATURES; r++) {
      for (let c = 0; c < FEATURES; c++) m[r][c] += f[r] * f[c];
      rhs[r][0] += f[r] * labels[i][0]; rhs[r][1] += f[r] * labels[i][1];
    }
  });
  const w = solveLinear(m, rhs);
  return w ? [w.map(row => row[0]), w.map(row => row[1])] : null;
}

export function applyWeights(weights: number[][], f: GazeFeatures): [number, number] {
  const v = featureVector(f);
  let x = 0, y = 0;
  for (let i = 0; i < FEATURES; i++) { x += weights[0][i] * v[i]; y += weights[1][i] * v[i]; }
  return [x, y];
}

const key = (label: [number, number]) => `${label[0]},${label[1]}`;
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : NaN; };

/**
 * Fits the estimator to labelled calibration frames: ridge regression, one outlier pass, then a
 * leave-one-target-out error for blending. Returns null when there is too little to fit.
 */
export function fitGeometric(samples: readonly GeometricSample[]): GeometricFit | null {
  const usable = samples.filter(s => finite(s.label[0], s.label[1]) && featureVector(s.features).every(Number.isFinite));
  const targets = new Set(usable.map(s => key(s.label)));
  if (usable.length < GEOMETRIC.minimumSamples || targets.size < GEOMETRIC.minimumTargets) return null;
  const fitRows = (set: readonly GeometricSample[]) => ridgeFit(set.map(s => featureVector(s.features)), set.map(s => s.label));
  const residuals = (weights: number[][], set: readonly GeometricSample[]) => set.map(s => { const p = applyWeights(weights, s.features); return Math.hypot(p[0] - s.label[0], p[1] - s.label[1]); });
  const first = fitRows(usable);
  if (!first) return null;
  const r = residuals(first, usable), limit = Math.max(GEOMETRIC.outlierFloor, median(r) * GEOMETRIC.outlierFactor);
  const kept = usable.filter((_, i) => r[i] <= limit);
  const keptTargets = new Set(kept.map(s => key(s.label)));
  const final = kept.length >= GEOMETRIC.minimumSamples && keptTargets.size >= GEOMETRIC.minimumTargets ? kept : usable;
  const weights = (final === usable ? first : fitRows(final)) ?? first;
  // Held-out error for blending with the network, on the same protocol as its training report: the last sample of every target.
  let heldOutMse: number | null = null;
  const groups = new Map<string, GeometricSample[]>();
  final.forEach(s => groups.set(key(s.label), [...(groups.get(key(s.label)) ?? []), s]));
  const held = [...groups.values()].filter(g => g.length >= 2).map(g => g[g.length - 1]);
  if (held.length >= GEOMETRIC.minimumTargets) {
    const heldSet = new Set(held), w = fitRows(final.filter(s => !heldSet.has(s)));
    if (w) heldOutMse = held.reduce((sum, s) => { const p = applyWeights(w, s.features); return sum + ((p[0] - s.label[0]) ** 2 + (p[1] - s.label[1]) ** 2) / 2; }, 0) / held.length;
  }
  const finalResiduals = residuals(weights, final);
  return { weights, samples: final.length, targets: keptTargets.size, outliers: usable.length - final.length, heldOutMse, residual: Math.sqrt(finalResiduals.reduce((s, v) => s + v * v, 0) / finalResiduals.length) };
}

/** A prediction in normalized screen units, or null when the features or the fit are unusable. */
export function predictGeometric(fit: GeometricFit | null, features: GazeFeatures | null): [number, number] | null {
  if (!fit || !features) return null;
  const p = applyWeights(fit.weights, features);
  return finite(p[0], p[1]) && Math.abs(p[0]) <= GEOMETRIC.maximumPrediction && Math.abs(p[1]) <= GEOMETRIC.maximumPrediction ? p : null;
}

/**
 * Blend weight for the geometric estimate against the network's, from their held-out mean squared
 * errors (inverse-variance weighting), bounded so neither estimator is ever trusted alone.
 */
export function blendWeight(geometricMse: number | null, networkMse: number | null): number {
  const [lo, hi] = GEOMETRIC.weightRange;
  if (geometricMse === null || !(geometricMse > 0) || !Number.isFinite(geometricMse)) return lo;
  if (networkMse === null || !(networkMse > 0) || !Number.isFinite(networkMse)) return Math.min(hi, .5);
  return Math.min(hi, Math.max(lo, (1 / geometricMse) / (1 / geometricMse + 1 / networkMse)));
}

export function blend(network: readonly number[] | null, geometric: readonly number[] | null, weight: number): [number, number] | null {
  const w = Math.min(1, Math.max(0, weight));
  if (network && geometric && network.length === 2 && geometric.length === 2) return [network[0] * (1 - w) + geometric[0] * w, network[1] * (1 - w) + geometric[1] * w];
  if (network && network.length === 2) return [network[0], network[1]];
  return null;
}

export type GeometricState = { weights: number[][]; heldOutMse: number | null; weight: number; samples: number; targets: number };

/** Bounds a blend weight to the allowed range; anything invalid becomes the lower bound. */
export function boundWeight(weight: unknown): number {
  const [lo, hi] = GEOMETRIC.weightRange;
  return typeof weight === 'number' && Number.isFinite(weight) ? Math.min(hi, Math.max(lo, weight)) : lo;
}

export type EstimatorSample = { network: readonly number[] | null; geometric: readonly number[] | null; target: readonly number[] };
export type EstimatorReport = {
  /** Median error of each estimator alone, and of the best blend, in the caller's units; null when an estimator was missing. */
  networkMedian: number | null; geometricMedian: number | null;
  blend: { weight: number; median: number } | null;
  samples: number;
};

/**
 * Scores the network, the geometric estimator and their blends on paired samples (same units in
 * and out), choosing the blend weight with the lowest median error. Memory-only; aggregates only.
 */
export function compareEstimators(samples: readonly EstimatorSample[], minimumSamples = 30): EstimatorReport | null {
  const dist = (p: readonly number[], t: readonly number[]) => Math.hypot(p[0] - t[0], p[1] - t[1]);
  const med = (values: number[]) => median(values);
  const network = samples.filter(s => s.network), geometric = samples.filter(s => s.geometric), both = samples.filter(s => s.network && s.geometric);
  if (!network.length && !geometric.length) return null;
  const report: EstimatorReport = {
    networkMedian: network.length ? med(network.map(s => dist(s.network!, s.target))) : null,
    geometricMedian: geometric.length ? med(geometric.map(s => dist(s.geometric!, s.target))) : null,
    blend: null, samples: both.length,
  };
  if (both.length >= minimumSamples) {
    const [lo, hi] = GEOMETRIC.weightRange;
    let best: { weight: number; median: number } = { weight: lo, median: Infinity };
    for (let w = lo; w <= hi + 1e-9; w += .05) {
      const m = med(both.map(s => dist(blend(s.network, s.geometric, w)!, s.target)));
      if (m < best.median) best = { weight: Math.round(w * 100) / 100, median: m };
    }
    report.blend = best;
  }
  return report;
}

/** Validates a saved geometric state (weights, held-out error and blend weight); throws on anything else. */
export function readGeometricState(v: unknown): GeometricState {
  const o = v as Partial<GeometricState> | null;
  const row = (r: unknown) => Array.isArray(r) && r.length === FEATURES && r.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e3);
  if (!o || typeof o !== 'object' || Object.keys(o).length !== 5 || !Array.isArray(o.weights) || o.weights.length !== 2 || !o.weights.every(row)
    || !(o.heldOutMse === null || typeof o.heldOutMse === 'number' && o.heldOutMse >= 0 && Number.isFinite(o.heldOutMse)) || typeof o.weight !== 'number' || !(o.weight >= 0 && o.weight <= 1)
    || typeof o.samples !== 'number' || !Number.isInteger(o.samples) || o.samples < 0 || o.samples > 1e4 || typeof o.targets !== 'number' || !Number.isInteger(o.targets) || o.targets < 0 || o.targets > 1e4) throw new Error('Saved geometric gaze model is invalid');
  return { weights: o.weights.map(r => [...(r as number[])]), heldOutMse: o.heldOutMse ?? null, weight: o.weight, samples: o.samples, targets: o.targets };
}
