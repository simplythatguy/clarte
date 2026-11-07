import { describe, expect, it, vi } from 'vitest';
import { CameraSession, type WebGazerRuntime } from '../src/core/webgazer';

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const pose = { centerX: .5, centerY: .4, span: .3, roll: 0, yawRatio: 0, pitchRatio: .3 };
function fixture() {
  const stop = vi.fn();
  const stopSecond = vi.fn();
  const track = { stop, addEventListener: vi.fn() };
  // MediaStream cannot be constructed in Node. This structural fixture models its used boundary only.
  const stream = { getTracks: () => [track, { stop: stopSecond, addEventListener: vi.fn() }] };
  let listener: (value: unknown) => void = () => {};
  const runtime = {
    beginWithStream: vi.fn(async () => {}), end: vi.fn(async () => {}), clearData: vi.fn(async () => {}),
    setCalibrationEnabled: vi.fn(), recordCalibrationPoint: vi.fn(() => true),
    getTrackingStatus: vi.fn<() => ReturnType<WebGazerRuntime['getTrackingStatus']>>(() => ({ faceDetected: true, frameTime: 25, headPose: pose })),
    setGazeListener: vi.fn((callback: (value: unknown) => void) => { listener = callback; }),
    clearGazeListener: vi.fn(), setErrorListener: vi.fn(), showVideo: vi.fn(),
  } satisfies WebGazerRuntime;
  return { runtime, stream, stop, stopSecond, emit: (value: unknown) => listener(value) };
}

// These tests fake the permission/model boundary; they do not test real webcam inference.
function cameraFixture() {
  const f = fixture();
  const permission = deferred<MediaStream>();
  const acquire = vi.fn(() => permission.promise);
  const camera = new CameraSession({ load: async () => f.runtime, acquire });
  // Runtime checks above cover every accessed property; the browser supplies the complete MediaStream in production.
  const stream = f.stream as unknown as MediaStream;
  return { ...f, camera, permission, stream, acquire };
}

describe('camera ownership', () => {
  it('propagates same-frame geometry and rejects invalid or missing pose without fabricating it from gaze', async () => {
    const f = cameraFixture();
    const frame = vi.fn();
    const start = f.camera.start(frame, vi.fn()); f.permission.resolve(f.stream); await start;
    f.emit(null); // geometry is available before the regression has labels
    expect(frame).toHaveBeenLastCalledWith({ point: null, face: true, at: 25, pose });
    const changed = { ...pose, yawRatio: .2 };
    f.runtime.getTrackingStatus.mockReturnValue({ faceDetected: true, frameTime: 125, headPose: changed });
    f.emit({ x: 100, y: 200 });
    expect(frame).toHaveBeenLastCalledWith({ point: { x: 100, y: 200 }, face: true, at: 125, pose: changed });
    f.runtime.getTrackingStatus.mockReturnValue({ faceDetected: true, frameTime: 225, headPose: { ...pose, span: NaN } });
    f.emit({ x: 100, y: 200 });
    expect(frame.mock.lastCall?.[0].pose).toBeNull();
    f.runtime.getTrackingStatus.mockReturnValue({ faceDetected: false, frameTime: 325, headPose: changed });
    f.emit({ x: 100, y: 200 });
    expect(frame.mock.lastCall?.[0].pose).toBeNull();
    f.camera.stop();
  });
  it('releases a late permission result without starting WebGazer', async () => {
    const f = cameraFixture();
    const start = f.camera.start(vi.fn(), vi.fn());
    await vi.waitFor(() => expect(f.acquire).toHaveBeenCalled());
    f.camera.stop();
    f.permission.resolve(f.stream);
    expect(await start).toBe(false);
    expect(f.stop).toHaveBeenCalled();
    expect(f.stopSecond).toHaveBeenCalled();
    expect(f.runtime.beginWithStream).not.toHaveBeenCalled();
  });
  it('stops every track, clears model data and suppresses old callbacks', async () => {
    const f = cameraFixture();
    const frame = vi.fn();
    const start = f.camera.start(frame, vi.fn());
    f.permission.resolve(f.stream);
    expect(await start).toBe(true);
    f.emit({ x: 30, y: 40 });
    expect(frame).toHaveBeenCalledWith({ point: { x: 30, y: 40 }, face: true, at: 25, pose });
    f.camera.stop();
    f.emit({ x: 90, y: 90 });
    await Promise.resolve();
    expect(frame).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalled();
    expect(f.runtime.end).toHaveBeenCalledTimes(1);
    expect(f.runtime.clearData).toHaveBeenCalled();
  });
  it('rejects a late model initialization completion after changing mode', async () => {
    const f = cameraFixture();
    const model = deferred<void>();
    f.runtime.beginWithStream.mockImplementation(() => model.promise);
    const start = f.camera.start(vi.fn(), vi.fn());
    f.permission.resolve(f.stream);
    await vi.waitFor(() => expect(f.runtime.beginWithStream).toHaveBeenCalled());
    f.camera.stop();
    model.resolve();
    expect(await start).toBe(false);
    expect(f.stop).toHaveBeenCalled();
  });
  it('opens the training gate only around an explicit calibration label', async () => {
    const f = cameraFixture();
    const start = f.camera.start(vi.fn(), vi.fn());
    f.permission.resolve(f.stream);
    await start;
    f.camera.calibrate({ x: 10, y: 20 });
    expect(f.runtime.recordCalibrationPoint).toHaveBeenCalledWith(10, 20);
    expect(f.runtime.setCalibrationEnabled.mock.calls.slice(-2)).toEqual([[true], [false]]);
    f.runtime.recordCalibrationPoint.mockImplementation(() => { throw new Error('model failure'); });
    expect(() => f.camera.calibrate({ x: 20, y: 30 })).toThrow();
    expect(f.runtime.setCalibrationEnabled).toHaveBeenLastCalledWith(false);
    f.camera.stop();
    expect(f.camera.calibrate({ x: 20, y: 30 })).toBe(false);
  });
  it('invalid prediction objects are treated as lost instead of coordinates', async () => {
    const f = cameraFixture();
    const frame = vi.fn();
    const start = f.camera.start(frame, vi.fn());
    f.permission.resolve(f.stream);
    await start;
    f.emit({ x: NaN, y: 3 });
    expect(frame).toHaveBeenLastCalledWith({ point: null, face: true, at: 25, pose });
    f.camera.stop();
  });
});
