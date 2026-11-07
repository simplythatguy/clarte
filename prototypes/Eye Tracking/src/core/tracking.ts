import type { HeadPose } from './head-position';
export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };
export type EyeState = 'open' | 'closed' | 'unknown';
export type GazeFrame = { point: Point | null; rawPoint?: Point | null; face: boolean; facePresent: boolean; eyeState: EyeState; at: number; pose: HeadPose | null };
export type WorkerGaze = { normPog: number[]; rawNormPog: number[] | null; open: boolean; face: boolean; facePresent: boolean; eyeState: EyeState; at: number };
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
  return { at: value.at, face: value.face, open: value.open, facePresent: value.facePresent, eyeState, normPog: value.normPog, rawNormPog: value.rawNormPog };
}
export function normalizeGaze(result: WorkerGaze, viewport: Viewport): GazeFrame {
  const valid = result.facePresent && result.eyeState === 'open' && result.face && result.open && result.normPog.every(n => n >= -.5 && n <= .5);
  return { point: valid ? { x: (result.normPog[0] + .5) * viewport.width, y: (result.normPog[1] + .5) * viewport.height } : null,
    rawPoint: valid && result.rawNormPog?.length === 2 && result.rawNormPog.every(Number.isFinite) ? { x: (result.rawNormPog[0] + .5) * viewport.width, y: (result.rawNormPog[1] + .5) * viewport.height } : null,
    face: valid, facePresent: result.facePresent, eyeState: result.eyeState, at: result.at, pose: null };
}
