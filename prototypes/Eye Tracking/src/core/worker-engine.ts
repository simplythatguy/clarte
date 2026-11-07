import { STALE_MS } from './dwell';
import type { EyeState, WorkerGaze } from './tracking';
import { readLearnedCalibration, type LearnedCalibration } from './saved-calibration';
import { headPoseFromLandmarks } from './head-position';
export type Observation = {
  eyePatch: ImageData; headVector: number[]; faceOrigin3D: number[]; gazeState: 'open' | 'closed'; eyeState: EyeState;
  normPog: number[]; rawNormPog: number[] | null; facialLandmarks: { x: number; y: number; z: number }[];
  /** MediaPipe face transformation matrix (4×4, row-major), when the tracker provides it. */
  faceRt?: { rows: number; columns: number; data: number[] };
};
export type TrackerCore = {
  step(frame: ImageData, timestamp: number): Promise<Observation>;
  adapt(eyes: ImageData[], heads: number[][], origins: number[][], labels: number[][]): Promise<void>;
  dispose(): void;
  exportCalibration?(): LearnedCalibration;
  restoreCalibration?(state: LearnedCalibration): void;
};
type Sample = { eye: ImageData; head: number[]; origin: number[]; label: number[] };
/** One development replay record: the estimator's exact inputs for one instructed frame, plus what it predicted. */
export type ReplayEntry = {
  at: number; kind: 'calibration' | 'check'; label: number[]; headVector: number[]; faceOrigin3D: number[];
  normPog: number[]; rawNormPog: number[] | null; faceRt: number[] | null; landmarks: number[]; frame: { width: number; height: number };
};
export type ReplayExport = { entries: ReplayEntry[]; images: Blob[] };
export type ImageEncoder = (image: ImageData) => Promise<Blob>;
export const REPLAY_LIMIT = 600;
const finite3 = (v: number[]) => v.length === 3 && v.every(Number.isFinite);
export function validObservation(o: Observation): boolean {
  return o.gazeState === 'open' && o.eyeState === 'open' && o.facialLandmarks.length >= 478 &&
    o.facialLandmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite)) &&
    finite3(o.headVector) && finite3(o.faceOrigin3D) && o.faceOrigin3D[2] > 0 &&
    o.eyePatch.width === 512 && o.eyePatch.height === 128 && o.eyePatch.data.length === 512 * 128 * 4 &&
    o.normPog.length === 2 && o.normPog.every(Number.isFinite);
}
/** Lossless PNG through a worker canvas; tests inject their own encoder. */
export const canvasPng: ImageEncoder = async image => {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Replay canvas unavailable');
  context.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
};
/**
 * Raw observations never leave the worker. Labels come only from an explicit target.
 * Development replay recording is off unless enabled, keeps only instructed frames (never free
 * viewing), is bounded, lives in worker memory and leaves only through an explicit export.
 */
