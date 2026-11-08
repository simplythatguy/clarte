import { featureVector, type GazeFeatures } from '../core/geometric-gaze';
import { readLearnedCalibration, type LearnedCalibration } from '../core/saved-calibration';
import { headAngles } from './head';
import type { CandidateOut } from './frames';

/**
 * A candidate model to re-test prospectively, produced offline by analysis/analyze.py. Everything but `head`
 * is a pure function of the shipped stream's debug inputs and is computed in the page, so the shipped
 * estimate and the candidate are recorded side by side from the same frames.
 */
export const CANDIDATE_FORMAT = 'GAZE-LAB-CANDIDATE-1';
/** Feature vocabulary shared with analyze.py (same names, same definitions). The first twelve are the shipped regressors. */
export const FEATURE_NAMES = [
  'r_iris_x', 'r_iris_y', 'r_upper', 'r_lower', 'l_iris_x', 'l_iris_y', 'l_upper', 'l_lower', 'z', 'z_fwd_x', 'z_fwd_y', 'one',
  'origin_x_over_z', 'origin_y_over_z', 'openness', 'head_yaw', 'head_pitch',
] as const;
export type FeatureName = typeof FEATURE_NAMES[number];
export type Candidate = {
  format: typeof CANDIDATE_FORMAT; name: string; createdFrom?: string;
  geometric: { features: FeatureName[]; weights: [number[], number[]] } | null;
  /** Geometric share of the blend per axis, in [0, 1]. */
  blend: { x: number; y: number } | null;
  /** Screen correction on normalized coordinates: affine [x, y, 1] or quadratic [x, y, 1, x², xy, y²] coefficients per output axis. */
  correction: { kind: 'affine' | 'quadratic'; x: number[]; y: number[] } | null;
  /** Replacement gaze head (six tensors + affine), run in a shadow worker through restoreCalibration. */
  head: LearnedCalibration | null;
};
export type DebugInputs = { features: GazeFeatures | null; faceOrigin3D: number[] | null; faceRt: number[] | null };

const isNumberArray = (v: unknown, n?: number): v is number[] => Array.isArray(v) && (n === undefined || v.length === n) && v.every(x => typeof x === 'number' && Number.isFinite(x));

export function readCandidate(v: unknown): Candidate {
  if (!v || typeof v !== 'object' || (v as { format?: unknown }).format !== CANDIDATE_FORMAT) throw new Error('Not a gaze-lab candidate file');
  const o = v as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : 'candidate';
  let geometric: Candidate['geometric'] = null;
  if (o.geometric) {
    const g = o.geometric as Record<string, unknown>;
    if (!Array.isArray(g.features) || !g.features.every(f => (FEATURE_NAMES as readonly string[]).includes(f as string))) throw new Error('Candidate geometric features are unknown');
    const n = g.features.length;
    if (!Array.isArray(g.weights) || g.weights.length !== 2 || !g.weights.every(row => isNumberArray(row, n))) throw new Error('Candidate geometric weights must be 2 rows of one weight per feature');
    geometric = { features: g.features as FeatureName[], weights: [g.weights[0] as number[], g.weights[1] as number[]] };
  }
  let blend: Candidate['blend'] = null;
  if (o.blend) {
    const b = o.blend as Record<string, unknown>;
    if (typeof b.x !== 'number' || typeof b.y !== 'number' || !(b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1)) throw new Error('Candidate blend weights must be in [0, 1]');
    blend = { x: b.x, y: b.y };
  }
  let correction: Candidate['correction'] = null;
  if (o.correction) {
    const c = o.correction as Record<string, unknown>;
    const n = c.kind === 'affine' ? 3 : c.kind === 'quadratic' ? 6 : 0;
    if (!n || !isNumberArray(c.x, n) || !isNumberArray(c.y, n)) throw new Error('Candidate correction must be affine (3) or quadratic (6) coefficients per axis');
    correction = { kind: c.kind as 'affine' | 'quadratic', x: c.x as number[], y: c.y as number[] };
  }
  const head = o.head ? readLearnedCalibration(o.head) : null;
  return { format: CANDIDATE_FORMAT, name, createdFrom: typeof o.createdFrom === 'string' ? o.createdFrom : undefined, geometric, blend, correction, head };
}

/** Values for every feature name from one frame's debug inputs; null when the frame has no usable geometry. */
export function candidateFeatures(inputs: DebugInputs): Record<FeatureName, number> | null {
  if (!inputs.features) return null;
  const shipped = featureVector(inputs.features);
  const o = inputs.faceOrigin3D, angles = headAngles(inputs.faceRt);
  const z = o && o.length === 3 && o[2] > 0 ? o[2] : NaN;
  const values: Record<FeatureName, number> = {
    r_iris_x: shipped[0], r_iris_y: shipped[1], r_upper: shipped[2], r_lower: shipped[3], l_iris_x: shipped[4], l_iris_y: shipped[5], l_upper: shipped[6], l_lower: shipped[7],
    z: shipped[8], z_fwd_x: shipped[9], z_fwd_y: shipped[10], one: shipped[11],
    origin_x_over_z: o ? o[0] / z : NaN, origin_y_over_z: o ? o[1] / z : NaN, openness: inputs.features.openness,
    head_yaw: angles ? angles.yawDeg / 30 : NaN, head_pitch: angles ? angles.pitchDeg / 30 : NaN,
  };
  return values;
}

export function applyCorrection(c: NonNullable<Candidate['correction']>, p: readonly number[]): [number, number] {
  const [x, y] = p;
  const basis = c.kind === 'affine' ? [x, y, 1] : [x, y, 1, x * x, x * y, y * y];
  const dot = (w: number[]) => w.reduce((s, wi, i) => s + wi * basis[i], 0);
  return [dot(c.x), dot(c.y)];
}

/** The candidate's estimates for one frame given the shipped network/geometric estimates and the debug inputs. */
export function evaluateCandidate(c: Candidate, shipped: { network: number[] | null; geometric: number[] | null }, inputs: DebugInputs, head: CandidateOut['head'] = null): CandidateOut {
  let geometric: number[] | null = shipped.geometric;
  if (c.geometric) {
    const f = candidateFeatures(inputs);
    if (f && c.geometric.features.every(name => Number.isFinite(f[name]))) {
      const row = (w: number[]) => w.reduce((s, wi, i) => s + wi * f[c.geometric!.features[i]], 0);
      const p = [row(c.geometric.weights[0]), row(c.geometric.weights[1])];
      geometric = p.every(v => Number.isFinite(v) && Math.abs(v) <= 1) ? p : null;
    } else geometric = null;
  }
  const network = head?.network ?? shipped.network;
  let final: number[] | null = null;
  if (network && geometric && c.blend) final = [network[0] * (1 - c.blend.x) + geometric[0] * c.blend.x, network[1] * (1 - c.blend.y) + geometric[1] * c.blend.y];
  else if (network && geometric) final = [(network[0] + geometric[0]) / 2, (network[1] + geometric[1]) / 2];
  else final = network ?? geometric;
  if (final && c.correction) final = applyCorrection(c.correction, final);
  return { geometric: c.geometric ? geometric : null, final, head };
}
