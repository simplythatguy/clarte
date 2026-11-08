import { describe, expect, it, vi } from 'vitest';
import { CalibrationEngine, SHIPPED_LIMITS, readLimits, type Observation, type TrackerCore } from '../src/core/worker-engine';
import { GEOMETRIC } from '../src/core/geometric-gaze';

/** Landmarks whose iris offset follows the label, so the geometric ridge fit succeeds with a small held-out error. */
const landmarks = (label: readonly [number, number]) => {
  const pts = Array.from({ length: 478 }, (_, i) => ({ x: .4 + (i % 7) * .02, y: .4 + (i % 5) * .02, z: 0 }));
  const eye = (ex: number, o: number, n: number, ir: number, u: number, l: number) => {
    pts[o] = { x: ex - .03, y: .5, z: 0 }; pts[n] = { x: ex + .03, y: .5, z: 0 };
    pts[ir] = { x: ex + .012 * label[0], y: .5 + .004 * label[1], z: 0 };
    pts[u] = { x: ex, y: .485 - .006 * label[1], z: 0 }; pts[l] = { x: ex, y: .515 - .003 * label[1], z: 0 };
  };
  eye(.42, 33, 133, 468, 159, 145); eye(.58, 362, 263, 473, 386, 374);
  return pts;
};
const observation = (label: readonly [number, number]): Observation => ({
  eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' } as ImageData,
  headVector: [0, 0, 1], faceOrigin3D: [1, 2, 60], gazeState: 'open', eyeState: 'open', rawNormPog: [label[0], label[1]], normPog: [label[0], label[1]],
  facialLandmarks: landmarks(label), faceRt: { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
});
const frame = () => ({ width: 1280, height: 720, data: new Uint8ClampedArray(1280 * 720 * 4), colorSpace: 'srgb' } as ImageData);
const CELLS: [number, number][] = [[-.375, -.25], [-.125, -.25], [.125, -.25], [.375, -.25], [.375, .25], [.125, .25], [-.125, .25], [-.375, .25]];

function engine(heldOutAfter = .002) {
  let now = 1000, label: [number, number] = [0, 0];
  const core: TrackerCore = { step: vi.fn(async () => observation(label)), adapt: vi.fn(async () => {}), dispose: vi.fn(), lastTraining: { samples: 0, heldOut: 0, stepsUsed: 0, bestStep: 0, heldOutBefore: heldOutAfter, heldOutAfter, options: { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 } } };
  const e = new CalibrationEngine(core, () => now);
  /** Steps one frame looking at `target` and offers it as a label; returns whether collect accepted it. */
  const label1 = async (target: [number, number]) => { label = target; now += 40; await e.step(frame(), now, now); return e.collect(now, target[0], target[1]); };
  return { e, label1, core };
}

describe('worker engine limits and blend cap (gaze-lab quick-calibration adaptation)', () => {
  it('reads limits with the shipped constants as defaults and never lets maxSamples fall below minSamples', () => {
    expect(readLimits(null)).toEqual(SHIPPED_LIMITS);
    expect(readLimits({ maxSamples: 200, minSamples: 24, minTargets: 8 })).toEqual({ maxSamples: 200, minSamples: 24, minTargets: 8 });
    expect(readLimits({ maxSamples: 10, minSamples: 24 })).toEqual({ maxSamples: 24, minSamples: 24, minTargets: 9 });
    expect(readLimits({ maxSamples: -1, minSamples: 1.5, minTargets: 'x' })).toEqual(SHIPPED_LIMITS);
  });
  it('caps collect at 42 samples by default and at maxSamples when set', async () => {
    const shipped = engine();
    let accepted = 0;
    for (let i = 0; i < 50; i++) if (await shipped.label1(CELLS[i % 8])) accepted++;
    expect(accepted).toBe(42);
    const quick = engine();
    expect(quick.e.setLimits({ maxSamples: 200, minSamples: 24, minTargets: 8 })).toEqual({ maxSamples: 200, minSamples: 24, minTargets: 8 });
    accepted = 0;
    for (let i = 0; i < 60; i++) if (await quick.label1(CELLS[i % 8])) accepted++;
    expect(accepted).toBe(60);
    expect(() => quick.e.setLimits({ maxSamples: 300 })).toThrow(/before collecting/);
  });
  it('refuses to train on 8 distinct targets unless minTargets allows it, and respects minSamples', async () => {
    const shipped = engine();
    for (let i = 0; i < 40; i++) await shipped.label1(CELLS[i % 8]);
    await expect(shipped.e.train()).rejects.toThrow(/nine instructed targets/);
    const quick = engine();
    quick.e.setLimits({ maxSamples: 200, minSamples: 24, minTargets: 8 });
    for (let i = 0; i < 16; i++) await quick.label1(CELLS[i % 8]);
    await expect(quick.e.train()).rejects.toThrow(/8 instructed targets/);
    for (let i = 0; i < 24; i++) await quick.label1(CELLS[i % 8]);
    await expect(quick.e.train()).resolves.toBe(40);
    expect(quick.e.state).toBe('trained');
    expect(quick.core.adapt).toHaveBeenCalledTimes(1);
  });
  it('caps the geometric share of the trained blend and of setBlend at geometricShareMax (default: the shipped 0.85)', async () => {
    // A large network held-out error against a well-fitted geometric model gives the shipped inverse-MSE rule a share well above 0.2.
    const run = async (cap: number | null) => {
      const x = engine(1);
      x.e.setLimits({ maxSamples: 200, minSamples: 24, minTargets: 8 });
      if (cap !== null) expect(x.e.setGeometricShareMax(cap)).toBe(cap);
      for (let i = 0; i < 48; i++) await x.label1(CELLS[i % 8]);
      await x.e.train();
      return x.e;
    };
    const shipped = await run(null), capped = await run(.2);
    const shippedReport = shipped.trainingReport()!.geometric!, cappedReport = capped.trainingReport()!.geometric!;
    expect(shippedReport.targets).toBe(8);
    expect(shippedReport.weight).toBeGreaterThan(.2);
    expect(shippedReport.weight).toBeLessThanOrEqual(GEOMETRIC.weightRange[1]);
    expect(cappedReport.weight).toBeLessThanOrEqual(.2);
    expect(cappedReport.heldOutMse).toBe(shippedReport.heldOutMse);
    expect(shipped.setBlend(.8)).toBeCloseTo(.8);
    expect(capped.setBlend(.8)).toBeCloseTo(.2);
    expect(capped.setBlend(.1)).toBeCloseTo(.1);
    expect(capped.setGeometricShareMax('nope')).toBe(GEOMETRIC.weightRange[1]);
    expect(capped.setGeometricShareMax(2)).toBe(GEOMETRIC.weightRange[1]);
  });
});
