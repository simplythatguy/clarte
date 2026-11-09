import type { Point } from './tracking';

/**
 * One Euro filter (Casiez, Roussel, Vogel 2012): a low-pass whose cut-off rises with speed, so a
 * steady fixation is smoothed hard while a deliberate jump passes through almost immediately.
 * A fixed-gain filter has to trade jitter against lag; this one does not.
 */
export const ONE_EURO = {
  /** Cut-off in Hz while the estimate is nearly still. Lower is steadier. */
  minCutoff: 0.9,
  /**
   * How fast the cut-off rises with speed, in Hz per (screen-widths per second). Higher is snappier,
   * but too high lets tracker noise itself open the filter. Chosen by sweep against 15 and 35 px noise.
   */
  beta: 2,
  /** Cut-off for the speed estimate itself, in Hz. */
  derivativeCutoff: 1.5,
  /** A gap longer than this restarts the filter instead of smoothing across it (a blink, a lost face). */
  resetGapMs: 400,
  /** Frame spacing bounds, so a stalled or duplicated timestamp cannot blow the filter up. */
  frameRangeMs: [5, 250] as const,
};

const alpha = (cutoff: number, dt: number) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

class Channel {
  value = 0; speed = 0;
  step(measurement: number, dt: number, minCutoff: number, beta: number, derivativeCutoff: number, first: boolean): number {
    if (first) { this.value = measurement; this.speed = 0; return measurement; }
    const rate = (measurement - this.value) / dt;
    this.speed += alpha(derivativeCutoff, dt) * (rate - this.speed);
    this.value += alpha(minCutoff + beta * Math.abs(this.speed), dt) * (measurement - this.value);
    return this.value;
  }
}

/** Smooths a 2D point in screen-width units, so one setting suits any window size. */
export class OneEuroPoint {
  private x = new Channel();
  private y = new Channel();
  private lastAt: number | null = null;
  constructor(private readonly options: Partial<typeof ONE_EURO> = {}) {}

  reset(): void { this.lastAt = null; }

  /** `scale` is the screen width in px; `at` is the frame time in ms. Out-of-order frames are ignored. */
  filter(point: Point, at: number, scale: number): Point {
    const o = { ...ONE_EURO, ...this.options };
    if (!Number.isFinite(at) || !(scale > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
    if (this.lastAt !== null && at <= this.lastAt) return { x: this.x.value * scale, y: this.y.value * scale };
    const first = this.lastAt === null || at - this.lastAt > o.resetGapMs;
    const dt = first ? 1 : Math.min(o.frameRangeMs[1], Math.max(o.frameRangeMs[0], at - this.lastAt!)) / 1000;
    this.lastAt = at;
    return {
      x: this.x.step(point.x / scale, dt, o.minCutoff, o.beta, o.derivativeCutoff, first) * scale,
      y: this.y.step(point.y / scale, dt, o.minCutoff, o.beta, o.derivativeCutoff, first) * scale,
    };
  }
}
