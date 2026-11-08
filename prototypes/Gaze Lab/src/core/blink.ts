import { STALE_MS } from './dwell';
import type { GazeFrame } from './tracking';
import type { EyeState } from './tracking';
export const BLINK_TIMING = { steadyMs: 2000, minimumClosedMs: 60, maximumClosedMs: 500, minimumOpenMs: 180, refractoryMs: 500 };
/**
 * Eye-openness thresholds adapt to the person. Eye aspect ratio when open differs a lot between
 * people (and more with facial weakness), so fixed thresholds miss blinks on wide eyes and invent
 * them on narrow ones. After enough frames, closed/open become fractions of this person's typical
 * open ratio; until then the previous fixed values apply.
 */
export const EYE_OPENNESS = {
  fixed: { closed: .2, open: .23 },
  closedRatio: .6, openRatio: .72,
  /** Thresholds never leave these bounds, whatever is measured. */
  bounds: [.12, .3] as const,
  /** Frames needed before adapting; frames are learned only when both eyes agree and are plausibly open. */
  minimumSamples: 45, capacity: 150, agreement: .08,
};
/** Bilateral EAR hysteresis. A wink and missing/invalid measurements are unknown. */
export class BilateralEyes {
  private state: EyeState = 'unknown';
  private samples: number[] = [];
  private thresholds = { ...EYE_OPENNESS.fixed };
  /** Learned openness is a trait of the person, so a reset keeps it. */
  reset() { this.state = 'unknown'; }
  get openness(): { closed: number; open: number; adapted: boolean } { return { ...this.thresholds, adapted: this.samples.length >= EYE_OPENNESS.minimumSamples }; }
  observe(left: number, right: number): EyeState {
    const { closed, open } = this.thresholds;
    if (![left, right].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || (left < closed) !== (right < closed) || (left >= open) !== (right >= open)) this.state = 'unknown';
    else if (left < closed && right < closed) this.state = 'closed';
    else if (left >= open && right >= open) this.state = 'open';
    if ([left, right].every(n => Number.isFinite(n) && n > EYE_OPENNESS.bounds[0] && n <= 1) && Math.abs(left - right) < EYE_OPENNESS.agreement) this.learn((left + right) / 2);
    return this.state;
  }
  private learn(ratio: number): void {
    this.samples.push(ratio);
    if (this.samples.length > EYE_OPENNESS.capacity) this.samples.shift();
    if (this.samples.length < EYE_OPENNESS.minimumSamples || this.samples.length % 15 !== 0) return;
    // Blinks are a small share of frames, so the median of plausible frames is the open ratio.
    const sorted = [...this.samples].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    const [lo, hi] = EYE_OPENNESS.bounds, clamp = (v: number) => Math.min(hi, Math.max(lo, v));
    this.thresholds = { closed: clamp(median * EYE_OPENNESS.closedRatio), open: clamp(median * EYE_OPENNESS.openRatio) };
  }
}
export type BlinkSelectionState =
  | { kind: 'idle' }
  | { kind: 'steady'; target: string; since: number }
  | { kind: 'armed' | 'preview' | 'latched'; target: string };
/** No visual or selection event while arming. Only a bounded closed->open completion can act. */
export class BlinkSelection {
  state: BlinkSelectionState = { kind: 'idle' };
  private lastAt = -Infinity;
  private openSince = Infinity;
  private closing: { since: number; eligible: boolean } | null = null;
  private lastBlink = -Infinity;
  reset(): void { this.state = { kind: 'idle' }; this.lastAt = -Infinity; this.openSince = Infinity; this.closing = null; this.lastBlink = -Infinity; }
  activate(target: string): void { this.reset(); this.state = { kind: 'latched', target }; }
  private cancel(): void { if (this.state.kind !== 'latched') this.state = { kind: 'idle' }; this.closing = null; this.openSince = Infinity; }
  tick(now: number): void {
    if (now - this.lastAt > STALE_MS || this.closing && now - this.closing.since > BLINK_TIMING.maximumClosedMs) this.cancel();
  }
  sample(frame: GazeFrame, target: string | null, now: number): { selected: string | null; previewed: string | null } {
    const result = (selected: string | null = null, previewed: string | null = null) => ({ selected, previewed });
    if (!Number.isFinite(frame.at) || frame.at <= this.lastAt || frame.at > now || now - frame.at > STALE_MS) { this.cancel(); return result(); }
    if (frame.at - this.lastAt > STALE_MS) this.cancel();
    this.lastAt = frame.at;
    if (!frame.facePresent || frame.eyeState === 'unknown' || !frame.eyeState) { this.cancel(); return result(); }
    if (frame.eyeState === 'closed') {
      if (!this.closing) this.closing = { since: frame.at, eligible: frame.at - this.openSince >= BLINK_TIMING.minimumOpenMs };
      // Only an already armed candidate survives a short closure. Closed time is never steady gaze.
      if (this.state.kind === 'steady') this.state = { kind: 'idle' };
      if (frame.at - this.closing.since > BLINK_TIMING.maximumClosedMs) this.cancel();
      return result();
    }
    if (!frame.face || !frame.point || !Number.isFinite(frame.point.x) || !Number.isFinite(frame.point.y)) { this.cancel(); return result(); }
    const closed = this.closing; this.closing = null;
    if (!Number.isFinite(this.openSince) || closed) this.openSince = frame.at;
    // Reopening must identify the same target using this fresh open frame.
    if (this.state.kind !== 'idle' && this.state.target !== target) this.state = { kind: 'idle' };
    if (this.state.kind === 'latched') return result();
    const duration = closed ? frame.at - closed.since : 0;
    if (closed && closed.eligible && duration >= BLINK_TIMING.minimumClosedMs && duration <= BLINK_TIMING.maximumClosedMs && frame.at - this.lastBlink >= BLINK_TIMING.refractoryMs) {
      this.lastBlink = frame.at;
      if (this.state.kind === 'armed') { const candidate = this.state.target; this.state = { kind: 'preview', target: candidate }; return result(null, candidate); }
      if (this.state.kind === 'preview') { const candidate = this.state.target; this.state = { kind: 'latched', target: candidate }; return result(candidate); }
    } else if (closed && duration > BLINK_TIMING.maximumClosedMs) this.cancel();
    if (!target) { this.state = { kind: 'idle' }; return result(); }
    if (this.state.kind === 'idle') this.state = { kind: 'steady', target, since: frame.at };
    else if (this.state.kind === 'steady' && frame.at - this.state.since >= BLINK_TIMING.steadyMs) this.state = { kind: 'armed', target };
    return result();
  }
}
