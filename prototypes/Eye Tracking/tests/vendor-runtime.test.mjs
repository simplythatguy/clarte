import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Runs the actual built WebGazer bundle, with a synthetic DOM and eye-patch boundary.
// This verifies the local adaptations, not face detection, gaze accuracy, video decoding or WebGL.
async function runtimeFixture() {
  let clock = 100;
  let nextFrame;
  let videoFrame = 1;
  const addListener = vi.fn();
  const storageOperation = vi.fn(() => { throw new Error('Browser data must not be read or written'); });
  const context2d = {
    drawImage() {}, putImageData() {}, clearRect() {},
    getImageData: (_x, _y, width, height) => ({ width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 256) }),
  };
  class Element extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; }
    style = { width: '320px', height: '240px', setProperty() {} };
    width = 640; height = 480; videoWidth = 640; videoHeight = 480;
    readyState = 4;
    getVideoPlaybackQuality() { return { totalVideoFrames: videoFrame }; }
    setAttribute() {} appendChild() {} remove() {} pause() {}
    getContext() { return context2d; }
    set srcObject(value) { if (value) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
  }
  const location = { protocol: 'http:', hostname: 'localhost', pathname: '/', search: '', href: 'http://localhost:4318/' };
  const sandbox = {
    console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, DOMException,
    navigator: { userAgent: 'Node synthetic fixture', platform: 'test', vendor: '' },
    location, performance: { now: () => clock },
    document: {
      createElement: tag => new Element(tag),
      addEventListener: addListener, removeEventListener() {}, body: new Element('body'),
      documentElement: { clientWidth: 1200, clientHeight: 800 },
    },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
    cancelAnimationFrame: () => { nextFrame = undefined; },
    innerWidth: 1200, innerHeight: 800,
    fetch: vi.fn(() => { throw new Error('No network permitted in synthetic tracker test'); }),
  };
  // TensorFlow probes these handles while registering optional IO managers.
  // A handle lookup is not a persisted-data read; every operation would fail this test.
  Object.defineProperty(sandbox, 'localStorage', { get: () => ({ getItem: storageOperation, setItem: storageOperation, removeItem: storageOperation, clear: storageOperation, key: storageOperation }) });
  Object.defineProperty(sandbox, 'indexedDB', { get: () => ({ open: storageOperation, deleteDatabase: storageOperation }) });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  runInNewContext(await readFile('public/vendor/webgazer.js', 'utf8'), sandbox);
  const webgazer = sandbox.WebGazerLocal.default;
  let eyes = true;
  let headPose = { centerX: .5, centerY: .4, span: .3, roll: 0, yawRatio: 0, pitchRatio: .3 };
  const patch = () => ({ width: 6, height: 10, patch: context2d.getImageData(0, 0, 6, 10) });
  webgazer.addTrackerModule('SyntheticTestOnly', function () {
    this.getEyePatches = async () => eyes ? { left: patch(), right: patch(), headPose } : false;
    this.dispose = () => {};
  });
  webgazer.setTracker('SyntheticTestOnly');
  const stop = vi.fn();
  await webgazer.beginWithStream({ getTracks: () => [{ stop }] });
  return {
    webgazer, stop, addListener, storageOperation,
    advance: async (frozen = false) => { clock += 100; if (!frozen) videoFrame++; const run = nextFrame; nextFrame = undefined; run?.(); await vi.waitFor(() => expect(nextFrame).toBeTypeOf('function')); },
    loseFace: () => { eyes = false; },
    changePose: next => { headPose = next; },
    age: milliseconds => { clock += milliseconds; },
  };
}

