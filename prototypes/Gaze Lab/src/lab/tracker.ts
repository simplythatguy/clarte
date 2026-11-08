import { CAMERA, DecodedFrameGate } from '../core/webeyetrack';
import { normalizeGaze, readWorkerGaze, type GazeFrame, type Viewport, type WorkerGaze } from '../core/tracking';
import { WorkerClient } from '../core/worker-client';
import { OneEuroPoint } from '../core/one-euro';
import { readLimits, type DebugStep, type EngineLimits, type ReplayExport } from '../core/worker-engine';
import type { TrainingReport } from '../core/training';
import { readLearnedCalibration, type CameraGeometry, type LearnedCalibration } from '../core/saved-calibration';
import type { GazeFeatures } from '../core/geometric-gaze';
import { headPoseFromLandmarks } from '../core/head-position';
import { gazeFeatures } from '../core/geometric-gaze';

export type TrackerFrame = {
  at: number;
  /** The shipped worker result, validated exactly as the app validates it. */
  gaze: WorkerGaze;
  /** The same result in viewport pixels, with the One Euro pointer the app's cursor follows as `point`. */
  frame: GazeFrame;
  debug: DebugStep | null;
  /** The shadow worker (candidate head) result for the same frame, when configured. */
  shadow: WorkerGaze | null;
  fps: number;
  viewport: Viewport;
};
export interface Tracker {
  readonly kind: 'camera' | 'demo';
  /** `init` adds options to the primary worker's `init` payload (the simple flow raises its collect/train limits); the response is kept in `primaryInit`. */
  start(onFrame: (f: TrackerFrame) => void | Promise<void>, onFailure: (error: unknown) => void, init?: Record<string, unknown>): Promise<string>;
  readonly primaryInit: ShadowInit | null;
  stop(): void;
  collect(norm: readonly [number, number], at: number): Promise<boolean>;
  train(): Promise<TrainingReport | null>;
  setRecording(enabled: boolean): Promise<void>;
  record(norm: readonly [number, number], at: number): Promise<boolean>;
  exportReplay(): Promise<ReplayExport | null>;
  exportCalibration(): Promise<LearnedCalibration | null>;
  /** Runs a second worker with this head restored on every frame (candidate re-test); null removes it. */
  setShadowHead(learned: LearnedCalibration | null): Promise<void>;
  /** Starts a second worker on every frame with this `init` payload (quick-calibration test); returns the worker's init response. */
  startShadow(init: Record<string, unknown>): Promise<ShadowInit>;
  /** Labels the shadow worker's latest frame; same freshness rules as `collect`. */
  shadowCollect(norm: readonly [number, number], at: number): Promise<boolean>;
  shadowTrain(): Promise<TrainingReport | null>;
  shadowExportCalibration(): Promise<LearnedCalibration | null>;
  /** Trains the primary and the shadow worker on their own collected labels at the same time (one stop of the frame loop); each result settles on its own. */
  trainBoth(): Promise<{ primary: PromiseSettledResult<TrainingReport | null>; shadow: PromiseSettledResult<TrainingReport | null> }>;
  /** Terminates the shadow worker (after a failed quick training it would refuse every further frame). */
  stopShadow(): void;
  geometry(): CameraGeometry | null;
  mediaStream(): MediaStream | null;
}
/** What the gaze-lab worker answers to `init`: the flags it took, so a caller can assert what is on. */
export type ShadowInit = { backend: string; fixes: { matrixLayout: boolean; freezePose: boolean }; limits: EngineLimits; blend: { geometricShareMax: number } };
export function readShadowInit(v: unknown): ShadowInit {
  if (!v || typeof v !== 'object' || !('backend' in v) || typeof v.backend !== 'string' || !('fixes' in v) || !v.fixes || typeof v.fixes !== 'object' || !('limits' in v) || !('blend' in v) || !v.blend || typeof v.blend !== 'object') throw new Error('Shadow worker init response is not the gaze-lab worker');
  const fixes = v.fixes as Record<string, unknown>, blend = v.blend as Record<string, unknown>;
  if (typeof blend.geometricShareMax !== 'number') throw new Error('Shadow worker init response has no blend cap');
  return { backend: v.backend, fixes: { matrixLayout: fixes.matrixLayout === true, freezePose: fixes.freezePose === true }, limits: readLimits(v.limits), blend: { geometricShareMax: blend.geometricShareMax } };
}

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
const n3 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x));
export function readDebug(v: unknown): DebugStep | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!n3(o.headVector) || !n3(o.faceOrigin3D)) return null;
  const faceRt = Array.isArray(o.faceRt) && o.faceRt.length === 16 && o.faceRt.every(x => typeof x === 'number') ? o.faceRt as number[] : null;
  const landmarks = Array.isArray(o.landmarks) && o.landmarks.every(x => typeof x === 'number') ? o.landmarks as number[] : [];
  const featureVector = Array.isArray(o.featureVector) && o.featureVector.length === 12 && o.featureVector.every(x => typeof x === 'number') ? o.featureVector as number[] : null;
  const features = o.features && typeof o.features === 'object' ? o.features as GazeFeatures : null;
  const timings = o.timings && typeof o.timings === 'object' ? o.timings as Record<string, number> : {};
  return { headVector: o.headVector, faceOrigin3D: o.faceOrigin3D, faceRt, landmarks, features, featureVector, timings };
}

