import { describe, expect, it, vi } from 'vitest';
import { readTrainingOptions, TRAINING_DEFAULTS } from '../src/core/training';
import { BilateralEyes, EYE_OPENNESS } from '../src/core/blink';
import { PostureBank, POSTURE, postureKey } from '../src/core/posture-bank';
import { GEOMETRIC } from '../src/core/geometric-gaze';
const GEOMETRIC_RANGE = GEOMETRIC.weightRange;
import { CalibrationEngine, type Observation, type TrackerCore } from '../src/core/worker-engine';
import type { HeadPose } from '../src/core/head-position';

describe('training options', () => {
  it('fills defaults and bounds every value', () => {
    expect(readTrainingOptions(undefined)).toEqual(TRAINING_DEFAULTS);
    expect(readTrainingOptions({ steps: 0, lr: 5e-4, l2: 0, holdout: false })).toMatchObject({ steps: 0, lr: 5e-4, l2: 0, holdout: false });
    expect(readTrainingOptions({ steps: -5, lr: 9, l2: 'x', evalEvery: 0, patience: 1e9 })).toEqual(TRAINING_DEFAULTS);
    expect(readTrainingOptions({ steps: 12.6 }).steps).toBe(13);
  });
  it('reach the tracker through the engine', async () => {
    const sample: Observation = { eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' }, headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], gazeState: 'open', eyeState: 'open', rawNormPog: [0, 0], normPog: [0, 0], facialLandmarks: Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 })) };
    const core: TrackerCore = { step: vi.fn(async () => sample), adapt: vi.fn(async () => {}), dispose: vi.fn(), lastTraining: null };
    const engine = new CalibrationEngine(core, () => 1000);
    for (let n = 0; n < 27; n++) { await engine.step(sample.eyePatch, n + 1, 1000); engine.collect(n + 1, (n % 3 - 1) * .3, (Math.floor(n / 3) % 3 - 1) * .3); }
    await engine.train({ steps: 10, lr: 'bad' });
    expect(vi.mocked(core.adapt).mock.calls[0][4]).toEqual({ ...TRAINING_DEFAULTS, steps: 10 });
    expect(engine.trainingReport()).toBeNull();
  });
});

describe('adaptive eye-openness thresholds', () => {
  it('keeps the fixed thresholds until enough frames, then follows the person', () => {
    const eyes = new BilateralEyes();
    expect(eyes.openness).toEqual({ ...EYE_OPENNESS.fixed, adapted: false });
    // Narrow eyes: an open ratio of 0.19 reads as closed under the fixed thresholds.
    expect(eyes.observe(.19, .19)).toBe('closed');
    for (let i = 0; i < EYE_OPENNESS.minimumSamples; i++) eyes.observe(.19, .19);
    const learned = eyes.openness;
    expect(learned.adapted).toBe(true);
    expect(learned.closed).toBeCloseTo(Math.max(EYE_OPENNESS.bounds[0], .19 * EYE_OPENNESS.closedRatio), 6); expect(learned.open).toBeCloseTo(.19 * EYE_OPENNESS.openRatio, 6);
    expect(eyes.observe(.19, .19)).toBe('open');
    expect(eyes.observe(.08, .08)).toBe('closed');
    expect(eyes.observe(.19, .19)).toBe('open');
  });
  it('is not pulled down by blinks, stays within bounds and survives reset', () => {
    const eyes = new BilateralEyes();
    for (let i = 0; i < 150; i++) eyes.observe(i % 10 === 0 ? .05 : .32, i % 10 === 0 ? .05 : .32);
    expect(eyes.openness.closed).toBeCloseTo(.32 * EYE_OPENNESS.closedRatio, 2);
    eyes.reset();
    expect(eyes.openness.adapted).toBe(true);
    const wide = new BilateralEyes();
    for (let i = 0; i < 150; i++) wide.observe(.6, .6);
    expect(wide.openness).toEqual({ closed: EYE_OPENNESS.bounds[1], open: EYE_OPENNESS.bounds[1], adapted: true });
  });
  it('does not learn from winks or disagreeing eyes', () => {
    const eyes = new BilateralEyes();
    for (let i = 0; i < 150; i++) eyes.observe(.3, .1);
    expect(eyes.openness.adapted).toBe(false);
  });
});

describe('posture bank', () => {
  const viewport = { width: 1280, height: 800 };
  const pose = (over: Partial<HeadPose> = {}): HeadPose => ({ centerX: .5, centerY: .3, span: .12, roll: 0, yawRatio: 0, pitchRatio: .4, ...over });
  const rect = (id: string, x: number, y: number) => ({ id, left: x - 100, right: x + 100, top: y - 60, bottom: y + 60 });
  const around = (x: number, y: number) => [-6, -3, 0, 3, 6].map(d => ({ x: x + d, y: y - d }));

  it('keys cells by turn, tilt and distance', () => {
    expect(postureKey(pose())).toBe(postureKey(pose({ yawRatio: .03 })));
    expect(postureKey(pose())).not.toBe(postureKey(pose({ yawRatio: .2 })));
    expect(postureKey(pose())).not.toBe(postureKey(pose({ span: .12 * 1.4 })));
    expect(postureKey(pose())).toBe(postureKey(pose({ centerX: .1 })));
  });

  it('uses the global correction until a cell has learned enough, then the cell’s own', () => {
    const bank = new PostureBank(), turned = pose({ yawRatio: .3 });
    // Looking straight: the pointer sits 40 px above the gaze.
    for (let i = 0; i < 6; i++) bank.learn(around(300, 160 + i * 20), rect('a', 300, 200 + i * 20), viewport, pose());
    // Turned: the pointer sits 40 px below the gaze instead.
    expect(bank.learn(around(900, 440), rect('b', 900, 400), viewport, turned)).toBe(true);
    expect(bank.active(turned)).toBe(bank.global);
    for (let i = 0; i < POSTURE.minimumSelections; i++) bank.learn(around(900, 440 + i * 10), rect(i % 2 ? 'b' : 'c', 900, 400 + i * 10), viewport, turned);
    expect(bank.active(turned)).not.toBe(bank.global);
    expect(bank.apply({ x: 900, y: 440 }, turned, viewport).y).toBeLessThan(415);
    expect(bank.apply({ x: 300, y: 160 }, pose(), viewport).y).toBeGreaterThan(185);
    expect(bank.active(null)).toBe(bank.global);
  });

  it('seeds a trusted cell from the check and forgets the least recently used cell', () => {
    const bank = new PostureBank();
    const pairs = Array.from({ length: 10 }, (_, i) => ({ target: { x: 100 + i * 100, y: 100 + (i % 3) * 200 }, estimate: { x: 100 + i * 100 + 10, y: 100 + (i % 3) * 200 - 50 } }));
    expect(bank.seed(pairs, viewport, pose())).toBe(10);
    expect(bank.active(pose())).not.toBe(bank.global);
    for (let i = 0; i < POSTURE.capacity + 3; i++) bank.learn(around(640, 400), rect('x', 640, 400), viewport, pose({ yawRatio: .1 * (i + 1) }));
    expect(bank.cellCount).toBeLessThanOrEqual(POSTURE.capacity);
    bank.reset();
    expect(bank.cellCount).toBe(0);
  });
});

describe('geometric estimator in the calibration engine', () => {
  const frame = { width: 1280, height: 720 };
  /** Observation whose eyes encode a gaze; the network estimate is supplied separately. */
  function observation(gaze: [number, number], network: [number, number], faceRt = true): Observation {
    const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
    const place = (index: number, cx: number, u: number, v: number) => { points[index] = { x: (cx + u * 60) / frame.width, y: (360 + v * 60) / frame.height, z: 0 }; };
    for (const [cx, eye, right] of [[540, { outer: 33, inner: 133, iris: 468, upper: 159, lower: 145 }, true], [740, { inner: 362, outer: 263, iris: 473, upper: 386, lower: 374 }, false]] as const) {
      const [from, to] = right ? [eye.outer, eye.inner] : [eye.inner, eye.outer];
      place(from, cx, -.5, 0); place(to, cx, .5, 0); place(eye.iris, cx, gaze[0], gaze[1]); place(eye.upper, cx, 0, -.14 + gaze[1]); place(eye.lower, cx, 0, .13 + gaze[1]);
    }
    return { eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' }, headVector: [0, 0, 1], faceOrigin3D: [0, 9, 60], gazeState: 'open', eyeState: 'open', rawNormPog: network, normPog: network, facialLandmarks: points, faceRt: faceRt ? { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -10, -60, 1] } : undefined };
  }
  // Landmarks are normalized to the camera frame, so the engine must be stepped with a camera-sized frame.
  const cameraFrame: ImageData = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.width * frame.height * 4), colorSpace: 'srgb' };
  const label = (i: number): [number, number] => [(i % 5 - 2) * .2, (Math.floor(i / 5) % 3 - 1) * .18];
  const gazeFor = (l: [number, number]): [number, number] => [-l[0] * .2, l[1] * .08];
  async function calibrated(networkOffset = .05) {
    let current = observation([0, 0], [0, 0]);
    const core: TrackerCore = { step: vi.fn(async () => current), adapt: vi.fn(async () => {}), dispose: vi.fn(), lastTraining: { samples: 42, heldOut: 14, stepsUsed: 10, bestStep: 5, heldOutBefore: .01, heldOutAfter: .002, options: TRAINING_DEFAULTS }, exportCalibration: () => ({ weights: [518 * 16, 16, 16 * 16, 16, 16 * 2, 2].map(n => Array<number>(n).fill(.01)), affine: [1, 0, 0, 0, 1, 0], faceWidthCm: 15 }), restoreCalibration: vi.fn() };
    const engine = new CalibrationEngine(core, () => 1000);
    let at = 0;
    for (let i = 0; i < 14; i++) for (let k = 0; k < 3; k++) {
      const l = label(i); current = observation(gazeFor(l), [l[0] + networkOffset, l[1]]);
      await engine.step(cameraFrame, ++at, 1000); expect(engine.collect(at, l[0], l[1])).toBe(true);
    }
    await engine.train();
    return { engine, core, step: async (gaze: [number, number], network: [number, number]) => { current = observation(gaze, network); return engine.step(cameraFrame, ++at, 1000); } };
  }
  it('fits the geometric estimator at training and reports it with a held-out blend weight', async () => {
    const { engine } = await calibrated();
    const report = engine.trainingReport()!;
    expect(report.geometric).toMatchObject({ samples: 42, targets: 14, outliers: 0 });
    expect(report.geometric!.heldOutMse).toBeLessThan(1e-4);
    expect(report.geometric!.weight).toBe(GEOMETRIC_RANGE[1]); // a near-perfect geometric fit gets the maximum share
  });
  it('blends the two estimators into the returned estimate and reports both', async () => {
    const { engine, step } = await calibrated();
    const target: [number, number] = [.2, -.18];
    const result = await step(gazeFor(target), [target[0] + .1, target[1] + .1]);
    expect(result.estimates!.network).toEqual([target[0] + .1, target[1] + .1]);
    expect(result.estimates!.geometric![0]).toBeCloseTo(target[0], 2); expect(result.estimates!.geometric![1]).toBeCloseTo(target[1], 2);
    const w = engine.trainingReport()!.geometric!.weight;
    expect(result.rawNormPog![0]).toBeCloseTo(target[0] + .1 * (1 - w), 2);
    expect(result.normPog[0]).toBeCloseTo(target[0] + .1 * (1 - w), 2);
    // A check-chosen weight changes the blend, within bounds, and is exported with the calibration.
    expect(engine.setBlend(.3)).toBe(.3); expect(engine.setBlend(5)).toBe(GEOMETRIC_RANGE[1]); engine.setBlend(.3);
    const again = await step(gazeFor(target), [target[0] + .1, target[1]]);
    expect(again.rawNormPog![0]).toBeCloseTo(target[0] + .07, 2);
    const learned = engine.exportCalibration();
    expect(learned.geometric).toMatchObject({ weight: .3, samples: 42, targets: 14 });
    expect(learned.geometric!.weights).toHaveLength(2);
  });
  it('restores a saved geometric estimator and keeps blending without retraining', async () => {
    const { engine } = await calibrated();
    engine.setBlend(.5);
    const learned = engine.exportCalibration();
    let current = observation(gazeFor([-.2, .18]), [-.1, .18]);
    const core: TrackerCore = { step: vi.fn(async () => current), adapt: vi.fn(async () => {}), dispose: vi.fn(), restoreCalibration: vi.fn(), exportCalibration: () => ({ weights: learned.weights, affine: learned.affine, faceWidthCm: learned.faceWidthCm }) };
    const fresh = new CalibrationEngine(core, () => 1000);
    expect(fresh.restoreCalibration(learned)).toBe(true);
    expect(vi.mocked(core.restoreCalibration!).mock.calls[0][0]).toEqual({ weights: learned.weights, affine: learned.affine, faceWidthCm: learned.faceWidthCm });
    const result = await fresh.step(cameraFrame, 1, 1000);
    expect(result.rawNormPog![0]).toBeCloseTo(-.15, 2); expect(result.rawNormPog![1]).toBeCloseTo(.18, 2);
    expect(fresh.exportCalibration().geometric).toEqual(learned.geometric);
    expect(fresh.trainingReport()).toBeNull();
  });
  it('falls back to the network alone when the face geometry is unusable', async () => {
    const { step } = await calibrated();
    const closed = observation(gazeFor([0, 0]), [.1, .1]);
    closed.facialLandmarks[159] = closed.facialLandmarks[145]; closed.facialLandmarks[386] = closed.facialLandmarks[374];
    const engine = (await calibrated()).engine; void engine;
    const result = await step([0, 0], [.1, .1]);
    expect(result.estimates!.geometric).not.toBeNull();
    // Without usable eyes the estimate is the network's own.
    const core: TrackerCore = { step: vi.fn(async () => closed), adapt: vi.fn(async () => {}), dispose: vi.fn() };
    const plain = new CalibrationEngine(core, () => 1000);
    const output = await plain.step(cameraFrame, 1, 1000);
    expect(output.estimates).toEqual({ network: [.1, .1], geometric: null }); expect(output.rawNormPog).toEqual([.1, .1]);
  });
});
