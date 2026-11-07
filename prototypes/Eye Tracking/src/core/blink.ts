import { STALE_MS } from './dwell';
import type { GazeFrame } from './tracking';
import type { EyeState } from './tracking';
export const BLINK_TIMING = { steadyMs: 2000, minimumClosedMs: 60, maximumClosedMs: 500, minimumOpenMs: 180, refractoryMs: 500 };
/** Bilateral EAR hysteresis. A wink and missing/invalid measurements are unknown. */
export class BilateralEyes {
  private state: EyeState = 'unknown';
  reset() { this.state = 'unknown'; }
  observe(left: number, right: number): EyeState {
    if (![left,right].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || (left < .2) !== (right < .2) || (left >= .23) !== (right >= .23)) this.state = 'unknown';
    else if (left < .2 && right < .2) this.state = 'closed';
    else if (left >= .23 && right >= .23) this.state = 'open';
    return this.state;
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
