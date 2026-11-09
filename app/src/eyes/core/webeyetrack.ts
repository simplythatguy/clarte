import type { GazeFrame, Point, Viewport } from './tracking';
import { normalizeGaze, readWorkerGaze } from './tracking';
import { WorkerClient } from './worker-client';
import { readLearnedCalibration, type CameraGeometry, type LearnedCalibration } from './saved-calibration';
import type { ReplayExport } from './worker-engine';
import { OneEuroPoint } from './one-euro';
import type { TrainingOptions, TrainingReport } from './training';
export type { GazeFrame } from './tracking';
export type TrackerRuntime = {
  begin(stream: MediaStream, onFrame: (frame: GazeFrame) => void | Promise<void>, onFailure: (error: unknown) => void): Promise<void>;
  stop(): void;
  collect(point: Point, at: number, viewport: Viewport): Promise<boolean>;
  train(options?: Partial<TrainingOptions>): Promise<void>;
  trainingReport?(): Promise<TrainingReport | null>;
  /** The geometric estimator's share of the blended estimate, chosen by a measured check; resolves to the bounded weight applied. */
  setBlend?(weight: number): Promise<number>;
  reset(): Promise<void>;
  exportCalibration(): Promise<LearnedCalibration>;
  restoreCalibration(state: LearnedCalibration): Promise<void>;
  preview(show: boolean): void;
  /** Starting estimator for the next calibration (null: the pretrained one); applied whenever the tracker initializes. */
  setBaseEstimator?(weights: number[][] | null): void;
  /** Take eye strips from a pose-normalized view; applied whenever the tracker initializes (development comparison). */
  setNormalizedCrop?(enabled: boolean): void;
  /** Development replay recording; absent on runtimes that cannot record. */
  setRecording?(enabled: boolean): Promise<void>;
  record?(point: Point, at: number, viewport: Viewport): Promise<boolean>;
  exportReplay?(): Promise<ReplayExport>;
};
export function readReplayExport(v: unknown): ReplayExport {
  if (!v || typeof v !== 'object' || !('entries' in v) || !('images' in v) || !Array.isArray(v.entries) || !Array.isArray(v.images) || v.entries.length !== v.images.length || !v.images.every(i => i instanceof Blob)) throw new Error('Invalid replay export');
  return { entries: v.entries, images: v.images };
}
export function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError': return 'Camera access was blocked. Allow the camera for localhost in your browser settings, then try again.';
      case 'NotFoundError': return 'No camera was found. Connect a camera, or try simulation.';
      case 'NotReadableError': return 'The camera is unavailable. Close other apps using it, then try again.';
      case 'OverconstrainedError': return 'This camera cannot use the requested video settings. Try another camera or simulation.';
      case 'SecurityError': return 'Local WebEyeTrack needs localhost camera access and a server policy allowing its local worker. See the README.';
    }
  }
  return `Local WebEyeTrack could not run. ${error instanceof Error ? error.message : 'Check local files, camera access and WebAssembly support.'} Retry, or use simulation.`;
}
/** A distinct decoded-frame counter AND a progressing media timestamp are required. */
export class DecodedFrameGate {
  private frames = -1;
  private mediaTime = -Infinity;
  accept(frames: number, mediaTime: number): boolean {
    if (!Number.isFinite(frames) || !Number.isFinite(mediaTime) || frames <= this.frames || mediaTime <= this.mediaTime) return false;
    this.frames = frames; this.mediaTime = mediaTime; return true;
  }
}

/** 720p gives the eye-patch crop about twice the pixels of 640x480; the camera may still pick less. */
export const CAMERA = { width: 1280, height: 720 };

