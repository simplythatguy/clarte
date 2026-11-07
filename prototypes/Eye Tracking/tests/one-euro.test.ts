import { describe, expect, it } from 'vitest';
import { OneEuroPoint } from '../src/core/one-euro';
import { KalmanFilter2D } from '../vendor/webeyetrack/local/utils/filter';
import type { Point } from '../src/core/tracking';

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function gaussian(random: () => number) { return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()); }

const WIDTH = 1280, HEIGHT = 800, FRAME = 1000 / 30;
/** Both filters see the same noisy 30 fps stream: 1.2 s on A, a jump to B, 1.2 s on B. */
function stream(noisePx: number, seed: number) {
  const random = rng(seed), A = { x: 300, y: 250 }, B = { x: 900, y: 550 };
  const frames: { at: number; truth: Point; measured: Point; phase: 'a' | 'b' }[] = [];
  for (let i = 0; i < 72; i++) {
    const phase = i < 36 ? 'a' : 'b', truth = phase === 'a' ? A : B;
    frames.push({ at: 1000 + i * FRAME, truth, measured: { x: truth.x + noisePx * gaussian(random), y: truth.y + noisePx * gaussian(random) }, phase });
  }
  return { frames, B };
}
const toUnits = (p: Point) => [p.x / WIDTH - .5, p.y / HEIGHT - .5];
const fromUnits = ([x, y]: number[]) => ({ x: (x + .5) * WIDTH, y: (y + .5) * HEIGHT });

describe('One Euro pointer filter', () => {
  // Fresh filter state per trial.
  function compare(noise: number) {
    const k = { jitter: 0, lagFrames: 0 }, o = { jitter: 0, lagFrames: 0 }, trials = 40;
    for (let t = 0; t < trials; t++) {
      const kf = new KalmanFilter2D(), of = new OneEuroPoint();
      const a = evaluateOne(m => fromUnits(kf.step(toUnits(m))), noise, 500 + t), b = evaluateOne((m, at) => of.filter(m, at, WIDTH), noise, 500 + t);
      k.jitter += a.jitter / trials; k.lagFrames += a.lagFrames / trials; o.jitter += b.jitter / trials; o.lagFrames += b.lagFrames / trials;
    }
    return { kalman: k, oneEuro: o };
  }
  function evaluateOne(run: (m: Point, at: number) => Point, noise: number, seed: number) {
    const { frames, B } = stream(noise, seed), out = frames.map(f => run(f.measured, f.at));
    const tail = out.slice(-15), mx = tail.reduce((s, p) => s + p.x, 0) / tail.length, my = tail.reduce((s, p) => s + p.y, 0) / tail.length;
    const jitter = Math.sqrt(tail.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / tail.length);
    // Settled: within 1.5 noise sigma (at least 40 px) of the new target, and staying there.
    const tolerance = Math.max(40, 1.5 * noise) * 1.5;
    let settled = out.length - 36;
    for (let i = 36; i < out.length; i++) if (out.slice(i).every(p => Math.hypot(p.x - B.x, p.y - B.y) < tolerance)) { settled = i - 36; break; }
    return { jitter, lagFrames: settled };
  }

  const results = Object.fromEntries([15, 35].map(noise => [noise, compare(noise)]));
  console.table(Object.fromEntries(Object.entries(results).flatMap(([noise, r]) => [[`${noise} px noise · Kalman (current)`, { jitterPx: +r.kalman.jitter.toFixed(1), settleFrames: +r.kalman.lagFrames.toFixed(1) }], [`${noise} px noise · One Euro`, { jitterPx: +r.oneEuro.jitter.toFixed(1), settleFrames: +r.oneEuro.lagFrames.toFixed(1) }]])));

  it('settles after a jump in fewer frames than the Kalman filter, at no more jitter', () => {
    for (const noise of [15, 35]) {
      const r = results[noise];
      expect(r.oneEuro.lagFrames).toBeLessThan(r.kalman.lagFrames / 2);
      expect(r.oneEuro.jitter).toBeLessThan(r.kalman.jitter * .75);
    }
  });

  it('passes the first sample through, ignores out-of-order frames and restarts across a gap', () => {
    const f = new OneEuroPoint();
    expect(f.filter({ x: 100, y: 100 }, 1000, WIDTH)).toEqual({ x: 100, y: 100 });
    const second = f.filter({ x: 200, y: 100 }, 1033, WIDTH);
    expect(second.x).toBeGreaterThan(100); expect(second.x).toBeLessThan(200);
    expect(f.filter({ x: 999, y: 999 }, 1010, WIDTH)).toEqual({ x: second.x, y: second.y });
    expect(f.filter({ x: 640, y: 400 }, 1033 + 401, WIDTH)).toEqual({ x: 640, y: 400 });
    expect(f.filter({ x: NaN, y: 1 }, 2000, WIDTH)).toEqual({ x: NaN, y: 1 });
  });

  it('is independent of frame rate for a steady point', () => {
    for (const frameMs of [16.7, 33.3, 66.7]) {
      const f = new OneEuroPoint(); let p = { x: 0, y: 0 };
      for (let i = 0; i < Math.ceil(3000 / frameMs); i++) p = f.filter({ x: 640, y: 400 }, 1000 + i * frameMs, WIDTH);
      expect(p.x).toBeCloseTo(640, 3);
    }
  });
});

