import { describe, expect, it } from 'vitest';
import { describeOffset, headAngles, headOffset, headReference, median, medianOffset, percentile } from '../src/lab/head';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const yawed = (deg: number) => { const r = deg * Math.PI / 180; return [Math.cos(r), 0, -Math.sin(r), 0, 0, 1, 0, 0, Math.sin(r), 0, Math.cos(r), 0, 0, 0, 0, 1]; };
const pitched = (deg: number) => { const r = deg * Math.PI / 180; return [1, 0, 0, 0, 0, Math.cos(r), Math.sin(r), 0, 0, -Math.sin(r), Math.cos(r), 0, 0, 0, 0, 1]; };

describe('head angles and offsets', () => {
  it('reads yaw and pitch from the face matrix forward axis', () => {
    expect(headAngles(identity)).toMatchObject({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
    expect(headAngles(yawed(15))!.yawDeg).toBeCloseTo(15, 6);
    expect(headAngles(pitched(10))!.pitchDeg).toBeCloseTo(-10, 6);
    expect(headAngles(null)).toBeNull(); expect(headAngles([1, 2, 3])).toBeNull();
  });
  it('builds a median reference and signed offsets in cm and degrees', () => {
    const ref = headReference([{ origin: [0, 1, 60], faceRt: identity }, { origin: [2, 1, 62], faceRt: yawed(2) }, { origin: [1, 1, 61], faceRt: yawed(-2) }])!;
    expect(ref.origin).toEqual([1, 1, 61]); expect(ref.yawDeg).toBeCloseTo(0); expect(ref.samples).toBe(3);
    const o = headOffset({ origin: [11, -7, 71], faceRt: yawed(15) }, ref)!;
    expect(o).toMatchObject({ dx: 10, dy: -8, dz: 10 }); expect(o.yawDeg).toBeCloseTo(15);
    expect(describeOffset(o)).toBe('10.0 cm left · 8.0 cm up · 10.0 cm farther · yaw 15° left · pitch 0°');
    expect(describeOffset(null)).toBe('head not found');
    expect(medianOffset([{ origin: [1, 1, 51], faceRt: null }, { origin: [1, 1, 49], faceRt: null }], ref)).toMatchObject({ dz: -11, samples: 2 });
    expect(headReference([{ origin: [0, 0, 0], faceRt: null }])).toBeNull();
  });
  it('median and percentile ignore non-finite values', () => {
    expect(median([3, NaN, 1, 2])).toBe(2); expect(median([])).toBeNaN();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], .9)).toBe(9);
  });
});
