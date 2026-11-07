import type { Viewport } from './tracking';

// Only the six adapted MLP tensors are saved; the pinned encoder stays in local assets.
export const ESTIMATOR_SHAPES = [[518, 16], [16], [16, 16], [16], [16, 2], [2]];
export const MODEL_VERSION = '75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c:0.0.2:local-estimator-v1';
export const SAVED_CALIBRATION_KEY = 'still.local-calibration.v1';
export const MAX_SAVED_BYTES = 512_000;
export type LearnedCalibration = { weights: number[][]; affine: number[]; faceWidthCm: number };
export type CameraGeometry = { deviceId: string; width: number; height: number; facingMode: string };
export type CalibrationGeometry = { viewport: Viewport; camera: CameraGeometry; pixelRatio: number };
export type SavedCalibration = { schema: 1; model: string; savedAt: number; geometry: CalibrationGeometry; learned: LearnedCalibration };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(n => n in v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const vector = (v: unknown, size: number): v is number[] => Array.isArray(v) && v.length === size && v.every(n => finite(n, -1e6, 1e6));
export function readLearnedCalibration(v: unknown): LearnedCalibration {
  if (!object(v) || !keys(v, ['weights', 'affine', 'faceWidthCm']) || !Array.isArray(v.weights) || v.weights.length !== ESTIMATOR_SHAPES.length ||
      !v.weights.every((w, i) => vector(w, ESTIMATOR_SHAPES[i].reduce((a, b) => a * b, 1))) || !vector(v.affine, 6) || !finite(v.faceWidthCm, .001, 1000)) throw new Error('Saved calibration has invalid estimator data. Recalibrate or delete it.');
  return { weights: v.weights, affine: v.affine, faceWidthCm: v.faceWidthCm };
}
export function readSavedCalibration(v: unknown): SavedCalibration {
  if (!object(v) || !keys(v, ['schema', 'model', 'savedAt', 'geometry', 'learned']) || v.schema !== 1 || v.model !== MODEL_VERSION || !finite(v.savedAt, 1, 1e15)) throw new Error('Saved calibration is from an incompatible model or format. Recalibrate or delete it.');
  const g = v.geometry;
  if (!object(g) || !keys(g, ['viewport', 'camera', 'pixelRatio']) || !object(g.viewport) || !keys(g.viewport, ['width', 'height']) || !finite(g.viewport.width, 160, 16384) || !finite(g.viewport.height, 160, 16384) || !finite(g.pixelRatio, .1, 16) || !object(g.camera) || !keys(g.camera, ['deviceId', 'width', 'height', 'facingMode']) || typeof g.camera.deviceId !== 'string' || g.camera.deviceId.length > 256 || typeof g.camera.facingMode !== 'string' || g.camera.facingMode.length > 32 || !finite(g.camera.width, 1, 16384) || !finite(g.camera.height, 1, 16384)) throw new Error('Saved calibration has invalid screen or camera geometry. Recalibrate or delete it.');
  return { schema: 1, model: MODEL_VERSION, savedAt: v.savedAt, geometry: { viewport: { width: g.viewport.width, height: g.viewport.height }, pixelRatio: g.pixelRatio, camera: { deviceId: g.camera.deviceId, width: g.camera.width, height: g.camera.height, facingMode: g.camera.facingMode } }, learned: readLearnedCalibration(v.learned) };
}
export function calibrationCompatibility(saved: CalibrationGeometry, current: CalibrationGeometry): { compatible: boolean; message: string } {
  const a = saved.camera, b = current.camera;
  const sameCamera = (!a.deviceId || !b.deviceId || a.deviceId === b.deviceId) && (!a.facingMode || !b.facingMode || a.facingMode === b.facingMode);
  const ratio = (a: number, b: number) => Math.abs(a / b - 1);
  if (!sameCamera || ratio(a.width / a.height, b.width / b.height) > .08) return { compatible: false, message: 'The camera changed. Recalibrate for this camera.' };
  if (ratio(saved.viewport.width, current.viewport.width) > .2 || ratio(saved.viewport.height, current.viewport.height) > .25) return { compatible: false, message: 'The window size changed substantially. Restore its previous size or recalibrate.' };
  return { compatible: true, message: 'Saved on this browser. Posture and lighting can change results; try a quick moving-dot check.' };
}

/** Synchronous, bounded commit with revocable leases around asynchronous worker operations. */
export class SavedCalibrationStore {
  private revision = 0;
  private deleted = false;
  private observedRaw: string | null = null;
  constructor(private readonly storage = () => window.localStorage) {}
  get lease() { return this.revision; }
  invalidate() { ++this.revision; }
  externalChange() { this.invalidate(); this.deleted = false; }
  load(): SavedCalibration | null {
    if (this.deleted) return null;
    const raw = this.storage().getItem(SAVED_CALIBRATION_KEY);
    this.observedRaw = raw;
    if (!raw) return null;
    if (raw.length > MAX_SAVED_BYTES) throw new Error('Saved calibration is too large. Delete it and recalibrate.');
    return readSavedCalibration(JSON.parse(raw));
  }
  isCurrent(saved: SavedCalibration): boolean { return JSON.stringify(this.load()) === JSON.stringify(saved); }
  save(learned: LearnedCalibration, geometry: CalibrationGeometry, lease: number): SavedCalibration | null {
    if (lease !== this.revision) return null;
    // Detect a different tab's commit even before its storage event is delivered.
    if (this.storage().getItem(SAVED_CALIBRATION_KEY) !== this.observedRaw) { this.invalidate(); return null; }
    const saved = readSavedCalibration({ schema: 1, model: MODEL_VERSION, savedAt: Date.now(), geometry, learned });
    const raw = JSON.stringify(saved);
    if (raw.length > MAX_SAVED_BYTES) throw new Error('Saved calibration exceeds the local size limit.');
    this.storage().setItem(SAVED_CALIBRATION_KEY, raw);
    this.observedRaw = raw;
    this.deleted = false;
    return saved;
  }
  delete(): void {
    this.invalidate(); this.deleted = true;
    this.storage().removeItem(SAVED_CALIBRATION_KEY);
    this.observedRaw = null;
  }
}
