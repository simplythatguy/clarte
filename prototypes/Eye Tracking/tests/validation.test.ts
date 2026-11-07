import { describe, expect, it } from 'vitest';
import { calibrationPoints } from '../src/core/calibration';
import { VALIDATION, ValidationRun, validationPosition, validationTargets, type CheckMotion } from '../src/core/validation';
import type { GazeFrame } from '../src/core/tracking';

const viewport = { width: 1280, height: 800 };
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function frame(run: ValidationRun, at: number, offset = 1): GazeFrame {
  const { target } = validationPosition(run.targets, run.viewport, at, run.motion);
  return { at, face: true, pose: null, facePresent: true, eyeState: 'open' as const, point: { x: 0, y: 0 }, rawPoint: { x: target.x + 3 * offset, y: target.y + 4 * offset } };
}
function finish(options: { step?: number; motion?: CheckMotion; include?: (at: number) => boolean; offset?: (at: number) => number } = {}) {
  const run = new ValidationRun(viewport, 'still', options.motion ?? 'smooth', rng(5)); run.start(0);
  for (let at = 50; at < 60_000; at += options.step ?? 100) {
    if (options.include?.(at) !== false) run.admit(frame(run, at, options.offset?.(at) ?? 1), at);
    else run.tick(at);
  }
  run.tick(60_000);
  if (run.state.kind !== 'complete') throw new Error('Run did not finish');
  return run.state.result;
}

describe('bounded randomized held-out references', () => {
  it.each([{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 240 }])('has coverage, margins and separation at $width × $height', size => {
    for (let seed = 0; seed < 40; seed++) {
      const points = validationTargets(size, rng(seed)), training = [...calibrationPoints(size), ...calibrationPoints(size, 'head')];
      expect(points).toHaveLength(10);
      expect(new Set(points.map(p => `${p.x}:${p.y}`)).size).toBe(10);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(24); expect(point.x).toBeLessThanOrEqual(size.width - 24);
        expect(point.y).toBeGreaterThanOrEqual(24); expect(point.y).toBeLessThanOrEqual(size.height - 24);
        expect(training.every(t => Math.hypot(t.x - point.x, t.y - point.y) >= Math.min(40, Math.min(size.width, size.height) * .065))).toBe(true);
      }
      expect(Math.min(...points.map(p => p.x))).toBeLessThan(size.width * .3);
      expect(Math.max(...points.map(p => p.x))).toBeGreaterThan(size.width * .7);
      expect(Math.min(...points.map(p => p.y))).toBeLessThan(size.height * .3);
      expect(Math.max(...points.map(p => p.y))).toBeGreaterThan(size.height * .7);
    }
    expect(validationTargets(size, rng(1))).not.toEqual(validationTargets(size, rng(2)));
  });
  it('terminates even for a broken or constant random source and rejects unusable geometry', () => {
    let calls = 0;
    expect(validationTargets(viewport, () => { calls++; return NaN; })).toHaveLength(10);
    expect(calls).toBeLessThanOrEqual(249);
    expect(validationTargets(viewport, () => 0)).toHaveLength(10);
    expect(() => validationTargets({ width: NaN, height: 800 })).toThrow();
    expect(() => validationTargets({ width: 1280, height: 100 })).toThrow();
  });
});

