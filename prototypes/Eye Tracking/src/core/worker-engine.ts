import { STALE_MS } from './dwell';
import type { EyeState, WorkerGaze } from './tracking';
import { readLearnedCalibration, type LearnedCalibration } from './saved-calibration';
export type Observation = {
  eyePatch: ImageData; headVector: number[]; faceOrigin3D: number[]; gazeState: 'open' | 'closed'; eyeState: EyeState;
  normPog: number[]; rawNormPog: number[] | null; facialLandmarks: { x: number; y: number; z: number }[];
};
export type TrackerCore = {
  step(frame: ImageData, timestamp: number): Promise<Observation>;
  adapt(eyes: ImageData[], heads: number[][], origins: number[][], labels: number[][]): Promise<void>;
  dispose(): void;
  exportCalibration?(): LearnedCalibration;
  restoreCalibration?(state: LearnedCalibration): void;
};
type Sample = { eye: ImageData; head: number[]; origin: number[]; label: number[] };
const finite3 = (v: number[]) => v.length === 3 && v.every(Number.isFinite);
export function validObservation(o: Observation): boolean {
  return o.gazeState === 'open' && o.eyeState === 'open' && o.facialLandmarks.length >= 478 &&
    o.facialLandmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite)) &&
    finite3(o.headVector) && finite3(o.faceOrigin3D) && o.faceOrigin3D[2] > 0 &&
    o.eyePatch.width === 512 && o.eyePatch.height === 128 && o.eyePatch.data.length === 512 * 128 * 4 &&
    o.normPog.length === 2 && o.normPog.every(Number.isFinite);
}
/** Raw observations never leave the worker. Labels come only from an explicit target. */
export class CalibrationEngine {
  private latest: { observation: Observation; at: number; capturedEpoch: number } | null = null;
  private samples: Sample[] = [];
  private lastAt = -Infinity;
  state: 'idle' | 'inference' | 'training' | 'trained' | 'disposed' | 'error' = 'idle';
  constructor(private readonly tracker: TrackerCore, private readonly now = () => performance.timeOrigin + performance.now()) {}
  private disposed(): boolean { return this.state === 'disposed'; }
  get count() { return this.samples.length; }
  async step(frame: ImageData, at: number, capturedEpoch: number): Promise<WorkerGaze> {
    if (this.state !== 'idle' && this.state !== 'trained') throw new Error('Tracker is busy');
    if (!Number.isFinite(at) || at <= this.lastAt || !Number.isFinite(capturedEpoch)) throw new Error('Repeated camera frame');
    const previous = this.state;
    this.state = 'inference'; this.lastAt = at; this.latest = null;
    try {
      const observation = await this.tracker.step(frame, at);
      if (this.disposed()) throw new Error('Tracker stopped');
      const valid = validObservation(observation);
      if (valid && previous !== 'trained') this.latest = { observation, at, capturedEpoch };
      this.state = previous;
      const raw = observation.rawNormPog;
      const facePresent = observation.facialLandmarks.length >= 478 && observation.facialLandmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite));
      return { normPog: valid ? observation.normPog : [0, 0], rawNormPog: valid && raw?.length === 2 && raw.every(Number.isFinite) ? raw : null, face: valid, open: valid, facePresent, eyeState: facePresent ? observation.eyeState : 'unknown', at };
    } catch (error) { if (!this.disposed()) this.state = 'error'; throw error; }
  }
  collect(at: number, x: number, y: number): boolean {
    const latest = this.latest;
    if (this.state !== 'idle' || !latest || at !== latest.at || this.samples.length >= 42 ||
        ![x, y].every(n => Number.isFinite(n) && n >= -.5 && n <= .5) ||
        this.now() < latest.capturedEpoch || this.now() - latest.capturedEpoch > STALE_MS) return false;
    const o = latest.observation;
    this.samples.push({ eye: o.eyePatch, head: [...o.headVector], origin: [...o.faceOrigin3D], label: [x, y] });
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
  dispose(): void { this.state = 'disposed'; this.latest = null; this.samples = []; this.tracker.dispose(); }
}
