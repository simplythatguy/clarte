/**
 * The webcam eye tracker: WebEyeTrack in a worker (`public/vendor/webeyetrack`, built in Gaze Lab),
 * driven the way the Eye Tracking app drives it (frame gate, capture timestamps, the 600 ms collect
 * window, the One Euro pointer). It is Gaze Lab's `LiveTracker` with one worker and without its
 * shadow worker, debug payload and recording.
 *
 * The worker starts with Gaze Lab's quick-calibration settings (DEC-095, DEC-097): the pose input
 * rows frozen during calibration, collect and train limits for eight dots, and the geometric share
 * of the blend capped at 0.2.
 *
 * `debug` (NAT-47) makes the worker attach each frame's face landmarks to its result, beside the
 * unchanged gaze outputs; the Cloud reads the person's blinks, smile and position from them
 * (expression.ts).
 */
import { CAMERA, DecodedFrameGate } from './core/webeyetrack';
import { normalizeGaze, readWorkerGaze, type GazeFrame, type Viewport } from './core/tracking';
import { WorkerClient } from './core/worker-client';
import { OneEuroPoint } from './core/one-euro';
import { readLearnedCalibration, type CameraGeometry, type LearnedCalibration } from './core/saved-calibration';
import type { TrainingReport } from './core/training';
import { observeFace, resetFace } from './expression';

export const WORKER_INIT = {
  development: false,
  debug: true,
  normalizeCrop: false,
  fixes: { freezePose: true },
  limits: { maxSamples: 200, minSamples: 24, minTargets: 8 },
  blend: { geometricShareMax: 0.2 },
} as const;

const WORKER_URL = '/vendor/webeyetrack/worker.js';
/** A label must be taken from a frame at most this old (the Eye Tracking app's collect window). */
const COLLECT_WINDOW_MS = 600;

/** `face`: the worker found a face with open eyes, whether or not the estimate is on screen (labels need only that). */
export type EyeFrame = { at: number; face: boolean; frame: GazeFrame; viewport: Viewport };

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

export class EyeTracker {
  private client: WorkerClient | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private generation = 0;
  private scheduled: (() => void) | null = null;
  private frameGate = new DecodedFrameGate();
  private smoother = new OneEuroPoint();
  private latestAt = -Infinity;
  private busy = false;
  private training = false;
  private idle: Promise<void> = Promise.resolve();
  private onFrame: (f: EyeFrame) => void = () => {};
  private onFailure: (error: unknown) => void = () => {};

  async start(onFrame: (f: EyeFrame) => void, onFailure: (error: unknown) => void): Promise<void> {
    this.onFrame = onFrame;
    this.onFailure = onFailure;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API unavailable', 'SecurityError');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, facingMode: 'user' }, audio: false });
    this.stream = stream;
    stream.getTracks().forEach((track) => track.addEventListener('ended', () => this.fail(new Error('Camera track ended')), { once: true }));
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.className = 'camera-feed';
    video.setAttribute('aria-hidden', 'true');
    video.srcObject = stream;
    document.body.append(video);
    this.video = video;
    this.canvas = document.createElement('canvas');
    const generation = ++this.generation;
    await Promise.all([this.openWorker(generation), video.play()]);
    this.schedule();
  }

  private async openWorker(generation: number): Promise<void> {
    const client = new WorkerClient(new Worker(WORKER_URL), (error) => this.fail(error));
    this.client = client;
    await client.call('init', WORKER_INIT, [], 90000);
    if (generation !== this.generation) throw new Error('Tracker stopped during start');
  }

  /**
   * Replace the worker with a fresh, untrained one; the camera keeps running. The worker accepts
   * labels only before it has trained or restored a calibration, and keeps a failed run's samples,
   * so every calibration run starts here.
   */
  async reset(): Promise<void> {
    if (!this.video) throw new Error('Tracker is unavailable');
    const generation = this.generation;
    await this.withLoopStopped(async (old) => {
      old.stop();
      await this.openWorker(generation);
    });
  }

  private fail(error: unknown): void {
    this.stop();
    this.onFailure(error);
  }

  private schedule(): void {
    const video = this.video;
    if (!video || this.training || this.busy || this.scheduled) return;
    const id = video.requestVideoFrameCallback((_now, metadata) => {
      this.scheduled = null;
      void this.process(metadata.presentedFrames, metadata.mediaTime);
    });
    this.scheduled = () => video.cancelVideoFrameCallback(id);
  }

