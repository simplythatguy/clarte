import { STALE_MS } from './dwell';
import type { GazeFrame, Point, Viewport } from './tracking';
export type Area = Point & { radius: number };
/** A short distribution of estimates, never a confidence interval or an input hit area. */
export class GazeArea {
  private history: { point: Point; at: number }[] = [];
  reset() { this.history = []; }
  sample(frame: GazeFrame, viewport: Viewport, now: number): Area | null {
    const p = frame.point;
    if (!frame.face || !p || ![p.x, p.y, frame.at].every(Number.isFinite) || frame.at > now || now - frame.at > STALE_MS || p.x < 0 || p.y < 0 || p.x >= viewport.width || p.y >= viewport.height) { this.reset(); return null; }
    const last = this.history.at(-1);
    if (last && frame.at <= last.at) return this.value(viewport);
    if (last && frame.at - last.at > STALE_MS) this.reset();
    this.history = [...this.history.filter(s => frame.at - s.at <= 800), { point: p, at: frame.at }].slice(-24);
    return this.value(viewport);
  }
  private value(viewport: Viewport): Area | null {
    if (!this.history.length) return null;
    const x = this.history.reduce((sum, s) => sum + s.point.x, 0) / this.history.length;
    const y = this.history.reduce((sum, s) => sum + s.point.y, 0) / this.history.length;
    const spread = Math.sqrt(this.history.reduce((sum, s) => sum + (s.point.x - x) ** 2 + (s.point.y - y) ** 2, 0) / this.history.length);
    const limit = Math.max(48, Math.min(160, Math.min(viewport.width, viewport.height) * .22));
    return { x, y, radius: Math.min(limit, Math.max(Math.min(80, limit), 80 + spread)) };
  }
}
