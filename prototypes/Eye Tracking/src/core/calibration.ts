import { STALE_MS } from './dwell';
import type { GazeFrame } from './tracking';
export type { Point, Viewport } from './tracking';
import type { Point, Viewport } from './tracking';
export type CalibrationPace = 'quick' | 'comfortable' | 'gentle';
export type CalibrationStage = 'eyes' | 'head';
export const LABELS_PER_POINT = 3;
export const READING_MS = 3000;
export const CALIBRATION_TIMING = {
  quick: { moveMs: 700, settleMs: 1000, sampleMs: 400 },
  comfortable: { moveMs: 1200, settleMs: 1800, sampleMs: 800 },
  gentle: { moveMs: 1600, settleMs: 2400, sampleMs: 1100 },
} satisfies Record<CalibrationPace, { moveMs: number; settleMs: number; sampleMs: number }>;
export function calibrationPoints(viewport: Viewport, stage: CalibrationStage = 'eyes'): Point[] {
  const x = Math.min(56, Math.max(32, viewport.width * .045));
  const y = Math.min(viewport.height * .3, 88); // Reserve the fixed diagnostic control rail before a run starts.
  const points = [
    { x: viewport.width / 2, y: viewport.height / 2 },
    { x, y }, { x: viewport.width / 2, y }, { x: viewport.width - x, y },
    { x: viewport.width - x, y: viewport.height / 2 }, { x: viewport.width - x, y: viewport.height - y },
    { x: viewport.width / 2, y: viewport.height - y }, { x, y: viewport.height - y }, { x, y: viewport.height / 2 },
  ];
  return stage === 'eyes' ? points : [points[0], { x: viewport.width * .3, y: viewport.height * .5 }, { x: viewport.width * .7, y: viewport.height * .5 }, { x: viewport.width * .5, y: viewport.height * .3 }, { x: viewport.width * .5, y: viewport.height * .7 }];
}
export function viewportChanged(baseline: Viewport, current: Viewport): boolean {
  return Math.abs(current.width - baseline.width) > 40 || Math.abs(current.height - baseline.height) > 80;
}
type Position = { stage: CalibrationStage; step: number; samples: number };
export type CalibrationState = Position & (
  | { kind: 'ready' | 'resetting' | 'collected' | 'training' | 'complete' }
  | { kind: 'reading'; remainingMs: number; from: Point }
  | { kind: 'paused'; reading: { remainingMs: number; from: Point } | null }
  | { kind: 'moving' | 'settling'; until: number }
  | { kind: 'sampling' | 'collecting'; lastLabelAt: number }
);
export function freshFeatures(frame: GazeFrame, now: number): boolean {
  return frame.face && frame.facePresent && frame.eyeState === 'open' && Number.isFinite(frame.at) && frame.at <= now && now - frame.at <= STALE_MS;
}
/** Continuity of usable decoded observations, not fixed head pose or gaze accuracy. */
export class FeatureReadiness {
  private since = Infinity;
  private last = -Infinity;
  private count = 0;
  observe(frame: GazeFrame, now: number): boolean {
    if (!freshFeatures(frame, now)) { this.since = Infinity; this.last = -Infinity; this.count = 0; return false; }
    if (frame.at > this.last) {
      if (frame.at - this.last > STALE_MS) { this.since = frame.at; this.count = 0; }
      this.last = frame.at; this.count++;
    }
    return this.ready(now);
  }
  ready(now: number) { return this.count >= 5 && this.last - this.since >= 400 && this.last <= now && now - this.last <= STALE_MS; }
}
/** Collection, async acknowledgement and explicit training are distinct phases. */
export class CalibrationRun {
  readonly readiness = new FeatureReadiness();
  state: CalibrationState = { kind: 'ready', stage: 'eyes', step: 0, samples: 0 };
  private lastFrameAt = -Infinity;
  private pending = false;
  private readingAt = 0;
  constructor(public readonly viewport: Viewport, public readonly pace: CalibrationPace, private readonly now = () => performance.now()) {}
  get points() { return calibrationPoints(this.viewport, this.state.stage); }
  get point(): Point {
    const s = this.state;
    return s.kind === 'reading' ? s.from : s.kind === 'paused' && s.reading ? s.reading.from : this.points[s.step];
  }
  start(now: number): boolean {
    if ((this.state.kind !== 'ready' && this.state.kind !== 'paused') || this.state.kind === 'ready' && !this.readiness.ready(now) || this.pending) return false;
    const s = this.state;
    const reading = s.kind === 'ready' ? { remainingMs: READING_MS, from: this.point } : s.kind === 'paused' ? s.reading : null;
    this.readingAt = now;
    this.state = reading ? { kind: 'reading', stage: s.stage, step: s.step, samples: s.samples, ...reading }
      : { kind: 'moving', stage: s.stage, step: s.step, samples: s.samples, until: now + CALIBRATION_TIMING[this.pace].moveMs };
    return true;
  }
  continueNow(now: number): boolean {
    const s = this.state;
    if (this.pending || !(s.kind === 'reading' || s.kind === 'paused' && s.reading !== null)) return false;
    this.state = { kind: 'moving', stage: s.stage, step: s.step, samples: s.samples, until: now + CALIBRATION_TIMING[this.pace].moveMs };
    return true;
  }
  private isPaused(): boolean { return this.state.kind === 'paused'; }
  pause(): void {
    const s = this.state;
    if (!['reading', 'moving', 'settling', 'sampling', 'collecting'].includes(s.kind)) return;
    this.state = { kind: 'paused', stage: s.stage, step: s.step, samples: s.samples,
      reading: s.kind === 'reading' ? { remainingMs: s.remainingMs, from: s.from } : null };
  }
  tick(now: number, frame: GazeFrame): void {
    const usable = this.readiness.observe(frame, now);
    const s = this.state;
    if (s.kind === 'reading') {
      const remainingMs = Math.max(0, s.remainingMs - Math.max(0, now - this.readingAt));
      this.readingAt = now;
      this.state = remainingMs ? { ...s, remainingMs } : { kind: 'moving', stage: s.stage, step: s.step, samples: s.samples, until: now + CALIBRATION_TIMING[this.pace].moveMs };
    }
    if (s.kind === 'moving' && now >= s.until) this.state = { ...s, kind: 'settling', until: now + CALIBRATION_TIMING[this.pace].settleMs };
    const current = this.state;
    if ((current.kind === 'settling' || current.kind === 'sampling') && !usable) this.state = { kind: 'settling', stage: current.stage, step: current.step, samples: current.samples, until: now + CALIBRATION_TIMING[this.pace].settleMs };
  }
  async capture(frame: GazeFrame, now: number, record: (point: Point, at: number) => Promise<boolean>): Promise<void> {
    this.tick(now, frame);
    let s = this.state;
    if (this.pending || !freshFeatures(frame, now) || !this.readiness.ready(now) || frame.at <= this.lastFrameAt) return;
    this.lastFrameAt = frame.at;
    if (s.kind === 'settling' && now >= s.until && frame.at >= s.until) { s = { kind: 'sampling', stage: s.stage, step: s.step, samples: s.samples, lastLabelAt: -Infinity }; this.state = s; }
    if (s.kind !== 'sampling' || frame.at - s.lastLabelAt < CALIBRATION_TIMING[this.pace].sampleMs) return;
    this.pending = true; this.state = { ...s, kind: 'collecting' };
    let accepted: boolean;
    try { accepted = await record(this.point, frame.at); }
    finally { this.pending = false; }
    const paused = this.isPaused();
    if (!accepted) { if (!paused) this.state = s; return; }
    const samples = s.samples + 1;
    const next: CalibrationState = samples < LABELS_PER_POINT ? { ...s, samples, lastLabelAt: frame.at }
      : s.step === this.points.length - 1 ? { kind: 'collected', stage: s.stage, step: s.step, samples }
      : { kind: 'moving', stage: s.stage, step: s.step + 1, samples: 0, until: Math.max(now, this.now()) + CALIBRATION_TIMING[this.pace].moveMs };
    this.readingAt = Math.max(now, this.now());
    this.state = paused && next.kind !== 'collected' ? { kind: 'paused', stage: next.stage, step: next.step, samples: next.samples, reading: null } : next;
  }
  addHeadStage(): void {
    if (this.state.kind === 'collected' && this.state.stage === 'eyes') this.state = { kind: 'ready', stage: 'head', step: 0, samples: 0 };
  }
  beginTraining(): boolean {
    if (this.state.kind !== 'collected') return false;
    this.state = { ...this.state, kind: 'training' }; return true;
  }
  finishTraining(): boolean {
    if (this.state.kind !== 'training') return false;
    this.state = { ...this.state, kind: 'complete' }; return true;
  }
}