  private async process(frames: number, mediaTime: number): Promise<void> {
    const { video, canvas, client, generation } = this;
    if (!video || !canvas || !client || this.training || this.busy) return;
    if (video.readyState < 2 || video.paused || video.ended || !this.frameGate.accept(frames, mediaTime)) { this.schedule(); return; }
    this.busy = true;
    let done = () => {};
    this.idle = new Promise<void>((resolve) => { done = resolve; });
    try {
      const width = Math.min(CAMERA.width, video.videoWidth);
      const height = Math.round((video.videoHeight * width) / video.videoWidth);
      if (!width || !height) throw new Error('Camera frame has no dimensions');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas input is unavailable');
      context.drawImage(video, 0, 0, width, height);
      const at = performance.now();
      const frame = context.getImageData(0, 0, width, height);
      const value = await client.call('step', { frame, at, epoch: performance.timeOrigin + at }, [frame.data.buffer]);
      if (generation !== this.generation) return;
      const gaze = readWorkerGaze(value);
      if (gaze.at !== at) throw new Error('Camera result does not match its captured frame');
      this.latestAt = at;
      const v = viewport();
      this.onFrame({ at, face: gaze.face, frame: this.smooth(normalizeGaze(gaze, v), v), viewport: v });
      const landmarks = (value as { debug?: { landmarks?: unknown } }).debug?.landmarks;
      if (Array.isArray(landmarks) && landmarks.length >= 478 * 3) observeFace(landmarks, at, { width, height });
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    } finally {
      done();
      if (generation === this.generation) { this.busy = false; this.schedule(); }
    }
  }

  /** The pointer follows the unclipped estimate through a One Euro filter, clamped to the window. */
  private smooth(frame: GazeFrame, v: Viewport): GazeFrame {
    if (!frame.point || !frame.rawPoint) { this.smoother.reset(); return frame; }
    const filtered = this.smoother.filter(frame.rawPoint, frame.at, v.width);
    return { ...frame, point: { x: Math.min(v.width, Math.max(0, filtered.x)), y: Math.min(v.height, Math.max(0, filtered.y)) } };
  }

  /** Label the frame captured at `at` with the screen point `norm` (centred: -0.5..0.5 on each axis). */
  async collect(norm: readonly [number, number], at: number): Promise<boolean> {
    if (!this.client || this.training || at !== this.latestAt || performance.now() - at > COLLECT_WINDOW_MS) return false;
    return (await this.client.call('collect', { at, x: norm[0], y: norm[1] })) === true;
  }

  async train(): Promise<TrainingReport | null> {
    await this.withLoopStopped((client) => client.call('train', null, [], 180000));
    const report = await this.client?.call('trainingReport');
    return report && typeof report === 'object' ? (report as TrainingReport) : null;
  }

  async exportCalibration(): Promise<LearnedCalibration | null> {
    try { return readLearnedCalibration(await this.withLoopStopped((client) => client.call('exportCalibration'))); }
    catch { return null; }
  }

  async restore(learned: LearnedCalibration): Promise<boolean> {
    return (await this.withLoopStopped((client) => client.call('restoreCalibration', learned))) === true;
  }

  /** Runs a model command with the frame loop stopped, so no frame is in flight meanwhile. */
  private async withLoopStopped<T>(work: (client: WorkerClient) => Promise<T>): Promise<T> {
    const client = this.client;
    if (!client || this.training) throw new Error('Tracker is unavailable');
    const generation = this.generation;
    this.training = true;
    this.scheduled?.();
    this.scheduled = null;
    try {
      await this.idle;
      if (generation !== this.generation) throw new Error('Operation cancelled');
      return await work(client);
    } finally {
      if (generation === this.generation) { this.training = false; this.schedule(); }
    }
  }

  running(): boolean { return this.video !== null; }

  geometry(): CameraGeometry | null {
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    return s?.width && s.height ? { width: s.width, height: s.height, deviceId: s.deviceId ?? '', facingMode: s.facingMode ?? '' } : null;
  }

  stop(): void {
    ++this.generation;
    this.scheduled?.();
    this.scheduled = null;
    this.client?.stop();
    this.client = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null; }
    this.canvas = null;
    this.busy = false;
    this.training = false;
    this.latestAt = -Infinity;
    resetFace();
  }
}
