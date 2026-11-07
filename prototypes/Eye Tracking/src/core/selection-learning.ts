import type { GazeFrame, Point, Viewport } from './tracking';
import type { TargetRect } from './gaze';

/** Row-major 2x3 affine map in normalized screen space ([-.5, .5] on each axis). */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];
type Pair = { estimate: Point; target: Point };

export const LEARNING = {
  /** Confirmed selections kept; older ones are forgotten so drift can be followed. */
  capacity: 30,
  /** Per-selection weight decay, newest first. */
  decay: .92,
  /** Open-eye estimates needed from one selection. */
  minimumEstimates: 5,
  /** Selections and distinct targets needed before scale/shear is fitted; fewer fit offset only. */
  affineSelections: 6,
  affineTargets: 3,
  /** Ridge strength pulling scale/shear toward identity: about one selection 0.17 of the screen from centre. */
  ridge: .03,
  /** Pseudo-selections of zero offset, so one selection cannot move everything. */
  offsetPrior: 1.5,
  maxOffset: .25,
  scale: [.6, 1.8] as const,
  maxShear: .3,
};

const normalize = (p: Point, v: Viewport): Point => ({ x: p.x / v.width - .5, y: p.y / v.height - .5 });
const denormalize = (p: Point, v: Viewport): Point => ({ x: (p.x + .5) * v.width, y: (p.y + .5) * v.height });
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

function solve3(m: number[][], r: number[]): number[] | null {
  const a = m.map((row, i) => [...row, r[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < 4; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Learns a small screen-space correction from confirmed gaze selections: the estimates
 * recorded while the person settled on a target are paired with that target's centre.
 * It corrects offset and, once there is enough spread, scale. It never leaves memory.
 */
export class SelectionLearning {
  private pairs: (Pair & { key: string })[] = [];
  transform: Affine = IDENTITY;

  get count(): number { return this.pairs.length; }

  reset(): void { this.pairs = []; this.transform = IDENTITY; }

  apply(point: Point, viewport: Viewport): Point {
    const p = normalize(point, viewport), [a, b, c, d, e, f] = this.transform;
    return denormalize({ x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f }, viewport);
  }

  correct(frame: GazeFrame, viewport: Viewport): GazeFrame {
    if (this.transform === IDENTITY) return frame;
    const clip = (p: Point) => ({ x: Math.min(viewport.width - 1, Math.max(0, p.x)), y: Math.min(viewport.height - 1, Math.max(0, p.y)) });
    return { ...frame, point: frame.point ? clip(this.apply(frame.point, viewport)) : frame.point, rawPoint: frame.rawPoint ? this.apply(frame.rawPoint, viewport) : frame.rawPoint };
  }

  /**
   * Starts from a measured check instead of from nothing: each pair is the median uncorrected
   * estimate at a known reference and that reference's position. Later selections outweigh it
   * as they arrive. Returns how many pairs were accepted.
   */
  seed(pairs: { estimate: Point; target: Point }[], viewport: Viewport): number {
    if (viewport.width <= 0 || viewport.height <= 0) return 0;
    const usable = pairs.map((p, index) => ({ estimate: normalize(p.estimate, viewport), target: normalize(p.target, viewport), key: `check-${index}` }))
      .filter(p => [p.estimate.x, p.estimate.y, p.target.x, p.target.y].every(Number.isFinite) && Math.hypot(p.estimate.x - p.target.x, p.estimate.y - p.target.y) <= .45);
    this.pairs = usable.slice(-LEARNING.capacity);
    this.transform = this.fit();
    return usable.length;
  }

  /** `estimates` are uncorrected screen points; returns whether the selection was learned. */
  learn(estimates: Point[], target: TargetRect, viewport: Viewport): boolean {
    const usable = estimates.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (usable.length < LEARNING.minimumEstimates || viewport.width <= 0 || viewport.height <= 0) return false;
    const estimate = normalize({ x: median(usable.map(p => p.x)), y: median(usable.map(p => p.y)) }, viewport);
    const centre = normalize({ x: (target.left + target.right) / 2, y: (target.top + target.bottom) / 2 }, viewport);
    // A confirmed target far from where the estimates were is more likely a mistake than drift.
    if (Math.hypot(estimate.x - centre.x, estimate.y - centre.y) > .45) return false;
    this.pairs = [...this.pairs, { estimate, target: centre, key: target.id }].slice(-LEARNING.capacity);
    this.transform = this.fit();
    return true;
  }

  private fit(): Affine {
    const n = this.pairs.length;
    if (!n) return IDENTITY;
    const weights = this.pairs.map((_, i) => LEARNING.decay ** (n - 1 - i));
    const total = weights.reduce((s, w) => s + w, 0);
    const offset = (axis: 'x' | 'y') => this.pairs.reduce((s, p, i) => s + weights[i] * (p.target[axis] - p.estimate[axis]), 0) / (total + LEARNING.offsetPrior);
    const clamp = (v: number) => Math.max(-LEARNING.maxOffset, Math.min(LEARNING.maxOffset, v));
    const shift: Affine = [1, 0, clamp(offset('x')), 0, 1, clamp(offset('y'))];
    if (n < LEARNING.affineSelections || new Set(this.pairs.map(p => p.key)).size < LEARNING.affineTargets) return shift;

    // Weighted ridge regression per axis toward identity scale/shear; the offset is unpenalized.
    const m = [[LEARNING.ridge, 0, 0], [0, LEARNING.ridge, 0], [0, 0, 0]];
    const rx = [LEARNING.ridge, 0, 0], ry = [0, LEARNING.ridge, 0];
    this.pairs.forEach((p, i) => {
      const v = [p.estimate.x, p.estimate.y, 1], w = weights[i];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) m[r][c] += w * v[r] * v[c];
        rx[r] += w * v[r] * p.target.x; ry[r] += w * v[r] * p.target.y;
      }
    });
    const x = solve3(m, rx), y = solve3(m, ry);
    if (!x || !y) return shift;
    const affine: Affine = [x[0], x[1], x[2], y[0], y[1], y[2]];
    const [lo, hi] = LEARNING.scale;
    const sane = affine.every(Number.isFinite) && affine[0] >= lo && affine[0] <= hi && affine[4] >= lo && affine[4] <= hi &&
      Math.abs(affine[1]) <= LEARNING.maxShear && Math.abs(affine[3]) <= LEARNING.maxShear &&
      Math.abs(affine[2]) <= LEARNING.maxOffset && Math.abs(affine[5]) <= LEARNING.maxOffset;
    return sane ? affine : shift;
  }
}