export class LocalWebEyeTrack implements TrackerRuntime {
  private client: WorkerClient | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private generation = 0;
  private scheduled: (() => void) | null = null;
  private frameGate = new DecodedFrameGate();
  private smoother = new OneEuroPoint();
  private base: number[][] | null = null;
  private normalizedCrop = false;
  private latestAt = -Infinity;
  private onFrame: (frame: GazeFrame) => void | Promise<void> = () => {};
  private onFailure: (error: unknown) => void = () => {};
  private busy = false;
  private training = false;
  private idle: Promise<void> = Promise.resolve();
  async begin(stream: MediaStream, onFrame: (frame: GazeFrame) => void | Promise<void>, onFailure: (error: unknown) => void): Promise<void> {
    this.onFrame = onFrame; this.onFailure = onFailure;
    const video = document.createElement('video');
    video.id = 'local-camera-preview'; video.className = 'local-camera-preview';
    video.muted = true; video.autoplay = true; video.playsInline = true; video.setAttribute('aria-label', 'Local camera preview');
    video.srcObject = stream; document.body.append(video); this.video = video;
    this.canvas = document.createElement('canvas');
    const generation = ++this.generation;
    const client = this.createClient();
    await Promise.all([client.call('init', { development: import.meta.env.DEV, normalizeCrop: this.normalizedCrop }, [], 90000), video.play()]);
    if (generation !== this.generation) return;
    if (this.base) await client.call('baseEstimator', { weights: this.base });
    if (generation !== this.generation) return;
    this.schedule();
  }
  private createClient() {
    const client = new WorkerClient(new Worker('/vendor/webeyetrack/worker.js'), error => this.onFailure(error));
    this.client = client; return client;
  }
  private schedule(): void {
    const video = this.video;
    if (!video || this.training || this.busy || this.scheduled) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback((_now, metadata) => {
        this.scheduled = null;
        void this.process(metadata.presentedFrames, metadata.mediaTime);
      });
      this.scheduled = () => video.cancelVideoFrameCallback(id);
    } else {
      const id = requestAnimationFrame(() => {
        this.scheduled = null;
        const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
        if (typeof frames !== 'number') { this.onFailure(new Error('This browser cannot verify fresh decoded video frames. Try a current browser.')); return; }
        void this.process(frames, video.currentTime);
      });
      this.scheduled = () => cancelAnimationFrame(id);
    }
  }
  private async process(frames: number, mediaTime: number): Promise<void> {
    const { video, canvas, client, generation } = this;
    if (!video || !canvas || !client || this.training || this.busy) return;
    if (video.readyState < 2 || video.paused || video.ended || !this.frameGate.accept(frames, mediaTime)) { this.schedule(); return; }
    this.busy = true;
    let done = () => {};
    this.idle = new Promise<void>(resolve => { done = resolve; });
    try {
      const width = Math.min(CAMERA.width, video.videoWidth);
      const height = Math.round(video.videoHeight * width / video.videoWidth);
      if (!width || !height) throw new Error('Camera frame has no dimensions');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas input is unavailable');
      context.drawImage(video, 0, 0, width, height);
      const at = performance.now();
      const frame = context.getImageData(0, 0, width, height);
      const output = readWorkerGaze(await client.call('step', { frame, at, epoch: performance.timeOrigin + at }, [frame.data.buffer]));
      if (generation !== this.generation) return;
      if (output.at !== at) throw new Error('Camera result does not match its captured frame');
      this.latestAt = at;
      await this.onFrame(this.smooth(normalizeGaze(output, { width: window.innerWidth, height: window.innerHeight })));
    } catch (error) { if (generation === this.generation) this.onFailure(error); }
    finally { done(); if (generation === this.generation) { this.busy = false; this.schedule(); } }
  }
  /**
   * The pointer follows the unclipped estimate through a One Euro filter instead of the tracker's
   * fixed-gain Kalman output: steadier on a fixation and quick to follow a deliberate move.
   * Held-out checks and blink selection keep using the unfiltered `rawPoint`.
   */
  private smooth(frame: GazeFrame): GazeFrame {
    if (!frame.point || !frame.rawPoint) { this.smoother.reset(); return frame; }
    const width = window.innerWidth, height = window.innerHeight;
    const filtered = this.smoother.filter(frame.rawPoint, frame.at, width);
    return { ...frame, point: { x: Math.min(width, Math.max(0, filtered.x)), y: Math.min(height, Math.max(0, filtered.y)) } };
  }
  async collect(point: Point, at: number, viewport: Viewport): Promise<boolean> {
    if (!this.client || this.training || at !== this.latestAt || performance.now() - at > 600) return false;
    return await this.client.call('collect', { at, x: point.x / viewport.width - .5, y: point.y / viewport.height - .5 }) === true;
  }
  async train(options?: Partial<TrainingOptions>): Promise<void> {
    await this.modelCommand('train', options ?? null, 180000);
  }
  async trainingReport(): Promise<TrainingReport | null> {
    if (!this.client) return null;
    const value = await this.client.call('trainingReport');
    return value && typeof value === 'object' ? value as TrainingReport : null;
  }
  setBaseEstimator(weights: number[][] | null): void { this.base = weights; }
  setNormalizedCrop(enabled: boolean): void { this.normalizedCrop = enabled; }
  async setBlend(weight: number): Promise<number> {
    const value = await this.modelCommand('blend', { weight });
    if (typeof value !== 'number') throw new Error('Blend weight was not applied');
    return value;
  }
  async setRecording(enabled: boolean): Promise<void> {
    if (!this.client) return;
    await this.client.call('recording', { enabled });
  }
  async record(point: Point, at: number, viewport: Viewport): Promise<boolean> {
    if (!this.client || this.training || at !== this.latestAt) return false;
    return await this.client.call('record', { at, x: point.x / viewport.width - .5, y: point.y / viewport.height - .5 }) === true;
  }
  async exportReplay(): Promise<ReplayExport> {
    return readReplayExport(await this.modelCommand('exportReplay', null, 60000));
  }
  private async modelCommand(type: string, payload: unknown, timeout = 20000): Promise<unknown> {
    if (!this.client || this.training) throw new Error('Tracker is unavailable for training');
    const generation = this.generation, client = this.client;
    this.training = true; this.scheduled?.(); this.scheduled = null;
    try {
      await this.idle;
      if (generation !== this.generation) throw new Error('Calibration operation cancelled');
      return await client.call(type, payload, [], timeout);
    }
    finally { if (generation === this.generation) { this.training = false; this.schedule(); } }
  }
  async exportCalibration(): Promise<LearnedCalibration> {
    return readLearnedCalibration(await this.modelCommand('exportCalibration', null));
  }
  async restoreCalibration(state: LearnedCalibration): Promise<void> {
    if (await this.modelCommand('restoreCalibration', readLearnedCalibration(state)) !== true) throw new Error('Saved calibration was not restored');
  }
  async reset(): Promise<void> {
    ++this.generation; this.scheduled?.(); this.scheduled = null; this.client?.stop();
    this.smoother.reset();
    this.busy = false; this.training = true; this.latestAt = -Infinity;
    // Keep the decoded-frame gate across a reset: an old decoded image is never new evidence.
    const generation = this.generation;
    const client = this.createClient();
    await client.call('init', { development: import.meta.env.DEV, normalizeCrop: this.normalizedCrop }, [], 90000);
    if (generation !== this.generation) return;
    if (this.base) await client.call('baseEstimator', { weights: this.base });
    if (generation !== this.generation) return;
    this.training = false; this.schedule();
  }
  preview(show: boolean) { if (this.video) this.video.classList.toggle('is-visible', show); }
  stop(): void {
    ++this.generation; this.scheduled?.(); this.scheduled = null;
    this.client?.stop(); this.client = null; this.latestAt = -Infinity;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null; }
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; this.canvas = null; }
    this.busy = false; this.training = false;
  }
}

