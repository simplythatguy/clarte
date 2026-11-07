import { describe, expect, it } from 'vitest';
import TFFaceMesh, { headPositionFromLandmarks } from '../vendor/webgazer/src/facemesh.mjs';

function landmarks() {
  const points = Array.from({ length: 468 }, () => ({ x: 320, y: 240, z: 0 }));
  for (const [indices, x, y] of [
    [[466,388,387,386,385,384,398], 380, 200], [[263,249,390,373,374,380,381,382,362], 380, 210],
    [[246,161,160,159,158,157,173], 240, 200], [[33,7,163,144,145,153,154,155,133], 240, 210],
  ]) indices.forEach((index, i) => { points[index] = { x: x + i * 3, y, z: 0 }; });
  points[33] = { x: 240, y: 200, z: 0 };
  points[263] = { x: 400, y: 200, z: 0 };
  points[1] = { x: 320, y: 248, z: 0 };
  return points;
}

describe('geometry from existing MediaPipe result', () => {
  it('uses stable corners and a normalized nose projection, independent of eye patch pixels', () => {
    const points = landmarks();
    expect(headPositionFromLandmarks(points, 640, 480)).toEqual({ centerX: .5, centerY: .3125, span: .25, roll: 0, yawRatio: 0, pitchRatio: .3 });
    const angle = .2;
    const transformed = points.map(p => ({ x: 330 + 1.1 * ((p.x - 320) * Math.cos(angle) - (p.y - 200) * Math.sin(angle)), y: 210 + 1.1 * ((p.x - 320) * Math.sin(angle) + (p.y - 200) * Math.cos(angle)) }));
    const result = headPositionFromLandmarks(transformed, 640, 480);
    expect(result.centerX).toBeCloseTo(330 / 640);
    expect(result.centerY).toBeCloseTo(210 / 640);
    expect(result.span).toBeCloseTo(.275);
    expect(result.roll).toBeCloseTo(angle);
    expect(result.yawRatio).toBeCloseTo(0);
    expect(result.pitchRatio).toBeCloseTo(.3);
    points[1].x += 16;
    points[1].y += 16;
    const turned = headPositionFromLandmarks(points, 640, 480);
    expect(turned.yawRatio).toBeCloseTo(.1);
    expect(turned.pitchRatio).toBeCloseTo(.4);
  });

  it('never invents geometry from absent, degenerate, invalid or off-image landmarks', () => {
    expect(headPositionFromLandmarks([], 640, 480)).toBeNull();
    expect(headPositionFromLandmarks(landmarks(), 0, 480)).toBeNull();
    for (const replacement of [{ x: NaN, y: 20 }, { x: 700, y: 200 }, null]) {
      const points = landmarks(); points[1] = replacement;
      expect(headPositionFromLandmarks(points, 640, 480)).toBeNull();
    }
    const points = landmarks(); points[263] = points[33];
    expect(headPositionFromLandmarks(points, 640, 480)).toBeNull();
  });

  it('attaches the geometry to the same returned eye patches; a lost face cannot reuse cached landmarks', async () => {
    const tracker = new TFFaceMesh();
    let points = landmarks();
    let detected = true;
    tracker.init = async () => {};
    tracker.detector = { estimateFaces: async () => detected ? [{ keypoints: points }] : [] };
    const canvas = { width: 640, getContext: () => ({ getImageData: () => ({ data: [], width: 10, height: 6 }) }) };
    const first = await tracker.getEyePatches({}, canvas, 640, 480);
    expect(first.headPose).toEqual(headPositionFromLandmarks(points, 640, 480));
    points = points.map(p => ({ ...p, x: p.x + 20 }));
    const second = await tracker.getEyePatches({}, canvas, 640, 480);
    expect(second.headPose.centerX).toBeCloseTo(first.headPose.centerX + 20 / 640);
    expect(first.headPose.centerX).toBe(.5);
    detected = false;
    expect(await tracker.getEyePatches({}, canvas, 640, 480)).toBe(false);
    // Upstream retains positionsArray; the adapter deliberately never uses it.
    expect(tracker.getPositions()).not.toBeNull();
    detected = true;
    points[1].x = NaN;
    expect((await tracker.getEyePatches({}, canvas, 640, 480)).headPose).toBeNull();
  });
});
