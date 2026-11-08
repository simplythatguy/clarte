import { describe, expect, it, vi } from 'vitest';
import { CalibrationEngine, REPLAY_LIMIT, type Observation, type TrackerCore } from '../src/core/worker-engine';
import { readWorkerGaze } from '../src/core/tracking';
import { readDebug } from '../src/lab/tracker';

const landmarks = () => { const pts = Array.from({ length: 478 }, (_, i) => ({ x: .4 + (i % 7) * .02, y: .4 + (i % 5) * .02, z: 0 })); const eye = (ex: number, o: number, n: number, ir: number, u: number, l: number) => { pts[o] = { x: ex - .03, y: .5, z: 0 }; pts[n] = { x: ex + .03, y: .5, z: 0 }; pts[ir] = { x: ex + .004, y: .501, z: 0 }; pts[u] = { x: ex, y: .485, z: 0 }; pts[l] = { x: ex, y: .515, z: 0 }; }; eye(.42, 33, 133, 468, 159, 145); eye(.58, 362, 263, 473, 386, 374); return pts; };
const observation = (): Observation => ({ eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' } as ImageData, headVector: [0, 0, 1], faceOrigin3D: [1, 2, 60], gazeState: 'open', eyeState: 'open', rawNormPog: [.02, .03], normPog: [.01, .02], facialLandmarks: landmarks(), faceRt: { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, durations: { faceLandmarker: 5, total: 9 } });
const frame = () => ({ width: 1280, height: 720, data: new Uint8ClampedArray(1280 * 720 * 4), colorSpace: 'srgb' } as ImageData);

describe('worker engine debug mode (gaze-lab adaptation)', () => {
  it('returns identical shipped fields with debug on and off, and adds the estimator inputs only when on', async () => {
    const make = () => { const core: TrackerCore = { step: vi.fn(async () => observation()), adapt: vi.fn(async () => {}), dispose: vi.fn() }; return new CalibrationEngine(core, () => 1000); };
    const plain = make(), debug = make(); debug.setDebug(true);
    const a = await plain.step(frame(), 1, 1000), b = await debug.step(frame(), 1, 1000);
    expect(a.debug).toBeUndefined();
    expect(JSON.stringify(readWorkerGaze(a))).toBe(JSON.stringify(readWorkerGaze(b)));
    const d = readDebug(b.debug)!;
    expect(d.headVector).toEqual([0, 0, 1]); expect(d.faceOrigin3D).toEqual([1, 2, 60]); expect(d.faceRt).toHaveLength(16);
    expect(d.landmarks).toHaveLength(478 * 3); expect(d.featureVector).toHaveLength(12); expect(d.features!.depth).toBe(60);
    expect(d.timings.faceLandmarker).toBe(5); expect(typeof d.timings.tracker).toBe('number');
    expect(REPLAY_LIMIT).toBe(4000);
  });
  it('keeps the debug payload out of the validated shipped result and reports no landmarks without a face', async () => {
    const core: TrackerCore = { step: vi.fn(async () => ({ ...observation(), facialLandmarks: [], gazeState: 'closed' as const, eyeState: 'unknown' as const, rawNormPog: null })), adapt: vi.fn(async () => {}), dispose: vi.fn() };
    const engine = new CalibrationEngine(core, () => 1000); engine.setDebug(true);
    const r = await engine.step(frame(), 1, 1000);
    expect(r.facePresent).toBe(false); expect(readDebug(r.debug)!.landmarks).toEqual([]); expect(readDebug(r.debug)!.featureVector).toBeNull();
    expect(() => readWorkerGaze(r)).not.toThrow();
  });
});
