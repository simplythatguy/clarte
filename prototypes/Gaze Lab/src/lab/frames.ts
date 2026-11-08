import type { HeadPose } from '../core/head-position';
import type { CameraMotion } from '../core/camera-motion';
import type { GazeFeatures } from '../core/geometric-gaze';
import type { EyeState, Viewport } from '../core/tracking';

export type Screen = 'setup' | 'quick' | 'calibration' | 'instruction' | 'block' | 'summary' | 'test' | 'result';
export type CandidateOut = {
  /** Candidate geometric estimate (normalized), null when the candidate keeps the shipped one. */
  geometric: number[] | null;
  /** Final candidate estimate after per-axis blend and screen correction (normalized). */
  final: number[] | null;
  /** From the shadow worker with the candidate head restored, when configured. */
  head: { rawNormPog: number[] | null; network: number[] | null; geometric: number[] | null } | null;
};
/** The quick-calibration shadow worker's estimates for the same frame (normalized); its blend runs at the capped geometric share. */
export type QuickOut = { rawNormPog: number[] | null; network: number[] | null; geometric: number[] | null };
/** One line of frames.jsonl. Normalized coordinates are in [-0.5, 0.5]; `pointer` and `target.x/y` are CSS px. */
export type FrameRow = {
  i: number; t: number; videoT: number | null; screen: Screen;
  block: string | null; point: number | null; phase: string | null;
  target: { x: number; y: number; nx: number; ny: number } | null;
  rawNormPog: number[] | null; network: number[] | null; geometric: number[] | null; normPog: number[] | null; pointer: number[] | null;
  facePresent: boolean; face: boolean; eyeState: EyeState; pose: HeadPose | null; camera: CameraMotion | null;
  headVector: number[] | null; faceOrigin3D: number[] | null; faceRt: number[] | null; features12: number[] | null; gaze: GazeFeatures | null;
  timings: Record<string, number> | null;
  /** Row index into landmarks.f32 (478 × 3 float32 per row), null when no face. */
  landmarkRow: number | null;
  candidate: CandidateOut | null;
  /** Only present in quick-calibration sessions, so the default flow's rows are unchanged. */
  quick?: QuickOut | null;
  /** Simple-mode sessions only: which test trial (and attempt of it) the frame belongs to; `point` is then the target quadrant. */
  trial?: { index: number; round: number; attempt: number } | null;
  viewport: Viewport;
};
export const LANDMARK_FLOATS = 478 * 3;

/** Batches rows and landmark rows for upload; `onBatch` receives the JSONL text and the Float32 landmark bytes. */
export class FrameLog {
  private rows: FrameRow[] = [];
  private landmarks: Float32Array[] = [];
  private nextLandmarkRow = 0;
  count = 0;
  constructor(private readonly onBatch: (jsonl: string, landmarks: Uint8Array | null) => void, private readonly batchMs = 2000, private readonly now: () => number = () => performance.now()) {}
  private lastFlush = -Infinity;
  /** Returns the landmark row index assigned to this frame, or null. */
  add(row: Omit<FrameRow, 'i' | 'landmarkRow'>, landmarks: readonly number[] | null): FrameRow {
    let landmarkRow: number | null = null;
    if (landmarks && landmarks.length === LANDMARK_FLOATS) { landmarkRow = this.nextLandmarkRow++; this.landmarks.push(Float32Array.from(landmarks)); }
    const full: FrameRow = { ...row, i: this.count++, landmarkRow };
    this.rows.push(full);
    const t = this.now();
    if (t - this.lastFlush >= this.batchMs) this.flush();
    return full;
  }
  get pending(): number { return this.rows.length; }
  flush(): void {
    this.lastFlush = this.now();
    if (!this.rows.length && !this.landmarks.length) return;
    const jsonl = this.rows.map(r => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : '');
    let bytes: Uint8Array | null = null;
    if (this.landmarks.length) {
      bytes = new Uint8Array(this.landmarks.length * LANDMARK_FLOATS * 4);
      this.landmarks.forEach((row, i) => bytes!.set(new Uint8Array(row.buffer), i * LANDMARK_FLOATS * 4));
    }
    this.rows = []; this.landmarks = [];
    this.onBatch(jsonl, bytes);
  }
}