type Dependencies = { create: () => TrackerRuntime; acquire: () => Promise<MediaStream> };
/** Owns camera permission leases and rejects late startup/reset/training completions. */
export class CameraSession {
  private generation = 0;
  private modelGeneration = 0;
  private stream: MediaStream | null = null;
  private runtime: TrackerRuntime | null = null;
  constructor(private readonly dependencies: Dependencies) {}
  async start(onFrame: (frame: GazeFrame) => void | Promise<void>, onFailure: (error: unknown) => void): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    const stream = await this.dependencies.acquire();
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream;
    const failure = (error: unknown) => { if (generation !== this.generation) return; this.stop(); onFailure(error); };
    stream.getTracks().forEach(track => track.addEventListener('ended', () => failure(new Error('Camera track ended')), { once: true }));
    try {
      const runtime = this.dependencies.create(); this.runtime = runtime;
      runtime.setBaseEstimator?.(this.base);
      runtime.setNormalizedCrop?.(this.normalizedCrop);
      await runtime.begin(stream, frame => { if (generation === this.generation) return onFrame(frame); }, failure);
      return generation === this.generation;
    } catch (error) { if (generation !== this.generation) return false; this.stop(); throw error; }
  }
  stop(): void {
    ++this.generation; ++this.modelGeneration;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.runtime?.stop(); this.runtime = null;
  }
  async collect(point: Point, at: number, viewport: Viewport): Promise<boolean> {
    const generation = this.generation;
    const accepted = await this.runtime?.collect(point, at, viewport);
    return generation === this.generation && accepted === true;
  }
  async train(options?: Partial<TrainingOptions>): Promise<boolean> {
    if (!this.runtime) return false;
    const generation = this.generation, model = ++this.modelGeneration;
    try { await this.runtime.train(options); return generation === this.generation && model === this.modelGeneration; }
    catch (error) { if (generation !== this.generation || model !== this.modelGeneration) return false; throw error; }
  }
  async resetCalibration(): Promise<boolean> {
    if (!this.runtime) return false;
    const generation = this.generation, model = ++this.modelGeneration;
    try { await this.runtime.reset(); return generation === this.generation && model === this.modelGeneration; }
    catch (error) { if (generation !== this.generation || model !== this.modelGeneration) return false; throw error; }
  }
  async exportCalibration(): Promise<LearnedCalibration | null> {
    if (!this.runtime) return null;
    const generation = this.generation, model = this.modelGeneration;
    try { const value = await this.runtime.exportCalibration(); return generation === this.generation && model === this.modelGeneration ? value : null; }
    catch (error) { if (generation !== this.generation || model !== this.modelGeneration) return null; throw error; }
  }
  async restoreCalibration(state: LearnedCalibration): Promise<boolean> {
    if (!this.runtime) return false;
    const generation = this.generation, model = ++this.modelGeneration;
    try { await this.runtime.restoreCalibration(state); return generation === this.generation && model === this.modelGeneration; }
    catch (error) { if (generation !== this.generation || model !== this.modelGeneration) return false; throw error; }
  }
  private base: number[][] | null = null;
  /** Takes effect from the next camera start or recalibration. */
  setBaseEstimator(weights: number[][] | null): void { this.base = weights; this.runtime?.setBaseEstimator?.(weights); }
  private normalizedCrop = false;
  /** Development comparison: eye strips from a pose-normalized view, from the next camera start or recalibration. */
  setNormalizedCrop(enabled: boolean): void { this.normalizedCrop = enabled; this.runtime?.setNormalizedCrop?.(enabled); }
  async setRecording(enabled: boolean): Promise<void> { await this.runtime?.setRecording?.(enabled); }
  async record(point: Point, at: number, viewport: Viewport): Promise<boolean> {
    const generation = this.generation;
    const kept = await this.runtime?.record?.(point, at, viewport);
    return generation === this.generation && kept === true;
  }
  async exportReplay(): Promise<ReplayExport | null> {
    if (!this.runtime?.exportReplay) return null;
    const generation = this.generation;
    const value = await this.runtime.exportReplay();
    return generation === this.generation ? value : null;
  }
  async trainingReport(): Promise<TrainingReport | null> { return (await this.runtime?.trainingReport?.()) ?? null; }
  /** Applies a check-chosen blend weight; false when the runtime changed meanwhile or cannot blend. */
  async setBlend(weight: number): Promise<number | null> {
    if (!this.runtime?.setBlend) return null;
    const generation = this.generation, model = this.modelGeneration;
    try { const applied = await this.runtime.setBlend(weight); return generation === this.generation && model === this.modelGeneration ? applied : null; }
    catch (error) { if (generation !== this.generation || model !== this.modelGeneration) return null; throw error; }
  }
  /** The live camera stream, for development test-session recording only. */
  mediaStream(): MediaStream | null { return this.stream; }
  geometry(): CameraGeometry | null {
    const settings = this.stream?.getTracks().find(track => track.kind === 'video')?.getSettings();
    return settings?.width && settings.height ? { width: settings.width, height: settings.height, deviceId: settings.deviceId ?? '', facingMode: settings.facingMode ?? '' } : null;
  }
  preview(show: boolean): void { this.runtime?.preview(show); }
}
export function createCameraSession(): CameraSession {
  return new CameraSession({
    create: () => new LocalWebEyeTrack(),
    acquire: () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API unavailable', 'SecurityError');
      return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, facingMode: 'user' }, audio: false });
    },
  });
}
