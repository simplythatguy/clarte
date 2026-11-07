import { readHeadPose, type HeadPose } from './head-position';
import { readCameraMotion, type CameraMotion } from './camera-motion';
export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };
export type EyeState = 'open' | 'closed' | 'unknown';
/** The two estimators behind a blended estimate, uncorrected: the gaze network and the geometric (iris and lid) model. */
export type Estimates<T> = { network: T | null; geometric: T | null };
export type GazeFrame = { point: Point | null; rawPoint?: Point | null; face: boolean; facePresent: boolean; eyeState: EyeState; at: number; pose: HeadPose | null; estimates?: Estimates<Point> | null; camera?: CameraMotion | null };
export type WorkerGaze = { normPog: number[]; rawNormPog: number[] | null; open: boolean; face: boolean; facePresent: boolean; eyeState: EyeState; at: number; pose?: HeadPose | null; estimates?: Estimates<number[]> | null; camera?: CameraMotion | null };
const pair = (v: unknown): v is number[] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
export function readEstimates(v: unknown): Estimates<number[]> | null {
  if (!v || typeof v !== 'object' || !('network' in v) || !('geometric' in v) || (v.network !== null && !pair(v.network)) || (v.geometric !== null && !pair(v.geometric))) return null;
  return { network: v.network, geometric: v.geometric };
}
export const MODEL_FILES = [
  '/vendor/webeyetrack/web/model.json', '/vendor/webeyetrack/web/group1-shard1of1.bin',
  '/vendor/webeyetrack/vision/face_landmarker.task',
  '/vendor/webeyetrack/vision/wasm/vision_wasm_internal.js',
  '/vendor/webeyetrack/vision/wasm/vision_wasm_internal.wasm',
  '/vendor/webeyetrack/vision/wasm/vision_wasm_nosimd_internal.js',
  '/vendor/webeyetrack/vision/wasm/vision_wasm_nosimd_internal.wasm',
];
export function readWorkerGaze(value: unknown): WorkerGaze {
  if (!value || typeof value !== 'object' || !('at' in value) || !('open' in value) || !('face' in value) || !('normPog' in value) || !('rawNormPog' in value) ||
      !('facePresent' in value) || typeof value.facePresent !== 'boolean' || !('eyeState' in value) || !['open', 'closed', 'unknown'].some(state => state === value.eyeState) ||
      typeof value.at !== 'number' || !Number.isFinite(value.at) || typeof value.open !== 'boolean' || typeof value.face !== 'boolean' ||
      !Array.isArray(value.normPog) || value.normPog.length !== 2 || !value.normPog.every(n => typeof n === 'number' && Number.isFinite(n)) ||
      (value.rawNormPog !== null && (!Array.isArray(value.rawNormPog) || value.rawNormPog.length !== 2 || !value.rawNormPog.every(n => typeof n === 'number' && Number.isFinite(n))))) {
    throw new Error('Invalid WebEyeTrack worker result');
  }
  const eyeState = value.eyeState;
  if (eyeState !== 'open' && eyeState !== 'closed' && eyeState !== 'unknown' || !value.facePresent && eyeState !== 'unknown' || (value.face || value.open) && (!value.facePresent || eyeState !== 'open')) throw new Error('Inconsistent WebEyeTrack eye/face result');
  return { at: value.at, face: value.face, open: value.open, facePresent: value.facePresent, eyeState, normPog: value.normPog, rawNormPog: value.rawNormPog, pose: 'pose' in value ? readHeadPose(value.pose) : null, estimates: 'estimates' in value ? readEstimates(value.estimates) : null, camera: 'camera' in value ? readCameraMotion(value.camera) : null };
}
export function normalizeGaze(result: WorkerGaze, viewport: Viewport): GazeFrame {
  const valid = result.facePresent && result.eyeState === 'open' && result.face && result.open && result.normPog.every(n => n >= -.5 && n <= .5);
  const toPoint = (p: number[] | null | undefined): Point | null => (p?.length === 2 && p.every(Number.isFinite) ? { x: (p[0] + .5) * viewport.width, y: (p[1] + .5) * viewport.height } : null);
  return { point: valid ? toPoint(result.normPog) : null,
    rawPoint: valid ? toPoint(result.rawNormPog) : null,
    face: valid, facePresent: result.facePresent, eyeState: result.eyeState, at: result.at, pose: result.facePresent ? result.pose ?? null : null,
    estimates: valid && result.estimates ? { network: toPoint(result.estimates.network), geometric: toPoint(result.estimates.geometric) } : null,
    camera: result.camera ?? null };
}
