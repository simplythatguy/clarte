import { describe, expect, it } from 'vitest';
import { applyCorrection, candidateFeatures, evaluateCandidate, readCandidate, CANDIDATE_FORMAT, FEATURE_NAMES } from '../src/lab/candidate';
import { gazeFeatures } from '../src/core/geometric-gaze';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function features() {
  const pts = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  const eye = (ex: number, outer: number, inner: number, iris: number, upper: number, lower: number) => { pts[outer] = { x: ex - .02, y: .5, z: 0 }; pts[inner] = { x: ex + .02, y: .5, z: 0 }; pts[iris] = { x: ex + .003, y: .501, z: 0 }; pts[upper] = { x: ex, y: .49, z: 0 }; pts[lower] = { x: ex, y: .51, z: 0 }; };
  eye(.42, 33, 133, 468, 159, 145); eye(.58, 362, 263, 473, 386, 374);
  return gazeFeatures({ landmarks: pts, faceRt: identity, origin: [1, 2, 60], frame: { width: 1280, height: 720 } })!;
}

describe('candidate files', () => {
  it('accepts the documented schema and rejects unknown features or bad weights', () => {
    const ok = readCandidate({ format: CANDIDATE_FORMAT, name: 'x', geometric: { features: ['r_iris_x', 'one'], weights: [[1, 0], [0, 1]] }, blend: { x: .3, y: .8 }, correction: { kind: 'affine', x: [1, 0, .01], y: [0, 1, -.02] }, head: null });
    expect(ok.geometric!.features).toEqual(['r_iris_x', 'one']); expect(ok.blend).toEqual({ x: .3, y: .8 });
    expect(() => readCandidate({ format: 'nope' })).toThrow();
    expect(() => readCandidate({ format: CANDIDATE_FORMAT, geometric: { features: ['bogus'], weights: [[1], [1]] } })).toThrow(/unknown/);
    expect(() => readCandidate({ format: CANDIDATE_FORMAT, geometric: { features: ['one'], weights: [[1, 2], [1]] } })).toThrow(/weights/);
    expect(() => readCandidate({ format: CANDIDATE_FORMAT, blend: { x: 2, y: 0 } })).toThrow(/blend/);
    expect(() => readCandidate({ format: CANDIDATE_FORMAT, correction: { kind: 'quadratic', x: [1, 2, 3], y: [1, 2, 3, 4, 5, 6] } })).toThrow(/correction/);
  });
  it('computes every named feature and applies geometric weights, per-axis blend and correction', () => {
    const f = features();
    const values = candidateFeatures({ features: f, faceOrigin3D: [1, 2, 60], faceRt: identity })!;
    for (const name of FEATURE_NAMES) expect(Number.isFinite(values[name])).toBe(true);
    expect(values.z).toBeCloseTo(1); expect(values.one).toBe(1); expect(values.origin_x_over_z).toBeCloseTo(1 / 60); expect(values.head_yaw).toBe(0);
    const c = readCandidate({ format: CANDIDATE_FORMAT, name: 'c', geometric: { features: ['one', 'z'], weights: [[.1, 0], [0, .2]] }, blend: { x: 1, y: 0 }, correction: { kind: 'affine', x: [1, 0, 0], y: [0, 1, .05] } });
    const out = evaluateCandidate(c, { network: [.3, .3], geometric: [.9, .9] }, { features: f, faceOrigin3D: [1, 2, 60], faceRt: identity });
    expect(out.geometric![0]).toBeCloseTo(.1); expect(out.geometric![1]).toBeCloseTo(.2);
    // x takes the candidate geometric (blend 1), y the network (blend 0) plus the +0.05 correction.
    expect(out.final![0]).toBeCloseTo(.1); expect(out.final![1]).toBeCloseTo(.35);
    expect(applyCorrection({ kind: 'quadratic', x: [0, 0, 0, 1, 0, 0], y: [0, 0, 0, 0, 0, 1] }, [.5, -.5])).toEqual([.25, .25]);
    // Without geometric features the candidate geometric is null and the network passes through the correction.
    const none = evaluateCandidate(c, { network: [.3, .3], geometric: null }, { features: null, faceOrigin3D: null, faceRt: null });
    expect(none.geometric).toBeNull(); expect(none.final).toEqual([.3, .35]);
  });
});