/** The shipped main-thread driver, kept to its observable behaviour (frame gate, timestamps, collect window, One Euro pointer), plus the debug payload and an optional shadow worker. */
export class LiveTracker implements Tracker {
  readonly kind = 'camera' as const;
  private client: WorkerClient | null = null;
  private shadow: WorkerClient | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private generation = 0;
  private scheduled: (() => void) | null = null;
  private frameGate = new DecodedFrameGate();
  private smoother = new OneEuroPoint();
  private latestAt = -Infinity;
  private lastAt = -Infinity;
  private fps = 0;
  private busy = false;
  private training = false;
  private idle: Promise<void> = Promise.resolve();
  private onFrame: (f: TrackerFrame) => void | Promise<void> = () => {};
  private onFailure: (error: unknown) => void = () => {};
  primaryInit: ShadowInit | null = null;
  constructor(private readonly workerUrl = '/vendor/webeyetrack/worker.js') {}

  async start(onFrame: (f: TrackerFrame) => void | Promise<void>, onFailure: (error: unknown) => void, init: Record<string, unknown> = {}): Promise<string> {
    this.onFrame = onFrame; this.onFailure = onFailure;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API unavailable', 'SecurityError');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, facingMode: 'user' }, audio: false });
    this.stream = stream;
    stream.getTracks().forEach(track => track.addEventListener('ended', () => this.fail(new Error('Camera track ended')), { once: true }));
    const video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true; video.className = 'camera-preview'; video.setAttribute('aria-hidden', 'true');
    video.srcObject = stream; document.body.append(video); this.video = video;
    this.canvas = document.createElement('canvas');
    const generation = ++this.generation;
    const client = new WorkerClient(new Worker(this.workerUrl), error => this.fail(error));
    this.client = client;
    const [response] = await Promise.all([client.call('init', { development: true, normalizeCrop: false, debug: true, ...init }, [], 90000), video.play()]);
    if (generation !== this.generation) throw new Error('Tracker stopped during start');
    try { this.primaryInit = readShadowInit(response); } catch { this.primaryInit = null; }
    this.schedule();
    return response && typeof response === 'object' && 'backend' in response && typeof response.backend === 'string' ? response.backend : 'unknown';
  }
  private fail(error: unknown) { const g = this.generation; this.stop(); if (g === this.generation - 1 || true) this.onFailure(error); }
  private schedule(): void {
    const video = this.video;
    if (!video || this.training || this.busy || this.scheduled) return;
    const id = video.requestVideoFrameCallback((_now, metadata) => { this.scheduled = null; void this.process(metadata.presentedFrames, metadata.mediaTime); });
    this.scheduled = () => video.cancelVideoFrameCallback(id);
  }
  private async process(frames: number, mediaTime: number): Promise<void> {
    const { video, canvas, client, generation } = this;
    if (!video || !canvas || !client || this.training || this.busy) return;
    if (video.readyState < 2 || video.paused || video.ended || !this.frameGate.accept(frames, mediaTime)) { this.schedule(); return; }
    this.busy = true;
    let done = () => {};
    this.idle = new Promise<void>(resolve => { done = resolve; });
    try {
      const width = Math.min(CAMERA.width, video.videoWidth), height = Math.round(video.videoHeight * width / video.videoWidth);
      if (!width || !height) throw new Error('Camera frame has no dimensions');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas input is unavailable');
      context.drawImage(video, 0, 0, width, height);
      const at = performance.now();
      const frame = context.getImageData(0, 0, width, height);
      const shadowFrame = this.shadow ? new ImageData(new Uint8ClampedArray(frame.data), width, height) : null;
      const epoch = performance.timeOrigin + at;
      const [value, shadowValue] = await Promise.all([
        client.call('step', { frame, at, epoch }, [frame.data.buffer]),
        this.shadow && shadowFrame ? this.shadow.call('step', { frame: shadowFrame, at, epoch }, [shadowFrame.data.buffer]) : Promise.resolve(null),
      ]);
      if (generation !== this.generation) return;
      const gaze = readWorkerGaze(value);
      if (gaze.at !== at) throw new Error('Camera result does not match its captured frame');
      const debug = value && typeof value === 'object' && 'debug' in value ? readDebug(value.debug) : null;
      const shadow = shadowValue ? readWorkerGaze(shadowValue) : null;
      this.latestAt = at;
      if (Number.isFinite(this.lastAt)) { const inst = 1000 / Math.max(1, at - this.lastAt); this.fps = this.fps ? this.fps * .9 + inst * .1 : inst; }
      this.lastAt = at;
      const v = viewport();
      await this.onFrame({ at, gaze, frame: this.smooth(normalizeGaze(gaze, v), v), debug, shadow, fps: this.fps, viewport: v });
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { done(); if (generation === this.generation) { this.busy = false; this.schedule(); } }
  }
  /** As the app: the pointer follows the unclipped estimate through a One Euro filter; rawPoint stays unfiltered. */
  private smooth(frame: GazeFrame, v: Viewport): GazeFrame {
    if (!frame.point || !frame.rawPoint) { this.smoother.reset(); return frame; }
    const filtered = this.smoother.filter(frame.rawPoint, frame.at, v.width);
    return { ...frame, point: { x: Math.min(v.width, Math.max(0, filtered.x)), y: Math.min(v.height, Math.max(0, filtered.y)) } };
  }
  async collect(norm: readonly [number, number], at: number): Promise<boolean> {
    if (!this.client || this.training || at !== this.latestAt || performance.now() - at > 600) return false;
    return await this.client.call('collect', { at, x: norm[0], y: norm[1] }) === true;
  }
  async train(): Promise<TrainingReport | null> {
    await this.modelCommand('train', null, 180000);
    const report = await this.client?.call('trainingReport');
    return report && typeof report === 'object' ? report as TrainingReport : null;
  }
  /** With the frame loop stopped, like the other model commands: a 'recording' message arriving during a frame's step is rejected as busy. */
  async setRecording(enabled: boolean): Promise<void> { if (this.client) await this.modelCommand('recording', { enabled }); }
  async record(norm: readonly [number, number], at: number): Promise<boolean> {
    if (!this.client || this.training || at !== this.latestAt) return false;
    return await this.client.call('record', { at, x: norm[0], y: norm[1] }) === true;
  }
  async exportReplay(): Promise<ReplayExport | null> {
    const v = await this.modelCommand('exportReplay', null, 60000);
    if (!v || typeof v !== 'object' || !('entries' in v) || !('images' in v) || !Array.isArray(v.entries) || !Array.isArray(v.images)) return null;
    return { entries: v.entries, images: v.images };
  }
  async exportCalibration(): Promise<LearnedCalibration | null> {
    try { return readLearnedCalibration(await this.modelCommand('exportCalibration', null)); } catch { return null; }
  }
  async setShadowHead(learned: LearnedCalibration | null): Promise<void> {
    this.shadow?.stop(); this.shadow = null;
    if (!learned) return;
    const shadow = (await this.openShadow({})).client;
    if (await shadow.call('restoreCalibration', learned) !== true) { shadow.stop(); this.shadow = null; throw new Error('Candidate head was not restored'); }
  }
  async startShadow(init: Record<string, unknown>): Promise<ShadowInit> { return (await this.openShadow(init)).init; }
  /** Replaces the shadow worker with a fresh one initialised with `init` on top of the shipped page defaults. */
  private async openShadow(init: Record<string, unknown>): Promise<{ client: WorkerClient; init: ShadowInit }> {
    this.shadow?.stop(); this.shadow = null;
    const client = new WorkerClient(new Worker(this.workerUrl), error => this.fail(error));
    const response = await client.call('init', { development: false, normalizeCrop: false, ...init }, [], 90000);
    this.shadow = client;
    return { client, init: readShadowInit(response) };
  }
  async shadowCollect(norm: readonly [number, number], at: number): Promise<boolean> {
    if (!this.shadow || this.training || at !== this.latestAt || performance.now() - at > 600) return false;
    return await this.shadow.call('collect', { at, x: norm[0], y: norm[1] }) === true;
  }
  async shadowTrain(): Promise<TrainingReport | null> {
    await this.modelCommand('train', null, 180000, 'shadow');
    const report = await this.shadow?.call('trainingReport');
    return report && typeof report === 'object' ? report as TrainingReport : null;
  }
  async shadowExportCalibration(): Promise<LearnedCalibration | null> {
    try { return readLearnedCalibration(await this.modelCommand('exportCalibration', null, 20000, 'shadow')); } catch { return null; }
  }
  stopShadow(): void { this.shadow?.stop(); this.shadow = null; }
  async trainBoth(): Promise<{ primary: PromiseSettledResult<TrainingReport | null>; shadow: PromiseSettledResult<TrainingReport | null> }> {
    const report = async (client: WorkerClient | null): Promise<TrainingReport | null> => {
      if (!client) throw new Error('Tracker is unavailable for training');
      await client.call('train', null, [], 180000);
      const r = await client.call('trainingReport');
      return r && typeof r === 'object' ? r as TrainingReport : null;
    };
    const [primary, shadow] = await this.withLoopStopped(() => Promise.allSettled([report(this.client), report(this.shadow)]));
    return { primary, shadow };
  }
  /** Runs a model command on the primary or the shadow worker with the frame loop stopped, so no frame is in flight meanwhile. */
  private async modelCommand(type: string, payload: unknown, timeout = 20000, target: 'primary' | 'shadow' = 'primary'): Promise<unknown> {
    const client = target === 'primary' ? this.client : this.shadow;
    if (!client) throw new Error('Tracker is unavailable for training');
    return this.withLoopStopped(() => client.call(type, payload, [], timeout));
  }
  private async withLoopStopped<T>(work: () => Promise<T>): Promise<T> {
    if (this.training) throw new Error('Tracker is unavailable for training');
    const generation = this.generation;
    this.training = true; this.scheduled?.(); this.scheduled = null;
    try { await this.idle; if (generation !== this.generation) throw new Error('Operation cancelled'); return await work(); }
    finally { if (generation === this.generation) { this.training = false; this.schedule(); } }
  }
  geometry(): CameraGeometry | null {
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    return s?.width && s.height ? { width: s.width, height: s.height, deviceId: s.deviceId ?? '', facingMode: s.facingMode ?? '' } : null;
  }
  mediaStream(): MediaStream | null { return this.stream; }
  stop(): void {
    ++this.generation; this.scheduled?.(); this.scheduled = null;
    this.client?.stop(); this.client = null; this.shadow?.stop(); this.shadow = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null; }
    this.canvas = null; this.busy = false; this.training = false; this.latestAt = -Infinity;
  }
}

