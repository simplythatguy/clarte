import { describe, expect, it } from 'vitest';
import { blend, blendWeight, boundWeight, compareEstimators, featureVector, fitGeometric, gazeFeatures, GEOMETRIC, predictGeometric, readGeometricState, type GeometricSample } from '../src/core/geometric-gaze';
import { readLearnedCalibration, ESTIMATOR_SHAPES } from '../src/core/saved-calibration';
import { normalizeGaze, readWorkerGaze } from '../src/core/tracking';

const frame = { width: 1280, height: 720 };
/**
 * A synthetic face: 478 landmarks at the frame centre except the two eyes, which are drawn from a
 * gaze (gx, gy in eye widths), lid heights and a head rotation. Pixel coordinates are normalized.
 */
function face(options: { gaze?: [number, number]; upper?: number; lower?: number; yaw?: number; pitch?: number; depth?: number; eyeWidth?: number; closeRight?: boolean } = {}) {
  const { gaze = [0, 0], upper = -.14, lower = .13, yaw = 0, pitch = 0, depth = 60, eyeWidth = 60, closeRight = false } = options;
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  const place = (index: number, cx: number, cy: number, u: number, v: number) => { points[index] = { x: (cx + u * eyeWidth) / frame.width, y: (cy + v * eyeWidth) / frame.height, z: 0 }; };
  const eye = (cx: number, cy: number, e: { outer: number; inner: number; iris: number; upper: number; lower: number }, towardRight: boolean, closed: boolean) => {
    const [from, to] = towardRight ? [e.outer, e.inner] : [e.inner, e.outer];
    place(from, cx, cy, -.5, 0); place(to, cx, cy, .5, 0);
    place(e.iris, cx, cy, gaze[0], gaze[1]);
    place(e.upper, cx, cy, 0, closed ? -.01 : upper); place(e.lower, cx, cy, 0, closed ? .01 : lower);
  };
  eye(540, 360, GEOMETRIC.rightEye, true, closeRight); eye(740, 360, GEOMETRIC.leftEye, false, false);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Column-major rotation Ry(yaw)·Rx(pitch): the third column is the forward axis.
  const faceRt = [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, 0, -10, -depth, 1];
  return { landmarks: points, faceRt, origin: [0, 9, depth], frame };
}

describe('geometric gaze features', () => {
  it('reads iris and lid positions in eye widths, the head forward axis and depth', () => {
    const f = gazeFeatures(face({ gaze: [.1, -.05], yaw: .2, pitch: -.1 }))!;
    expect(f.eyes).toBe(2);
    expect(f.right.iris[0]).toBeCloseTo(.1, 5); expect(f.right.iris[1]).toBeCloseTo(-.05, 5);
    expect(f.left.iris[0]).toBeCloseTo(.1, 5);
    expect(f.right.upper).toBeCloseTo(-.14, 5); expect(f.right.lower).toBeCloseTo(.13, 5); expect(f.openness).toBeCloseTo(.27, 5);
    expect(f.forward[0]).toBeCloseTo(Math.sin(.2) * Math.cos(-.1), 5); expect(f.forward[1]).toBeCloseTo(Math.sin(-.1), 5);
    expect(f.depth).toBe(60);
    expect(featureVector(f)).toHaveLength(12);
  });
  it('accepts flat landmark arrays and uses the open eye for a closed one', () => {
    const closed = face({ gaze: [.08, 0], closeRight: true });
    const flat = closed.landmarks.flatMap(p => [p.x, p.y, p.z]);
    const f = gazeFeatures({ ...closed, landmarks: flat })!;
    expect(f.eyes).toBe(1);
    expect(f.right).toEqual(f.left);
    expect(f.left.iris[0]).toBeCloseTo(.08, 5);
  });
  it('rejects unusable geometry: both eyes closed, tiny eyes, bad depth, missing head matrix is tolerated', () => {
    const both = face({ closeRight: true }); both.landmarks[GEOMETRIC.leftEye.upper].y = both.landmarks[GEOMETRIC.leftEye.lower].y;
    expect(gazeFeatures(both)).toBeNull();
    expect(gazeFeatures(face({ eyeWidth: 10 }))).toBeNull();
    expect(gazeFeatures({ ...face(), origin: [0, 0, 5] })).toBeNull();
    expect(gazeFeatures({ ...face(), origin: [0, 0, NaN] })).toBeNull();
    expect(gazeFeatures({ ...face(), faceRt: null })!.forward).toEqual([0, 0]);
    expect(gazeFeatures({ ...face(), landmarks: [] })).toBeNull();
  });
});

/** Labels generated from a known linear screen mapping of the features, with a head-rotation term. */
function samples(noise = 0, count = 14): GeometricSample[] {
  const out: GeometricSample[] = [];
  let seed = 7;
  const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 - .5; };
  for (let i = 0; i < count; i++) {
    const gx = (i % 5 - 2) * .04, gy = (Math.floor(i / 5) - 1) * .015, yaw = i % 3 === 0 ? .1 : 0;
    for (let k = 0; k < 3; k++) {
      const f = gazeFeatures(face({ gaze: [gx + rand() * noise, gy + rand() * noise], upper: -.14 + gy * 2, lower: .13 + gy, yaw, depth: 60 }))!;
      out.push({ features: f, label: [-gx * 5 + yaw * .5, gy * 12 + yaw * .2] });
    }
  }
  return out;
}