describe('adapted real WebGazer bundle with synthetic inputs', () => {
  it('carries pose with the same inferred eye features and drops it on missing or stale frames', async () => {
    const f = await runtimeFixture();
    const first = f.webgazer.getTrackingStatus();
    expect(first.headPose.centerX).toBe(.5);
    const records = [];
    f.webgazer.setGazeListener(() => records.push(f.webgazer.getTrackingStatus()));
    f.changePose({ ...first.headPose, centerX: .6, roll: .2 });
    await f.advance();
    expect(records.at(-1)).toEqual({ faceDetected: true, frameTime: first.frameTime + 100, headPose: { ...first.headPose, centerX: .6, roll: .2 } });
    f.changePose(null);
    await f.advance();
    expect(records.at(-1).headPose).toBeNull();
    expect(records.at(-1).faceDetected).toBe(true); // eye patches alone cannot authorize pose
    f.changePose(first.headPose);
    await f.advance();
    const captured = f.webgazer.getTrackingStatus().frameTime;
    for (let i = 0; i < 7; i++) await f.advance(true);
    expect(f.webgazer.getTrackingStatus()).toEqual({ faceDetected: false, frameTime: captured, headPose: null });
    await f.advance();
    f.loseFace();
    await f.advance();
    expect(records.at(-1).headPose).toBeNull();
    expect(records.at(-1).faceDetected).toBe(false);
    await f.webgazer.end();
    expect(f.webgazer.getTrackingStatus().headPose).toBeNull();
  });
  it('does not refresh a frozen decoded frame or accept duplicate calibration labels', async () => {
    const f = await runtimeFixture();
    f.webgazer.setCalibrationEnabled(true);
    expect(f.webgazer.recordCalibrationPoint(100, 100)).toBe(true);
    const captured = f.webgazer.getTrackingStatus().frameTime;
    const listener = vi.fn();
    f.webgazer.setGazeListener(listener);
    for (let i = 0; i < 20; i++) {
      await f.advance(true);
      expect(f.webgazer.recordCalibrationPoint(100, 100)).toBe(false);
      expect(f.webgazer.getTrackingStatus().frameTime).toBe(captured);
    }
    expect(listener).toHaveBeenLastCalledWith(null, expect.any(Number));
    await f.advance();
    expect(f.webgazer.recordCalibrationPoint(100, 100)).toBe(true);
    await f.webgazer.end();
  });
  it('never attaches incidental training or reads or writes browser data', async () => {
    const f = await runtimeFixture();
    expect(f.webgazer.params.saveDataAcrossSessions).toBe(false);
    f.webgazer.saveDataAcrossSessions(true);
    f.webgazer.addMouseEventListeners();
    expect(f.webgazer.params.saveDataAcrossSessions).toBe(false);
    expect(f.addListener).not.toHaveBeenCalled();
    await f.webgazer.clearData();
    await f.webgazer.end();
    expect(f.storageOperation).not.toHaveBeenCalled();
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it('requires explicit fresh, distinct eye-feature frames for calibration; validation cannot train', async () => {
    const f = await runtimeFixture();
    expect(f.webgazer.recordCalibrationPoint(100, 100)).toBe(false);
    f.webgazer.setCalibrationEnabled(true);
    expect(f.webgazer.recordCalibrationPoint(100, 100)).toBe(true);
    expect(f.webgazer.recordCalibrationPoint(200, 200)).toBe(false);
    f.age(700);
    expect(f.webgazer.recordCalibrationPoint(200, 200)).toBe(false);
    expect(f.webgazer.getRegression()[0].getData()).toHaveLength(1);
    f.webgazer.setCalibrationEnabled(false);
    await f.advance();
    expect(f.webgazer.recordCalibrationPoint(300, 300)).toBe(false);
    expect(f.webgazer.getRegression()[0].getData()).toHaveLength(1);
    f.loseFace();
    await f.advance();
    f.webgazer.setCalibrationEnabled(true);
    expect(f.webgazer.recordCalibrationPoint(400, 400)).toBe(false);
    await f.webgazer.end();
    await f.webgazer.clearData();
    expect(f.webgazer.getRegression()[0].getData()).toHaveLength(0);
  });
});
