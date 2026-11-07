import { describe, expect, it, vi } from 'vitest';
import { CalibrationEngine, REPLAY_LIMIT, type Observation, type TrackerCore } from '../src/core/worker-engine';
import { buildReplayFile, parseReplayFile, REPLAY_MAGIC } from '../src/core/replay-file';
import { summarizeCheck } from '../src/core/check-report';
import { ValidationRun, validationPosition } from '../src/core/validation';
import type { GazeFrame } from '../src/core/tracking';

const observation = (): Observation => ({ eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' }, headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], gazeState: 'open', eyeState: 'open', rawNormPog: [.02, .03], normPog: [.01, .02], facialLandmarks: Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 })), faceRt: { rows: 4, columns: 4, data: Array.from({ length: 16 }, (_, i) => i) } });
const encode = vi.fn(async (image: ImageData) => new Blob([new Uint8Array([image.width & 255, image.height & 255])], { type: 'image/png' }));
const core = (sample: Observation): TrackerCore => ({ step: vi.fn(async () => sample), adapt: vi.fn(async () => {}), dispose: vi.fn() });

describe('development replay recording in the calibration engine', () => {
  it('records nothing unless enabled, then keeps instructed calibration frames with their labels', async () => {
    const sample = observation(), engine = new CalibrationEngine(core(sample), () => 1000, encode);
    await engine.step(sample.eyePatch, 1, 1000); expect(engine.collect(1, .1, -.1)).toBe(true);
    expect(engine.replayCount).toBe(0);
    engine.setRecording(true);
    await engine.step(sample.eyePatch, 2, 1000); expect(engine.collect(2, .2, -.2)).toBe(true);
    await vi.waitFor(() => expect(engine.replayCount).toBe(1));
    const { entries, images } = engine.exportReplay();
    expect(entries[0]).toMatchObject({ at: 2, kind: 'calibration', label: [.2, -.2], headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], rawNormPog: [.02, .03], frame: { width: 512, height: 128 } });
    expect(entries[0].landmarks).toHaveLength(478 * 3); expect(entries[0].faceRt).toHaveLength(16);
    expect(images[0].type).toBe('image/png');
    // Turning recording off discards the set.
    engine.setRecording(false); expect(engine.replayCount).toBe(0);
  });

  it('records check frames only while trained and only for the frame just measured', async () => {
    const sample = observation(), engine = new CalibrationEngine(core(sample), () => 1000, encode);
    engine.setRecording(true);
    await engine.step(sample.eyePatch, 1, 1000);
    expect(await engine.record(1, 0, 0)).toBe(false); // not trained: only the calibration path records
    for (let n = 0; n < 27; n++) { await engine.step(sample.eyePatch, n + 2, 1000); engine.collect(n + 2, (n % 3 - 1) * .3, (Math.floor(n / 3) % 3 - 1) * .3); }
    await engine.train();
    await engine.step(sample.eyePatch, 50, 1000);
    expect(await engine.record(49, 0, 0)).toBe(false);
    expect(await engine.record(50, .25, .25)).toBe(true);
    expect(await engine.record(50, .25, .25)).toBe(false); // consumed
    const { entries } = engine.exportReplay();
    expect(entries.filter(e => e.kind === 'check')).toHaveLength(1);
    expect(entries.filter(e => e.kind === 'calibration')).toHaveLength(27);
    expect(entries.length).toBeLessThanOrEqual(REPLAY_LIMIT);
  });

  it('a trained engine without recording keeps no raw frame', async () => {
    const sample = observation(), engine = new CalibrationEngine(core(sample), () => 1000, encode);
    for (let n = 0; n < 27; n++) { await engine.step(sample.eyePatch, n + 1, 1000); engine.collect(n + 1, (n % 3 - 1) * .3, (Math.floor(n / 3) % 3 - 1) * .3); }
    await engine.train();
    await engine.step(sample.eyePatch, 40, 1000);
    engine.setRecording(true);
    expect(await engine.record(40, 0, 0)).toBe(false);
  });
});

describe('replay file container', () => {
  it('round-trips the manifest and the images', async () => {
    const entries = [1, 2].map(i => ({ at: i, kind: 'calibration' as const, label: [0, 0], headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], normPog: [0, 0], rawNormPog: null, faceRt: null, landmarks: [], frame: { width: 512, height: 128 } }));
    const images = [new Blob([new Uint8Array([1, 2, 3])]), new Blob([new Uint8Array([4, 5])])];
    const file = buildReplayFile({ createdAt: 5, model: 'm', viewport: { width: 1280, height: 800 }, pixelRatio: 2, camera: { width: 1280, height: 720 } }, entries, images);
    expect(await file.slice(0, REPLAY_MAGIC.length).text()).toBe(REPLAY_MAGIC);
    const parsed = await parseReplayFile(file);
    expect(parsed.manifest.entries.map(e => [e.offset, e.length])).toEqual([[0, 3], [3, 2]]);
    expect(Array.from(new Uint8Array(await parsed.images[1].arrayBuffer()))).toEqual([4, 5]);
    await expect(parseReplayFile(new Blob(['nope']))).rejects.toThrow('Not a Clarte replay file');
  });
});

describe('check summary', () => {
  function frame(run: ValidationRun, at: number, dy: number): GazeFrame {
    const { target } = validationPosition(run.targets, run.viewport, at, run.motion);
    return { at, face: true, pose: null, facePresent: true, eyeState: 'open', point: { x: 0, y: 0 }, rawPoint: { x: target.x + 4, y: target.y + dy } };
  }
  it('describes a pointer that sits above the gaze and ranks the models', () => {
    const run = new ValidationRun({ width: 1280, height: 800 }, 'still', 'smooth', () => .5); run.start(0);
    for (let at = 50; at < 60_000; at += 100) run.admit(frame(run, at, -60), at);
    run.tick(60_000);
    if (run.state.kind !== 'complete') throw new Error('not complete');
    const summary = summarizeCheck(run.state.result, 123)!;
    expect(summary.medianPx).toBeCloseTo(Math.hypot(4, 60), 5);
    expect(summary.bias!.dy).toBeCloseTo(-60, 5);
    expect(summary.notes[0]).toMatch(/60 px above/);
    expect(summary.models.find(m => m.best)!.model).not.toBe('none');
    expect(summary.regions).toHaveLength(4);
    expect(summarizeCheck({ ...run.state.result, kind: 'insufficient' }, 1)).toBeNull();
  });
});