describe('head pose from landmarks', () => {
  // A synthetic face: eye corners on a horizontal line, nose tip below the midpoint.
  const face = (shift = { x: 0, y: 0 }, turn = 0) => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
    const put = (index: number, x: number, y: number) => { landmarks[index] = { x: x + shift.x, y: y + shift.y, z: 0 }; };
    put(33, .42, .4); put(133, .46, .4); put(263, .58, .4); put(362, .54, .4); put(4, .5 + turn, .5);
    return landmarks;
  };
  it('reads centre, span, roll and nose ratios in image widths', async () => {
    const { headPoseFromLandmarks } = await import('../src/core/head-position');
    const pose = headPoseFromLandmarks(face(), { width: 1280, height: 720 })!;
    expect(pose.centerX).toBeCloseTo(.5, 6); expect(pose.centerY).toBeCloseTo(.4 * 720 / 1280, 6);
    expect(pose.span).toBeCloseTo(.12, 6); expect(pose.roll).toBeCloseTo(0, 6);
    expect(pose.yawRatio).toBeCloseTo(0, 6); expect(pose.pitchRatio).toBeCloseTo(.1 * 720 / 1280 / .12, 5);
  });
  it('responds to moving, turning and tilting, and ignores degenerate faces', async () => {
    const { headPoseFromLandmarks, headDifference } = await import('../src/core/head-position');
    const frame = { width: 1280, height: 720 }, base = headPoseFromLandmarks(face(), frame)!;
    expect(headDifference(headPoseFromLandmarks(face({ x: .05, y: 0 }), frame)!, base).x).toBeCloseTo(.05 / .12, 5);
    expect(headPoseFromLandmarks(face({ x: 0, y: 0 }, .03), frame)!.yawRatio).toBeCloseTo(.03 / .12, 5);
    const tilted = face(); tilted[263] = { ...tilted[263], y: .45 }; tilted[362] = { ...tilted[362], y: .45 };
    expect(headPoseFromLandmarks(tilted, frame)!.roll).toBeGreaterThan(.1);
    expect(headPoseFromLandmarks(face().slice(0, 100), frame)).toBeNull();
    const flat = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
    expect(headPoseFromLandmarks(flat, frame)).toBeNull();
  });
  it('learning is allowed before a reference exists and while matched, not after the head moves', async () => {
    const { HeadPositionGuard, headPoseFromLandmarks, allowsLearning } = await import('../src/core/head-position');
    const frame = { width: 1280, height: 720 }, guard = new HeadPositionGuard();
    const pose = (shift?: { x: number; y: number }) => headPoseFromLandmarks(face(shift), frame);
    let now = 1000;
    const observe = (shift?: { x: number; y: number }) => { now += 100; return guard.observe({ face: true, at: now, pose: pose(shift) }, now + 10); };
    expect(allowsLearning(guard.feedback(now))).toBe(true);
    for (let i = 0; i < 12; i++) observe();
    expect(guard.establishReference(now + 10)).toBe(true);
    expect(allowsLearning(observe())).toBe(true);
    expect(allowsLearning(observe({ x: .08, y: 0 }))).toBe(false);
    for (let i = 0; i < 3; i++) observe();
    expect(allowsLearning(guard.feedback(now + 10))).toBe(false);
  });
  it('the worker result carries the pose through the parser and normalizer', async () => {
    const { readWorkerGaze, normalizeGaze } = await import('../src/core/tracking');
    const pose = { centerX: .5, centerY: .2, span: .1, roll: 0, yawRatio: 0, pitchRatio: .6 };
    const frame = normalizeGaze(readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: [0, 0], pose }), { width: 1000, height: 800 });
    expect(frame.pose).toEqual(pose);
    expect(normalizeGaze(readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: null }), { width: 1000, height: 800 }).pose).toBeNull();
    expect(readWorkerGaze({ at: 1, open: true, face: true, facePresent: true, eyeState: 'open', normPog: [0, 0], rawNormPog: null, pose: { ...pose, span: -1 } }).pose).toBeNull();
  });
});
