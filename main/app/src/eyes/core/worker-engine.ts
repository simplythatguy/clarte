import { STALE_MS } from './dwell';
import type { EyeState, WorkerGaze } from './tracking';
import { readLearnedCalibration, type LearnedCalibration } from './saved-calibration';
import { headPoseFromLandmarks } from './head-position';
import { readTrainingOptions, type TrainingOptions, type TrainingReport } from './training';
import { blend, blendWeight, boundWeight, featureVector, fitGeometric, gazeFeatures, predictGeometric, type GazeFeatures, type GeometricState } from './geometric-gaze';
import type { Estimates } from './tracking';
import { CameraMotionDetector, faceBox, type CameraMotion } from './camera-motion';
export type Observation = {
  eyePatch: ImageData; headVector: number[]; faceOrigin3D: number[]; gazeState: 'open' | 'closed'; eyeState: EyeState;
  normPog: number[]; rawNormPog: number[] | null; facialLandmarks: { x: number; y: number; z: number }[];
  /** MediaPipe face transformation matrix (4×4, row-major), when the tracker provides it. */
  faceRt?: { rows: number; columns: number; data: number[] };
  /** gaze-lab: per-stage timings the tracker reports (ms), passed through in debug mode. */
  durations?: Record<string, number>;
};
/** gaze-lab debug payload: the estimator's exact inputs for this frame, alongside the unchanged shipped outputs. */
export type DebugStep = {
  headVector: number[]; faceOrigin3D: number[]; faceRt: number[] | null;
  /** 478 × 3 normalized landmarks, flat, rounded to 1e-5. */
  landmarks: number[];
  features: GazeFeatures | null; featureVector: number[] | null;
  timings: Record<string, number>;
};
export type TrackerCore = {
  step(frame: ImageData, timestamp: number): Promise<Observation>;
  adapt(eyes: ImageData[], heads: number[][], origins: number[][], labels: number[][], options?: TrainingOptions): Promise<void>;
  dispose(): void;
  /** Outcome of the last adapt(), when the tracker reports one. */
  lastTraining?: TrainingReport | null;
  exportCalibration?(): LearnedCalibration;
  restoreCalibration?(state: LearnedCalibration): void;
  setBaseEstimator?(weights: number[][]): void;
};
type Sample = { eye: ImageData; head: number[]; origin: number[]; label: number[]; features: GazeFeatures | null };
/** One development replay record: the estimator's exact inputs for one instructed frame, plus what it predicted. */
export type ReplayEntry = {
  at: number; kind: 'calibration' | 'check'; label: number[]; headVector: number[]; faceOrigin3D: number[];
  normPog: number[]; rawNormPog: number[] | null; faceRt: number[] | null; landmarks: number[]; frame: { width: number; height: number };
};
export type ReplayExport = { entries: ReplayEntry[]; images: Blob[] };
/** gaze-lab: collect()/train() bounds. The shipped constants are 42 samples at most, training on ≥ 27 samples over ≥ 9 distinct targets. */
export type EngineLimits = { maxSamples: number; minSamples: number; minTargets: number };
export const SHIPPED_LIMITS: EngineLimits = { maxSamples: 42, minSamples: 27, minTargets: 9 };
/** Positive integers per field, anything else the shipped value; maxSamples is never below minSamples. */
export function readLimits(v: unknown): EngineLimits {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof EngineLimits, unknown>>;
  const int = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : fallback);
  const minSamples = int(o.minSamples, SHIPPED_LIMITS.minSamples);
  return { maxSamples: Math.max(minSamples, int(o.maxSamples, SHIPPED_LIMITS.maxSamples)), minSamples, minTargets: int(o.minTargets, SHIPPED_LIMITS.minTargets) };
}
export type ImageEncoder = (image: ImageData) => Promise<Blob>;
export const REPLAY_LIMIT = 4000; // gaze-lab: was 600; eye strips are exported per block.
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
  private latest: { observation: Observation; at: number; capturedEpoch: number; features: GazeFeatures | null } | null = null;
  private samples: Sample[] = [];
  /** The fitted geometric (iris and lid) estimator and its blend weight; null until a calibration fits one. */
  private geometric: GeometricState | null = null;
  private geometricReport: NonNullable<TrainingReport['geometric']> | null = null;
  /** Lid-tilt / camera-move detection on the coarse background; runs on every other frame. */
  private readonly motion = new CameraMotionDetector();
  private motionFrames = 0;
  private lastAt = -Infinity;
  /** gaze-lab: collect()/train() bounds; the defaults are the shipped constants (see SHIPPED_LIMITS). */
  private limits: EngineLimits = { ...SHIPPED_LIMITS };
  /** gaze-lab: upper bound on the geometric share of the blend; the default is the shipped weightRange top (boundWeight(1) = 0.85). */
  private geometricShareMax = boundWeight(1);
  private recording = false;
  /** gaze-lab: when on, step() also returns the DebugStep inputs. Shipped math is unchanged. */
  private debug = false;
  private replay: { entry: ReplayEntry; image: Blob }[] = [];
  state: 'idle' | 'inference' | 'training' | 'trained' | 'disposed' | 'error' = 'idle';
  constructor(private readonly tracker: TrackerCore, private readonly now = () => performance.timeOrigin + performance.now(), private readonly encode: ImageEncoder = canvasPng) {}
  private disposed(): boolean { return this.state === 'disposed'; }
  get count() { return this.samples.length; }
  get replayCount() { return this.replay.length; }
  /** gaze-lab: only before any label is collected; invalid fields keep the shipped values. */
  setLimits(limits: unknown): EngineLimits { if (this.samples.length) throw new Error('Set limits before collecting'); this.limits = readLimits(limits); return { ...this.limits }; }
  /** gaze-lab: caps the geometric share from blendWeight() and setBlend(); invalid or out of range keeps the shipped top. */
  setGeometricShareMax(max: unknown): number { this.geometricShareMax = typeof max === 'number' && Number.isFinite(max) && max >= 0 ? boundWeight(max) : boundWeight(1); return this.geometricShareMax; }
  setDebug(enabled: boolean): void { this.debug = enabled; }
  async step(frame: ImageData, at: number, capturedEpoch: number): Promise<WorkerGaze & { debug?: DebugStep }> {
    const started = performance.now();
    if (this.state !== 'idle' && this.state !== 'trained') throw new Error('Tracker is busy');
    if (!Number.isFinite(at) || at <= this.lastAt || !Number.isFinite(capturedEpoch)) throw new Error('Repeated camera frame');
    const previous = this.state;
    this.state = 'inference'; this.lastAt = at; this.latest = null;
    try {
      const observation = await this.tracker.step(frame, at);
      const trackerDone = performance.now();
      if (this.disposed()) throw new Error('Tracker stopped');
      const valid = validObservation(observation);
      // Geometric features come from the landmarks of this frame only; nothing is kept with them.
      const features = valid ? gazeFeatures({ landmarks: observation.facialLandmarks, faceRt: observation.faceRt?.data.length === 16 ? observation.faceRt.data : null, origin: observation.faceOrigin3D, frame: { width: frame.width, height: frame.height } }) : null;
      // A trained estimator keeps no raw frame, except while a development replay is being recorded.
      if (valid && (previous !== 'trained' || this.recording)) this.latest = { observation, at, capturedEpoch, features };
      this.state = previous;
      const raw = observation.rawNormPog;
      const facePresent = observation.facialLandmarks.length >= 478 && observation.facialLandmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite));
      const pose = facePresent ? headPoseFromLandmarks(observation.facialLandmarks, frame) : null;
      const camera: CameraMotion | null = ++this.motionFrames % 2 === 0 ? this.motion.observe(frame, facePresent ? faceBox(observation.facialLandmarks, frame) : null, at) : null;
      const network = valid && raw?.length === 2 && raw.every(Number.isFinite) ? [raw[0], raw[1]] : null;
      // Trained: blend the network's estimate with the geometric one; the pointer, the check and selection all follow the blend.
      const geometric = previous === 'trained' && this.geometric ? predictGeometric({ weights: this.geometric.weights, samples: 0, targets: 0, outliers: 0, heldOutMse: null, residual: 0 }, features) : null;
      const fused = previous === 'trained' && this.geometric && network && geometric ? blend(network, geometric, this.geometric.weight) : network;
      const clip = (v: number) => Math.max(-.5, Math.min(.5, v));
      const estimates: Estimates<number[]> | null = valid ? { network, geometric } : null;
      const result: WorkerGaze & { debug?: DebugStep } = { normPog: valid ? (fused && fused !== network ? [clip(fused[0]), clip(fused[1])] : observation.normPog) : [0, 0], rawNormPog: fused, face: valid, open: valid, facePresent, eyeState: facePresent ? observation.eyeState : 'unknown', at, pose, estimates, camera };
      if (this.debug) {
        const rt = observation.faceRt && observation.faceRt.data.length === 16 && observation.faceRt.data.every(Number.isFinite) ? [...observation.faceRt.data] : null;
        result.debug = {
          headVector: [...observation.headVector], faceOrigin3D: [...observation.faceOrigin3D], faceRt: rt,
          landmarks: facePresent ? observation.facialLandmarks.flatMap(p => [p.x, p.y, p.z]).map(v => Math.round(v * 1e5) / 1e5) : [],
          features, featureVector: features ? featureVector(features) : null,
          timings: { ...(observation.durations ?? {}), tracker: trackerDone - started, engine: performance.now() - trackerDone, total: performance.now() - started },
        };
      }
      return result;
    } catch (error) { if (!this.disposed()) this.state = 'error'; throw error; }
  }
  collect(at: number, x: number, y: number): boolean {
    const latest = this.latest;
    if (this.state !== 'idle' || !latest || at !== latest.at || this.samples.length >= this.limits.maxSamples ||
        ![x, y].every(n => Number.isFinite(n) && n >= -.5 && n <= .5) ||
        this.now() < latest.capturedEpoch || this.now() - latest.capturedEpoch > STALE_MS) return false;
    const o = latest.observation;
    this.samples.push({ eye: o.eyePatch, head: [...o.headVector], origin: [...o.faceOrigin3D], label: [x, y], features: latest.features });
    if (this.recording) void this.keep(o, at, [x, y], 'calibration');
    this.latest = null;
    return true;
  }
  /** `options` bound how far the gaze head adapts; anything invalid falls back to the defaults. */
  async train(options?: unknown): Promise<number> {
    if (this.state !== 'idle' || this.samples.length < this.limits.minSamples || new Set(this.samples.map(s => s.label.join(','))).size < this.limits.minTargets) throw new Error(this.limits.minTargets === SHIPPED_LIMITS.minTargets ? 'Finish the nine instructed targets first' : `Finish the ${this.limits.minTargets} instructed targets first`);
    this.state = 'training'; this.latest = null;
    const count = this.samples.length;
    try {
      await this.tracker.adapt(this.samples.map(s => s.eye), this.samples.map(s => s.head), this.samples.map(s => s.origin), this.samples.map(s => s.label), readTrainingOptions(options));
      if (this.disposed()) throw new Error('Training cancelled');
      this.fitGeometric();
      this.state = 'trained';
      return count;
    } catch (error) { if (!this.disposed()) this.state = 'error'; throw error; }
    finally { this.samples = []; }
  }
  /** Fits the geometric estimator on the same labelled frames and weights it against the network by held-out error. */
  private fitGeometric(): void {
    const fit = fitGeometric(this.samples.flatMap(s => (s.features ? [{ features: s.features, label: [s.label[0], s.label[1]] as [number, number] }] : [])));
    const network = this.tracker.lastTraining?.heldOutAfter;
    const weight = fit ? Math.min(this.geometricShareMax, blendWeight(fit.heldOutMse, typeof network === 'number' && Number.isFinite(network) ? network : null)) : 0;
    this.geometric = fit ? { weights: fit.weights, heldOutMse: fit.heldOutMse, weight, samples: fit.samples, targets: fit.targets } : null;
    this.geometricReport = fit ? { samples: fit.samples, targets: fit.targets, outliers: fit.outliers, heldOutMse: fit.heldOutMse, weight } : null;
  }
  trainingReport(): TrainingReport | null {
    const report = this.tracker.lastTraining;
    return report ? { ...report, geometric: this.geometricReport } : null;
  }
  /** The geometric estimator's share of the blend, from a measured check; bounded. */
  setBlend(weight: unknown): number {
    if (this.state !== 'trained' || !this.geometric) throw new Error('No calibrated estimators to blend');
    this.geometric = { ...this.geometric, weight: Math.min(this.geometricShareMax, boundWeight(weight)) };
    if (this.geometricReport) this.geometricReport = { ...this.geometricReport, weight: this.geometric.weight };
    return this.geometric.weight;
  }
  exportCalibration(): LearnedCalibration {
    if (this.state !== 'trained' || !this.tracker.exportCalibration) throw new Error('No trained estimator to save');
    return readLearnedCalibration({ ...this.tracker.exportCalibration(), geometric: this.geometric });
  }
  restoreCalibration(payload: unknown): boolean {
    if (this.state !== 'idle' || this.samples.length || !this.tracker.restoreCalibration) throw new Error('Reset before restoring calibration');
    const learned = readLearnedCalibration(payload);
    this.tracker.restoreCalibration({ weights: learned.weights, affine: learned.affine, faceWidthCm: learned.faceWidthCm });
    this.geometric = learned.geometric ?? null;
    this.geometricReport = null;
    this.latest = null; this.state = 'trained'; return true;
  }
  /** Starts calibration from a shared estimator (a team model); only before any label is collected. */
  setBaseEstimator(weights: unknown): boolean {
    if (this.state !== 'idle' || this.samples.length || !this.tracker.setBaseEstimator) throw new Error('Choose the starting model before calibrating');
    // Reuse the saved-calibration validator for the six estimator tensors.
    const learned = readLearnedCalibration({ weights, affine: [1, 0, 0, 0, 1, 0], faceWidthCm: 1 });
    this.tracker.setBaseEstimator(learned.weights);
    this.latest = null;
    return true;
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
  dispose(): void { this.state = 'disposed'; this.latest = null; this.samples = []; this.replay = []; this.geometric = null; this.motion.reset(); this.tracker.dispose(); }
}
