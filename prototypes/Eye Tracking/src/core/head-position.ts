import { STALE_MS } from './dwell';

/** Image geometry, not head angles, eye direction or confidence. X/Y/span use image width. */
export type HeadPose = Readonly<{
  centerX: number; centerY: number; span: number; roll: number; yawRatio: number; pitchRatio: number;
}>;
type PoseFrame = { face: boolean; at: number; pose: HeadPose | null };
export type HeadFeedback =
  | { kind: 'setup'; reference: null; current: HeadPose | null; stable: boolean }
  | { kind: 'matched' | 'changed' | 'missing' | 'recovering'; reference: HeadPose; current: HeadPose | null };

// Unvalidated conservative heuristics. Translation is in reference eye spans;
// scale is fractional span change; roll is a 2D line-angle difference in radians.
export const HEAD_LIMITS = { translation: .12, scale: .12, roll: .12, yawRatio: .10, pitchRatio: .10 };
export const HEAD_STABLE_MS = 800;
const MIN_SAMPLES = 5;
const RECOVERY_FACTOR = .6;
const STABILITY_FACTOR = .4;

export function readHeadPose(value: unknown): HeadPose | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('centerX' in value) || typeof value.centerX !== 'number' || !Number.isFinite(value.centerX) || value.centerX < 0 || value.centerX > 1
    || !('centerY' in value) || typeof value.centerY !== 'number' || !Number.isFinite(value.centerY) || value.centerY < 0 || value.centerY > 4
    || !('span' in value) || typeof value.span !== 'number' || !Number.isFinite(value.span) || value.span <= 0 || value.span > 2
    || !('roll' in value) || typeof value.roll !== 'number' || !Number.isFinite(value.roll) || Math.abs(value.roll) > Math.PI
    || !('yawRatio' in value) || typeof value.yawRatio !== 'number' || !Number.isFinite(value.yawRatio) || Math.abs(value.yawRatio) > 2
    || !('pitchRatio' in value) || typeof value.pitchRatio !== 'number' || !Number.isFinite(value.pitchRatio) || Math.abs(value.pitchRatio) > 2) return null;
  return { centerX: value.centerX, centerY: value.centerY, span: value.span, roll: value.roll, yawRatio: value.yawRatio, pitchRatio: value.pitchRatio };
}

export function headDifference(current: HeadPose, reference: HeadPose) {
  return {
    // centerY is normalized by image width too, so distance is isotropic.
    x: (current.centerX - reference.centerX) / reference.span,
    y: (current.centerY - reference.centerY) / reference.span,
    scale: current.span / reference.span - 1,
    roll: Math.atan2(Math.sin(current.roll - reference.roll), Math.cos(current.roll - reference.roll)),
    yawRatio: current.yawRatio - reference.yawRatio,
    pitchRatio: current.pitchRatio - reference.pitchRatio,
  };
}

function near(current: HeadPose, reference: HeadPose, factor: number): boolean {
  const delta = headDifference(current, reference);
  return Math.hypot(delta.x, delta.y) <= HEAD_LIMITS.translation * factor
    && Math.abs(delta.scale) <= HEAD_LIMITS.scale * factor
    && Math.abs(delta.roll) <= HEAD_LIMITS.roll * factor
    && Math.abs(delta.yawRatio) <= HEAD_LIMITS.yawRatio * factor
    && Math.abs(delta.pitchRatio) <= HEAD_LIMITS.pitchRatio * factor;
}

/** One calibration owns one reference. Only its explicit Start can establish it. */
export class HeadPositionGuard {
  private reference: HeadPose | null = null;
  private current: HeadPose | null = null;
  private lastAt = -Infinity;
  private blocked = true;
  private reason: 'changed' | 'missing' | 'recovering' = 'missing';
  private samples: { at: number; pose: HeadPose }[] = [];

  private stable(): boolean {
    return this.samples.length >= MIN_SAMPLES && this.samples[this.samples.length - 1].at - this.samples[0].at >= HEAD_STABLE_MS;
  }

  private collect(pose: HeadPose, at: number): void {
    if (this.samples.length && (at - this.samples[this.samples.length - 1].at > STALE_MS || !near(pose, this.samples[0].pose, STABILITY_FACTOR))) this.samples = [];
    // Bound the stability buffer even on high-frame-rate cameras. Every frame
    // still checks drift; only reference/recovery averaging is downsampled.
    if (this.samples.length && at - this.samples[this.samples.length - 1].at < 50) return;
    this.samples.push({ at, pose });
    this.samples = this.samples.filter(sample => at - sample.at <= 1200).slice(-90);
  }

  observe(frame: PoseFrame, now: number): HeadFeedback {
    if (!frame.face || !frame.pose || !Number.isFinite(frame.at) || frame.at > now || now - frame.at > STALE_MS) {
      this.current = null;
      this.blocked = true;
      this.reason = 'missing';
      this.samples = [];
      // A later callback for the same missing-feature frame cannot restore it.
      if (Number.isFinite(frame.at) && frame.at <= now) this.lastAt = Math.max(this.lastAt, frame.at);
      return this.feedback(now);
    }
    if (frame.at <= this.lastAt) return this.feedback(now);
    if (frame.at - this.lastAt > STALE_MS) {
      this.blocked = true;
      this.samples = [];
    }
    this.lastAt = frame.at;
    this.current = frame.pose;
    if (!this.reference) this.collect(frame.pose, frame.at);
    else if (!near(frame.pose, this.reference, this.blocked ? RECOVERY_FACTOR : 1)) {
      this.blocked = true;
      this.reason = 'changed';
      this.samples = [];
    } else if (this.blocked) {
      this.reason = 'recovering';
      this.collect(frame.pose, frame.at);
      if (this.stable()) { this.blocked = false; this.samples = []; }
    }
    return this.feedback(now);
  }

  feedback(now: number): HeadFeedback {
    const fresh = now >= this.lastAt && now - this.lastAt <= STALE_MS;
    const current = fresh ? this.current : null;
    if (!this.reference) return { kind: 'setup', reference: null, current, stable: fresh && this.stable() };
    return { kind: !fresh ? 'missing' : this.blocked ? this.reason : 'matched', reference: this.reference, current };
  }

  establishReference(now: number): boolean {
    const feedback = this.feedback(now);
    if (feedback.kind !== 'setup') return feedback.kind === 'matched';
    if (!feedback.stable || !feedback.current) return false;
    const mean = (key: keyof HeadPose) => this.samples.reduce((sum, sample) => sum + sample.pose[key], 0) / this.samples.length;
    const roll = Math.atan2(this.samples.reduce((sum, sample) => sum + Math.sin(sample.pose.roll), 0), this.samples.reduce((sum, sample) => sum + Math.cos(sample.pose.roll), 0));
    this.reference = { centerX: mean('centerX'), centerY: mean('centerY'), span: mean('span'), roll, yawRatio: mean('yawRatio'), pitchRatio: mean('pitchRatio') };
    this.samples = [];
    this.blocked = false;
    return true;
  }

  allowsInput(now: number): boolean { return this.feedback(now).kind === 'matched'; }
}
