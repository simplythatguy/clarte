import { describe, expect, it } from 'vitest';
import { CAMERA_MOTION, CameraMotionDetector, downsample, faceBox, readCameraMotion, type FaceBox } from '../src/core/camera-motion';

const W = 640, H = 480;
/** Deterministic textured background: smooth-ish noise so shifted copies still match. */
function background(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  let seed = 12345;
  const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const blobs = Array.from({ length: 160 }, () => ({ x: rand() * W, y: rand() * H, r: 10 + rand() * 30, v: rand() * 255 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 90;
    for (const b of blobs) { const d = Math.hypot(x - b.x, y - b.y); if (d < b.r) v = v * .5 + b.v * .5; }
    const i = (y * W + x) * 4; out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
  }
  return out;
}
const BACKGROUND = background();
/** The scene shifted by (dx, dy), with a flat "face" rectangle drawn at `face` (frame pixels). */
function frame(dx: number, dy: number, face: FaceBox | null, flat = false): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - dx, sy = y - dy, i = (y * W + x) * 4;
    const v = flat ? 100 : sx >= 0 && sy >= 0 && sx < W && sy < H ? BACKGROUND[(sy * W + sx) * 4] : 90;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  if (face) for (let y = Math.max(0, face.top | 0); y < Math.min(H, face.bottom); y++) for (let x = Math.max(0, face.left | 0); x < Math.min(W, face.right); x++) { const i = (y * W + x) * 4; data[i] = 200; data[i + 1] = 170; data[i + 2] = 150; }
  return { width: W, height: H, data, colorSpace: 'srgb' };
}
const face = (dx = 0, dy = 0): FaceBox => ({ left: 260 + dx, top: 140 + dy, right: 380 + dx, bottom: 300 + dy });

describe('camera motion detector', () => {
  it('downsamples to grey cells', () => {
    const grey = downsample(frame(0, 0, null));
    expect(grey.width).toBe(W / CAMERA_MOTION.fine); expect(grey.height).toBe(H / CAMERA_MOTION.fine);
    expect(grey.data.every(v => v >= 0 && v <= 255)).toBe(true);
  });
  it('confirms a whole-image shift matched by the face after several frames, once', () => {
    const detector = new CameraMotionDetector();
    expect(detector.observe(frame(0, 0, face()), face(), 0)!.matchable).toBe(true);
    expect(detector.observe(frame(0, 0, face()), face(), 33)).toMatchObject({ dx: 0, dy: 0, moved: false });
    const results = [1, 2, 3, 4].map(k => detector.observe(frame(0, 24, face(0, 24)), face(0, 24), 33 + 33 * k)!);
    expect(results.slice(0, CAMERA_MOTION.confirmations - 1).every(r => !r.moved && r.dy === 24)).toBe(true);
    expect(results[CAMERA_MOTION.confirmations - 1]).toMatchObject({ dx: 0, dy: 24, moved: true });
    expect(results[CAMERA_MOTION.confirmations - 1].tiltDeg).toBeCloseTo(Math.atan2(24, W) * 180 / Math.PI, 5);
    // The moved pose is the new reference: holding it is stillness, not another move.
    expect(results[CAMERA_MOTION.confirmations]).toMatchObject({ dx: 0, dy: 0, moved: false });
  });
  it('ignores a person moving in front of a still background, and a background shift the face did not follow', () => {
    const detector = new CameraMotionDetector();
    detector.observe(frame(0, 0, face()), face(), 0);
    for (let k = 1; k <= 5; k++) expect(detector.observe(frame(0, 0, face(0, 30)), face(0, 30), 33 * k)).toMatchObject({ dx: 0, dy: 0, moved: false });
    for (let k = 1; k <= 5; k++) expect(detector.observe(frame(0, 24, face()), face(), 200 + 33 * k)!.moved).toBe(false);
  });
  it('reports a blank wall as unmatchable instead of guessing', () => {
    const detector = new CameraMotionDetector();
    detector.observe(frame(0, 0, face(), true), face(), 0);
    const result = detector.observe(frame(0, 24, face(0, 24), true), face(0, 24), 33)!;
    expect(result).toMatchObject({ matchable: false, moved: false, dx: 0, dy: 0 });
  });
  it('refreshes the reference after a long still period and rejects tiny frames', () => {
    const detector = new CameraMotionDetector();
    detector.observe(frame(0, 0, face()), face(), 0);
    detector.observe(frame(0, 0, face()), face(), CAMERA_MOTION.refreshMs + 1);
    // A slow change that was absorbed into the reference does not count as a shift later.
    expect(detector.observe(frame(0, 0, face()), face(), CAMERA_MOTION.refreshMs + 40)).toMatchObject({ dx: 0, dy: 0 });
    expect(detector.observe({ width: 64, height: 48, data: new Uint8ClampedArray(64 * 48 * 4), colorSpace: 'srgb' }, null, 0)).toBeNull();
  });
  it('derives the face box from landmarks and validates reported motion', () => {
    const points = Array.from({ length: 478 }, (_, i) => ({ x: .4 + (i % 10) * .02, y: .3 + Math.floor(i / 48) * .03 }));
    const box = faceBox(points, { width: 1000, height: 500 })!;
    expect(box.left).toBeCloseTo(400); expect(box.right).toBeCloseTo(580); expect(box.top).toBeCloseTo(150);
    expect(faceBox([], { width: 1000, height: 500 })).toBeNull();
    expect(readCameraMotion({ dx: 1, dy: 2, tiltDeg: .1, moved: true, matchable: true })).toEqual({ dx: 1, dy: 2, tiltDeg: .1, moved: true, matchable: true });
    expect(readCameraMotion({ dx: NaN, dy: 2, tiltDeg: .1, moved: true, matchable: true })).toBeNull();
    expect(readCameraMotion(null)).toBeNull();
  });
});