export class CalibrationEngine {
  private latest: { observation: Observation; at: number; capturedEpoch: number } | null = null;
  private samples: Sample[] = [];
  private lastAt = -Infinity;
  private recording = false;
  private replay: { entry: ReplayEntry; image: Blob }[] = [];
  state: 'idle' | 'inference' | 'training' | 'trained' | 'disposed' | 'error' = 'idle';
  constructor(private readonly tracker: TrackerCore, private readonly now = () => performance.timeOrigin + performance.now(), private readonly encode: ImageEncoder = canvasPng) {}
  private disposed(): boolean { return this.state === 'disposed'; }
  get count() { return this.samples.length; }
  get replayCount() { return this.replay.length; }
  async step(frame: ImageData, at: number, capturedEpoch: number): Promise<WorkerGaze> {
    if (this.state !== 'idle' && this.state !== 'trained') throw new Error('Tracker is busy');
    if (!Number.isFinite(at) || at <= this.lastAt || !Number.isFinite(capturedEpoch)) throw new Error('Repeated camera frame');
    const previous = this.state;
    this.state = 'inference'; this.lastAt = at; this.latest = null;
    try {
      const observation = await this.tracker.step(frame, at);
      if (this.disposed()) throw new Error('Tracker stopped');
      const valid = validObservation(observation);
      // A trained estimator keeps no raw frame, except while a development replay is being recorded.
      if (valid && (previous !== 'trained' || this.recording)) this.latest = { observation, at, capturedEpoch };
      this.state = previous;
      const raw = observation.rawNormPog;
      const facePresent = observation.facialLandmarks.length >= 478 && observation.facialLandmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite));
      const pose = facePresent ? headPoseFromLandmarks(observation.facialLandmarks, frame) : null;
      return { normPog: valid ? observation.normPog : [0, 0], rawNormPog: valid && raw?.length === 2 && raw.every(Number.isFinite) ? raw : null, face: valid, open: valid, facePresent, eyeState: facePresent ? observation.eyeState : 'unknown', at, pose };
    } catch (error) { if (!this.disposed()) this.state = 'error'; throw error; }
  }
  collect(at: number, x: number, y: number): boolean {
    const latest = this.latest;
    if (this.state !== 'idle' || !latest || at !== latest.at || this.samples.length >= 42 ||
        ![x, y].every(n => Number.isFinite(n) && n >= -.5 && n <= .5) ||
        this.now() < latest.capturedEpoch || this.now() - latest.capturedEpoch > STALE_MS) return false;
    const o = latest.observation;
    this.samples.push({ eye: o.eyePatch, head: [...o.headVector], origin: [...o.faceOrigin3D], label: [x, y] });
    if (this.recording) void this.keep(o, at, [x, y], 'calibration');
    this.latest = null;
    return true;
  }
  async train(): Promise<number> {
    if (this.state !== 'idle' || this.samples.length < 27 || new Set(this.samples.map(s => s.label.join(','))).size < 9) throw new Error('Finish the nine instructed targets first');
    this.state = 'training'; this.latest = null;
    const count = this.samples.length;
    try {
      await this.tracker.adapt(this.samples.map(s => s.eye), this.samples.map(s => s.head), this.samples.map(s => s.origin), this.samples.map(s => s.label));
      if (this.disposed()) throw new Error('Training cancelled');
      this.state = 'trained';
      return count;
    } catch (error) { if (!this.disposed()) this.state = 'error'; throw error; }
    finally { this.samples = []; }
  }
  exportCalibration(): LearnedCalibration {
    if (this.state !== 'trained' || !this.tracker.exportCalibration) throw new Error('No trained estimator to save');
    return readLearnedCalibration(this.tracker.exportCalibration());
  }
  restoreCalibration(payload: unknown): boolean {
    if (this.state !== 'idle' || this.samples.length || !this.tracker.restoreCalibration) throw new Error('Reset before restoring calibration');
    this.tracker.restoreCalibration(readLearnedCalibration(payload));
    this.latest = null; this.state = 'trained'; return true;
  }
  /** Development only. Turning recording off discards what was recorded. */
  setRecording(enabled: boolean): void {
    this.recording = enabled;
    if (!enabled) { this.replay = []; if (this.state === 'trained') this.latest = null; }
  }
  /** Records the frame an instructed check reference was measured on; the label is the reference position. */
  async record(at: number, x: number, y: number): Promise<boolean> {
    const latest = this.latest;
    if (!this.recording || this.state !== 'trained' || !latest || at !== latest.at || ![x, y].every(n => Number.isFinite(n) && n >= -.5 && n <= .5)) return false;
    this.latest = null;
    return this.keep(latest.observation, at, [x, y], 'check');
  }
  private async keep(o: Observation, at: number, label: number[], kind: ReplayEntry['kind']): Promise<boolean> {
    if (this.replay.length >= REPLAY_LIMIT) return false;
    const entry: ReplayEntry = {
      at, kind, label, headVector: [...o.headVector], faceOrigin3D: [...o.faceOrigin3D], normPog: [...o.normPog], rawNormPog: o.rawNormPog ? [...o.rawNormPog] : null,
      faceRt: o.faceRt && o.faceRt.data.length === 16 && o.faceRt.data.every(Number.isFinite) ? [...o.faceRt.data] : null,
      landmarks: o.facialLandmarks.flatMap(p => [p.x, p.y, p.z]).map(v => Math.round(v * 1e5) / 1e5),
      frame: { width: o.eyePatch.width, height: o.eyePatch.height },
    };
    const image = await this.encode(o.eyePatch);
    if (!this.recording || this.disposed() || this.replay.length >= REPLAY_LIMIT) return false;
    this.replay.push({ entry, image });
    return true;
  }
  exportReplay(): ReplayExport {
    return { entries: this.replay.map(r => r.entry), images: this.replay.map(r => r.image) };
  }
  dispose(): void { this.state = 'disposed'; this.latest = null; this.samples = []; this.replay = []; this.tracker.dispose(); }
}
