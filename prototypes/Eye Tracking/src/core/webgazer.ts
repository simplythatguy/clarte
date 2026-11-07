import { readHeadPose, type HeadPose } from './head-position';

export type GazeFrame = { point: { x: number; y: number } | null; face: boolean; at: number; pose: HeadPose | null };
export type WebGazerRuntime = {
  beginWithStream(stream: MediaStream): Promise<unknown>;
  end(): Promise<unknown>;
  clearData(): Promise<void>;
  setCalibrationEnabled(enabled: boolean): void;
  recordCalibrationPoint(x: number, y: number): boolean;
  getTrackingStatus(): { faceDetected: boolean; frameTime: number; headPose: unknown };
  setGazeListener(listener: (data: unknown) => void): unknown;
  clearGazeListener(): unknown;
  setErrorListener(listener: (error: unknown) => void): void;
  showVideo(value: boolean): unknown;
};

declare global {
  interface Window { WebGazerLocal?: { default: WebGazerRuntime } }
}

let loadPromise: Promise<WebGazerRuntime> | undefined;
export function loadWebGazer(): Promise<WebGazerRuntime> {
  loadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/webgazer.js';
    script.onload = () => {
      if (window.WebGazerLocal?.default) resolve(window.WebGazerLocal.default);
      else reject(new Error('The local WebGazer bundle could not be loaded.'));
    };
    script.onerror = () => { script.remove(); loadPromise = undefined; reject(new Error('The local tracking files could not be loaded. Restart the local server, then try again.')); };
    document.head.append(script);
  });
  return loadPromise;
}

function readPoint(value: unknown): GazeFrame['point'] {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) return null;
  if (typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

export function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError': return 'Camera access was blocked. Allow the camera for localhost in your browser settings, then try again.';
      case 'NotFoundError': return 'No camera was found. Connect a camera, or try simulation.';
      case 'NotReadableError': return 'The camera is unavailable. Close other apps using it, then try again.';
      case 'OverconstrainedError': return 'This camera cannot use the requested video settings. Try another camera or simulation.';
      case 'SecurityError': return 'Camera access requires localhost or a secure page. Open the localhost URL from the README.';
    }
  }
  return 'Tracking could not start or was interrupted. Check camera access and WebGL support, then retry. Simulation is also available.';
}

type Dependencies = { load: () => Promise<WebGazerRuntime>; acquire: () => Promise<MediaStream> };

/** Owns camera leases; a permission prompt completing after stop can never attach a stream. */
export class CameraSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private runtime: WebGazerRuntime | null = null;
  private cleanup: Promise<unknown> = Promise.resolve();
  constructor(private readonly dependencies: Dependencies) {}

  async start(onFrame: (frame: GazeFrame) => void, onFailure: (error: unknown) => void): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    await this.cleanup;
    if (generation !== this.generation) return false;
    const runtime = await this.dependencies.load();
    if (generation !== this.generation) return false;
    const stream = await this.dependencies.acquire();
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    this.stream = stream;
    this.runtime = runtime;
    runtime.showVideo(false);
    runtime.setCalibrationEnabled(false);
    runtime.setGazeListener(data => {
      if (generation !== this.generation) return;
      const status = runtime.getTrackingStatus();
      onFrame({ point: readPoint(data), face: status.faceDetected, at: status.frameTime, pose: status.faceDetected ? readHeadPose(status.headPose) : null });
    });
    runtime.setErrorListener(error => { if (generation === this.generation) onFailure(error); });
    stream.getTracks().forEach(track => track.addEventListener('ended', () => {
      if (generation === this.generation) onFailure(new Error('Camera track ended'));
    }, { once: true }));
    try {
      await runtime.beginWithStream(stream);
      return generation === this.generation;
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      if (generation !== this.generation) return false;
      this.stop();
      throw error;
    }
  }

  stop(): void {
    ++this.generation;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime) {
      runtime.setCalibrationEnabled(false);
      runtime.clearGazeListener();
      this.cleanup = runtime.end().then(() => runtime.clearData());
    }
  }

  calibrate(point: { x: number; y: number }): boolean {
    if (!this.runtime) return false;
    this.runtime.setCalibrationEnabled(true);
    try { return this.runtime.recordCalibrationPoint(point.x, point.y); }
    finally { this.runtime.setCalibrationEnabled(false); }
  }

  resetCalibration(): void { void this.runtime?.clearData(); }
  preview(show: boolean): void { this.runtime?.showVideo(show); }
}

export function createCameraSession(): CameraSession {
  return new CameraSession({
    load: loadWebGazer,
    acquire: () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API unavailable', 'SecurityError');
      return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    },
  });
}