/**
 * Demo tracker (`?demo=1`): a synthetic estimate stream so the whole flow runs without a camera. The "gaze"
 * follows the mouse when it moves, otherwise a slow figure of eight; the synthetic face drifts and blinks.
 * Nothing it produces says anything about the real pipeline.
 */
export class DemoTracker implements Tracker {
  readonly kind = 'demo' as const;
  primaryInit: ShadowInit | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private latestAt = -Infinity;
  private mouse: { x: number; y: number; at: number } | null = null;
  private smoothed: [number, number] | null = null;
  private smoother = new OneEuroPoint();
  private trained = false;
  private readonly onMove = (e: PointerEvent) => { this.mouse = { x: e.clientX, y: e.clientY, at: performance.now() }; };
  private seed = 7;
  private rnd() { this.seed = (this.seed * 1103515245 + 12345) % 2147483648; return this.seed / 2147483648 - .5; }
  async start(onFrame: (f: TrackerFrame) => void | Promise<void>, _onFailure?: (error: unknown) => void, init: Record<string, unknown> = {}): Promise<string> {
    this.primaryInit = { backend: 'demo', fixes: { matrixLayout: false, freezePose: false }, limits: readLimits(init.limits), blend: { geometricShareMax: .85 } };
    window.addEventListener('pointermove', this.onMove);
    const t0 = performance.now();
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      try {
        const at = performance.now(), v = viewport(), s = (at - t0) / 1000;
        const blink = s % 4 > 3.8;
        const gazePx = this.mouse && at - this.mouse.at < 1500 ? this.mouse : { x: v.width * (.5 + .4 * Math.sin(s * .5)), y: v.height * (.5 + .35 * Math.sin(s * .9)) };
        const gaze: [number, number] = [gazePx.x / v.width - .5, gazePx.y / v.height - .5];
        // The synthetic head drifts; the synthetic network has a vertical bias that grows with the drift, so the summary has something to show.
        const drift = { x: 3 * Math.sin(s / 11), y: 2 * Math.sin(s / 17), z: 60 + 4 * Math.sin(s / 13) };
        const network: [number, number] = [gaze[0] + .01 * drift.x / 3 + .02 * this.rnd(), gaze[1] - .05 - .02 * drift.y + .06 * this.rnd()];
        const geometric: [number, number] = [gaze[0] + .02 + .03 * this.rnd(), gaze[1] + .03 * this.rnd()];
        const weight = this.trained ? .4 : 0;
        const raw: [number, number] = this.trained ? [network[0] * (1 - weight) + geometric[0] * weight, network[1] * (1 - weight) + geometric[1] * weight] : network;
        this.smoothed = this.smoothed ? [this.smoothed[0] * .8 + raw[0] * .2, this.smoothed[1] * .8 + raw[1] * .2] : raw;
        const clip = (x: number) => Math.max(-.5, Math.min(.5, x));
        const landmarks = demoLandmarks(drift, s);
        const frameSize = { width: 1280, height: 720 };
        const pose = headPoseFromLandmarks(landmarks, frameSize);
        const yaw = 8 * Math.sin(s / 9) * Math.PI / 180, pitch = 5 * Math.sin(s / 7) * Math.PI / 180;
        const faceRt = [Math.cos(yaw), 0, -Math.sin(yaw), 0, Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw), 0, Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw), 0, drift.x, -drift.y, -drift.z, 1];
        const origin = [drift.x, drift.y, drift.z];
        const features = gazeFeatures({ landmarks, faceRt, origin, frame: frameSize });
        const gazeResult: WorkerGaze = blink
          ? { normPog: [0, 0], rawNormPog: null, face: false, open: false, facePresent: true, eyeState: 'closed', at, pose, estimates: null, camera: { dx: 0, dy: 0, tiltDeg: 0, moved: false, matchable: true } }
          : { normPog: [clip(this.smoothed[0]), clip(this.smoothed[1])], rawNormPog: raw, face: true, open: true, facePresent: true, eyeState: 'open', at, pose, estimates: { network, geometric: this.trained ? geometric : null }, camera: { dx: 0, dy: 0, tiltDeg: 0, moved: false, matchable: true } };
        // The synthetic shadow worker (quick-calibration demo): the same gaze with a smaller vertical bias once trained.
        const shadowNetwork: [number, number] = [network[0] + .01 * this.rnd(), network[1] + (this.shadowTrained ? .04 : 0)];
        const shadowRaw: [number, number] = this.shadowTrained ? [shadowNetwork[0] * .8 + geometric[0] * .2, shadowNetwork[1] * .8 + geometric[1] * .2] : shadowNetwork;
        const shadowResult: WorkerGaze | null = !this.shadowOn ? null : blink ? gazeResult
          : { ...gazeResult, normPog: [clip(shadowRaw[0]), clip(shadowRaw[1])], rawNormPog: shadowRaw, estimates: { network: shadowNetwork, geometric: this.shadowTrained ? geometric : null } };
        this.latestAt = at;
        const debug: DebugStep = { headVector: [Math.sin(yaw), Math.sin(pitch), -Math.cos(yaw)], faceOrigin3D: origin, faceRt, landmarks: landmarks.flatMap(p => [p.x, p.y, p.z]), features, featureVector: features ? featureVectorOf(features) : null, timings: { total: 8 } };
        let frame = normalizeGaze(gazeResult, v);
        if (frame.point && frame.rawPoint) { const f = this.smoother.filter(frame.rawPoint, at, v.width); frame = { ...frame, point: { x: Math.min(v.width, Math.max(0, f.x)), y: Math.min(v.height, Math.max(0, f.y)) } }; } else this.smoother.reset();
        void Promise.resolve(onFrame({ at, gaze: gazeResult, frame, debug, shadow: shadowResult, fps: 30, viewport: v })).finally(() => { busy = false; });
      } catch { busy = false; }
    }, 33);
    return 'demo';
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; window.removeEventListener('pointermove', this.onMove); }
  async collect(_norm: readonly [number, number], at: number): Promise<boolean> { return at === this.latestAt; }
  async train(): Promise<TrainingReport | null> {
    await new Promise(r => setTimeout(r, 1500)); this.trained = true;
    return { samples: 42, heldOut: 14, stepsUsed: 200, bestStep: 180, heldOutBefore: .021, heldOutAfter: .009, options: { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 }, geometric: { samples: 42, targets: 14, outliers: 0, heldOutMse: .012, weight: .4 } };
  }
  async setRecording(): Promise<void> {}
  async record(_norm: readonly [number, number], at: number): Promise<boolean> { return at === this.latestAt; }
  async exportReplay(): Promise<ReplayExport | null> { return { entries: [], images: [] }; }
  async exportCalibration(): Promise<LearnedCalibration | null> { return null; }
  async setShadowHead(): Promise<void> {}
  private shadowOn = false;
  private shadowTrained = false;
  async startShadow(init: Record<string, unknown>): Promise<ShadowInit> {
    this.shadowOn = true; this.shadowTrained = false;
    const fixes = init.fixes && typeof init.fixes === 'object' ? init.fixes as Record<string, unknown> : {}, blend = init.blend && typeof init.blend === 'object' ? init.blend as Record<string, unknown> : {};
    return { backend: 'demo', fixes: { matrixLayout: fixes.matrixLayout === true, freezePose: fixes.freezePose === true }, limits: readLimits(init.limits), blend: { geometricShareMax: typeof blend.geometricShareMax === 'number' ? blend.geometricShareMax : .85 } };
  }
  async shadowCollect(_norm: readonly [number, number], at: number): Promise<boolean> { return this.shadowOn && at === this.latestAt; }
  async shadowTrain(): Promise<TrainingReport | null> {
    await new Promise(r => setTimeout(r, 1000)); this.shadowTrained = true;
    return { samples: 112, heldOut: 8, stepsUsed: 200, bestStep: 120, heldOutBefore: .02, heldOutAfter: .007, options: { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 }, geometric: { samples: 112, targets: 8, outliers: 0, heldOutMse: .004, weight: .2 } };
  }
  async shadowExportCalibration(): Promise<LearnedCalibration | null> { return null; }
  stopShadow(): void { this.shadowOn = false; }
  async trainBoth() { const [primary, shadow] = await Promise.allSettled([this.train(), this.shadowTrain()]); return { primary, shadow }; }
  geometry(): CameraGeometry | null { return { width: 1280, height: 720, deviceId: 'demo', facingMode: 'user' }; }
  mediaStream(): MediaStream | null { return null; }
}