describe('active-time validation and raw sample admission', () => {
  it('uses exact movement/settling boundaries, no labels, and captured-time reference identity', () => {
    const run = new ValidationRun(viewport, 'turn', 'smooth', rng(2));
    expect(run.admit(frame(run, 2500), 2500)).toBe(false);
    expect(run.start(0)).toBe(true); expect(run.start(1)).toBe(false);
    run.tick(600); expect(run.position?.point.x).toBeCloseTo((viewport.width / 2 + run.targets[0].x) / 2);
    expect(run.position?.stage).toBe('moving');
    run.tick(1200); expect(run.position?.point).toEqual(run.targets[0]); expect(run.position?.stage).toBe('settling');
    expect(run.admit(frame(run, 2399), 2400)).toBe(false);
    expect(run.admit(frame(run, 2400), 2401)).toBe(true);
    // The next point is already moving on screen, but this fresh capture belongs to the preceding hold.
    expect(run.admit(frame(run, 5990), 6100)).toBe(true);
    expect(run.position?.index).toBe(1); expect(run.position?.stage).toBe('moving');
    expect(run.admit(frame(run, 6100), 6100)).toBe(false);
    expect('train' in run).toBe(false); expect('collect' in run).toBe(false);
  });
  it('rejects duplicate, out-of-order, stale, future, nonfinite, closed/lost, missing-raw and wrong-stage frames', () => {
    const run = new ValidationRun(viewport, 'still', 'smooth', rng(1)); run.start(0);
    expect(run.admit(frame(run, 2450), 2450)).toBe(true);
    expect(run.admit(frame(run, 2450), 2451)).toBe(false);
    expect(run.admit(frame(run, 2449), 2452)).toBe(false);
    expect(run.admit(frame(run, 2451), 3100)).toBe(false);
    expect(run.admit(frame(run, 3300), 3200)).toBe(false);
    expect(run.admit({ ...frame(run, 3201), at: NaN }, 3201)).toBe(false);
    expect(run.admit({ ...frame(run, 3301), rawPoint: { x: NaN, y: 0 } }, 3301)).toBe(false);
    expect(run.admit({ ...frame(run, 3401), face: false }, 3401)).toBe(false);
    expect(run.admit({ ...frame(run, 3501), rawPoint: null }, 3501)).toBe(false);
    expect(run.admit(frame(run, 3550), NaN)).toBe(false);
    expect(run.admit(frame(run, 3601), 3601)).toBe(true);
    expect(run.admit(frame(run, 3650), 3650)).toBe(false); // one observation per time bin
    expect(run.admit(frame(run, 6000), 6000)).toBe(false);
  });
  it('uses pre-filter unclipped raw coordinates, never the visual/assisted point', () => {
    const run = new ValidationRun(viewport, 'still', 'smooth', rng(1)); run.start(0);
    for (let at = 50; at < 60_000; at += 100) {
      const f = frame(run, at, 100);
      expect(f.point).toEqual({ x: 0, y: 0 });
      run.admit(f, at);
    }
    run.tick(60_000);
    expect(run.state.kind).toBe('complete');
    if (run.state.kind === 'complete' && run.state.result.kind === 'measured') {
      expect(run.state.result.medianPx).toBeCloseTo(500, 10);
      expect(run.state.result.p90Px).toBeCloseTo(500, 10);
    } else throw new Error('Expected measured result');
    expect(run.admit(frame(run, 59999), 60_001)).toBe(false);
  });
  it('excludes manual/hidden time, rejects pending pre-resume captures and spends a fresh settle inside the remaining minute', () => {
    const run = new ValidationRun(viewport, 'still', 'smooth', rng(1)); run.start(1000);
    run.tick(4000); run.pause(4000, 'manual');
    expect(run.state).toMatchObject({ kind: 'paused', elapsedMs: 3000 });
    run.tick(12_000); expect(run.admit(frame(run, 3500), 12_000)).toBe(false);
    expect(run.resume(12_000)).toBe(true); expect(run.position?.stage).toBe('settling');
    expect(run.admit(frame(run, 11_999), 12_001)).toBe(false);
    expect(run.admit(frame(run, 13_199), 13_199)).toBe(false);
    expect(run.admit(frame(run, 13_200), 13_200)).toBe(true);
    run.tick(14_000, false); expect(run.state).toMatchObject({ kind: 'paused', elapsedMs: 4200, reason: 'hidden' });
    expect(run.admit(frame(run, 20_000), 20_000, false)).toBe(false);
    expect(run.resume(30_000)).toBe(true);
    run.tick(85_800); expect(run.state.kind).toBe('complete');
    if (run.state.kind === 'complete') expect(run.state.result.measurementMs).toBe(33_600);
  });
  it('stops at exactly 60 active seconds even with zero frames and clears cancelled results', () => {
    const run = new ValidationRun(viewport, 'still', 'smooth', rng(1)); run.start(0);
    run.tick(59_999); expect(run.state.kind).toBe('running');
    run.tick(60_000); expect(run.state).toMatchObject({ kind: 'complete', result: { kind: 'insufficient', bins: 0, coverage: 0, measurementMs: 36_000 } });
    run.cancel('viewport'); expect(run.state).toEqual({ kind: 'cancelled', reason: 'viewport' });
    expect(run.resume(70_000)).toBe(false); expect(run.start(70_000)).toBe(false);
    expect(run.admit(frame(run, 71_000), 71_000)).toBe(false);
  });
  it('reduced motion has identical scoring windows and jumps instead of pursuit movement', () => {
    const run = new ValidationRun(viewport, 'still', 'reduced', rng(1)); run.start(0); run.tick(600);
    expect(run.position?.point).toEqual(run.targets[0]); expect(run.position?.stage).toBe('moving');
    expect(finish({ motion: 'reduced' })).toMatchObject({ kind: 'measured', motion: 'reduced', coverage: 1, medianPx: 5 });
  });
});

describe('defined binned statistics and time coverage', () => {
  it('computes Euclidean median and nearest-rank p90 exactly on known synthetic offsets', () => {
    const result = finish({ offset: at => Math.floor(at / 6000) + 1 });
    expect(result).toMatchObject({ kind: 'measured', bins: 360, targets: 10, coverage: 1, measurementMs: 36_000, coveredMs: 36_000 });
    if (result.kind !== 'measured') throw new Error('Missing synthetic metric');
    expect(result.medianPx).toBeCloseTo(27.5); expect(result.p90Px).toBeCloseTo(45);
  });
  it('has the same coverage/statistics at 10 and 100 Hz, without letting bursts hide dropouts', () => {
    const slow = finish(), fast = finish({ step: 10 });
    expect(fast).toEqual(slow);
    const dropout = finish({ step: 10, include: at => at % 6000 < 4200 });
    expect(dropout).toMatchObject({ kind: 'measured', coverage: .5, bins: 180, coveredMs: 18_000, targets: 10 });
    const bursts = finish({ step: 1, include: at => at % 6000 >= 2400 && at % 6000 < 2500 });
    expect(bursts).toMatchObject({ kind: 'insufficient', bins: 10, targets: 10, coveredMs: 1000 });
    expect(bursts.coverage).toBeCloseTo(1 / 36);
  });
  it('does not overflow the even-count median when raw errors are large but finite', () => {
    const result = finish({ offset: () => 2e307 });
    expect(result.kind).toBe('measured');
    if (result.kind === 'measured') { expect(Number.isFinite(result.medianPx)).toBe(true); expect(Number.isFinite(result.p90Px)).toBe(true); }
  });
  it('requires broad target coverage and enough bins; missing data never becomes zero error', () => {
    const partial = finish({ include: at => at < 42_000 });
    expect(partial).toMatchObject({ kind: 'insufficient', targets: 7 });
    expect(partial).not.toHaveProperty('medianPx'); expect(partial).not.toHaveProperty('p90Px');
    expect(finish({ include: () => false })).toMatchObject({ kind: 'insufficient', coverage: 0, bins: 0, coveredMs: 0 });
    expect(VALIDATION.durationMs).toBe(VALIDATION.targets * VALIDATION.slotMs);
  });
});