describe('geometric gaze fit', () => {
  it('recovers a linear mapping from labelled frames and predicts new ones, with a held-out error', () => {
    const fit = fitGeometric(samples())!;
    expect(fit.samples).toBe(42); expect(fit.targets).toBe(14); expect(fit.outliers).toBe(0);
    // Ridge keeps the fit from being exact; a few thousandths of the screen is the bias it costs.
    expect(fit.residual).toBeLessThan(.005);
    expect(fit.heldOutMse).not.toBeNull(); expect(fit.heldOutMse!).toBeLessThan(5e-5);
    const probe = gazeFeatures(face({ gaze: [.02, .01], upper: -.12, lower: .14, yaw: .1 }))!;
    const p = predictGeometric(fit, probe)!;
    expect(p[0]).toBeCloseTo(-.02 * 5 + .05, 2); expect(p[1]).toBeCloseTo(.01 * 12 + .02, 2);
    expect(predictGeometric(fit, null)).toBeNull(); expect(predictGeometric(null, probe)).toBeNull();
  });
  it('refuses to fit too few samples or targets, and sets aside outliers', () => {
    expect(fitGeometric(samples().slice(0, 9))).toBeNull();
    const few = samples().filter(s => s.label[0] <= 0 && s.label[1] === 0); // too few distinct targets
    expect(fitGeometric(few)).toBeNull();
    const spoiled = samples(); spoiled[5] = { ...spoiled[5], label: [.49, -.49] };
    const fit = fitGeometric(spoiled)!;
    expect(fit.outliers).toBe(1);
    expect(fit.residual).toBeLessThan(.005);
  });
  it('weights the blend by held-out error, within bounds', () => {
    const [lo, hi] = GEOMETRIC.weightRange;
    expect(blendWeight(null, 1)).toBe(lo); expect(blendWeight(0, 1)).toBe(lo);
    expect(blendWeight(1, null)).toBe(Math.min(hi, .5));
    expect(blendWeight(1, 1)).toBeCloseTo(.5); expect(blendWeight(1, 3)).toBeCloseTo(.75);
    expect(blendWeight(1e-6, 1)).toBe(hi);
    expect(boundWeight(2)).toBe(hi); expect(boundWeight(-1)).toBe(lo); expect(boundWeight('x')).toBe(lo); expect(boundWeight(.3)).toBe(.3);
    expect(blend([0, 0], [1, 1], .25)).toEqual([.25, .25]); expect(blend([0, 1], null, .5)).toEqual([0, 1]); expect(blend(null, [1, 1], .5)).toBeNull();
  });
  it('compares estimators and picks the blend with the lowest median error', () => {
    const rows = Array.from({ length: 40 }, (_, i) => { const t = [i / 40 - .5, 0]; return { network: [t[0] + .1, .1], geometric: [t[0] - .1, -.1], target: t }; });
    const report = compareEstimators(rows)!;
    expect(report.networkMedian).toBeCloseTo(Math.hypot(.1, .1)); expect(report.geometricMedian).toBeCloseTo(Math.hypot(.1, .1));
    expect(report.blend!.weight).toBe(.5); expect(report.blend!.median).toBeLessThan(1e-9);
    expect(compareEstimators(rows.slice(0, 10))!.blend).toBeNull();
    expect(compareEstimators([{ network: null, geometric: null, target: [0, 0] }])).toBeNull();
  });
  it('validates saved geometric state and round-trips it inside a saved calibration', () => {
    const fit = fitGeometric(samples())!;
    const state = { weights: fit.weights, heldOutMse: fit.heldOutMse, weight: .4, samples: 42, targets: 14 };
    expect(readGeometricState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => readGeometricState({ ...state, weight: 1.5 })).toThrow();
    expect(() => readGeometricState({ ...state, weights: [fit.weights[0]] })).toThrow();
    expect(() => readGeometricState({ ...state, extra: 1 })).toThrow();
    const learned = { weights: ESTIMATOR_SHAPES.map(shape => Array<number>(shape.reduce((a, b) => a * b, 1)).fill(.01)), affine: [1, 0, 0, 0, 1, 0], faceWidthCm: 15 };
    expect(readLearnedCalibration(learned)).toEqual(learned);
    expect(readLearnedCalibration({ ...learned, geometric: null })).toEqual(learned);
    expect(readLearnedCalibration({ ...learned, geometric: state })).toEqual({ ...learned, geometric: state });
    expect(() => readLearnedCalibration({ ...learned, geometric: { bad: true } })).toThrow();
    expect(() => readLearnedCalibration({ ...learned, other: 1 })).toThrow();
  });
});

describe('estimates on worker results', () => {
  it('are read, validated and converted to pixels alongside the blended estimate', () => {
    const value = readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: [.1, .1], estimates: { network: [.2, 0], geometric: [0, .2] } });
    expect(value.estimates).toEqual({ network: [.2, 0], geometric: [0, .2] });
    const frame = normalizeGaze(value, { width: 1000, height: 500 });
    expect(frame.rawPoint).toEqual({ x: 600, y: 300 });
    expect(frame.estimates).toEqual({ network: { x: 700, y: 250 }, geometric: { x: 500, y: 350 } });
    expect(readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: [0, 0], estimates: { network: [NaN, 0], geometric: null } }).estimates).toBeNull();
    expect(readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: [0, 0] }).estimates).toBeNull();
  });
});