import { featureVector as featureVectorOf } from '../core/geometric-gaze';
/** 478 synthetic landmarks (normalized to a 1280×720 frame) with the eye-corner, lid, iris and nose indices placed so the shipped pose and geometry functions accept them. */
function demoLandmarks(drift: { x: number; y: number; z: number }, s: number): { x: number; y: number; z: number }[] {
  const cx = .5 + drift.x / 100, cy = .45 + drift.y / 100, scale = 60 / drift.z;
  const pts = Array.from({ length: 478 }, (_, i) => { const a = i / 478 * Math.PI * 2; return { x: cx + .12 * scale * Math.cos(a), y: cy + .18 * scale * Math.sin(a), z: -.02 }; });
  const eye = (ex: number, outer: number, inner: number, iris: number, upper: number, lower: number) => {
    const w = .045 * scale;
    pts[outer] = { x: ex - w / 2, y: cy, z: 0 }; pts[inner] = { x: ex + w / 2, y: cy, z: 0 };
    pts[iris] = { x: ex + .004 * Math.sin(s * .5) * scale, y: cy + .002 * Math.sin(s * .9), z: 0 };
    pts[upper] = { x: ex, y: cy - .012 * scale, z: 0 }; pts[lower] = { x: ex, y: cy + .012 * scale, z: 0 };
  };
  eye(cx - .06 * scale, 33, 133, 468, 159, 145); eye(cx + .06 * scale, 362, 263, 473, 386, 374);
  pts[4] = { x: cx + .01 * Math.sin(s / 9), y: cy + .06 * scale, z: -.05 };
  return pts;
}
