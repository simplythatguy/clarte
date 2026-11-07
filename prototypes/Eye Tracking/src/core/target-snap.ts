import type { Point } from './tracking';
import type { GazeLayout, TargetRect } from './gaze';

/** Screen distance from a point to a target rectangle; zero inside it. */
export function rectDistance(point: Point, rect: TargetRect): number {
  return Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));
}

export const SNAP = {
  /** Estimates this far past the viewport edge, as a fraction of each dimension, count as looking away. */
  edgeSlack: .15,
  /** Estimates farther than this fraction of the viewport's shorter side from every target count as looking away. */
  reach: .25,
  /** A new target must beat the current one by this fraction of the viewport's shorter side. */
  hysteresis: .07,
  /** Component-wise median over this many consecutive open-eye estimates. */
  window: 3,
};

/**
 * Maps a noisy gaze estimate to the nearest target instead of requiring an exact hit.
 * Gaps, the outer margin and small overshoots past the screen edge resolve to the closest
 * target within reach; staying on the current target is preferred until another is clearly closer.
 */
export class TargetSnapper {
  private current: string | null = null;
  private recent: Point[] = [];

  reset(): void { this.current = null; this.recent = []; }

  /** A closed-eye or missing estimate drops pre-blink evidence but keeps the current target. */
  resolve(point: Point | null | undefined, layout: GazeLayout): string | null {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { this.recent = []; return null; }
    const { width, height } = layout.viewport;
    const slackX = width * SNAP.edgeSlack, slackY = height * SNAP.edgeSlack;
    if (point.x < -slackX || point.y < -slackY || point.x > width + slackX || point.y > height + slackY || !layout.targets.length) { this.reset(); return null; }
    this.recent = [...this.recent, point].slice(-SNAP.window);
    const xs = this.recent.map(p => p.x).sort((a, b) => a - b), ys = this.recent.map(p => p.y).sort((a, b) => a - b);
    const middle = Math.floor(this.recent.length / 2);
    const median = { x: xs[middle], y: ys[middle] };
    let best = layout.targets[0], bestDistance = Infinity;
    for (const target of layout.targets) {
      const distance = rectDistance(median, target);
      if (distance < bestDistance) { best = target; bestDistance = distance; }
    }
    if (bestDistance > Math.min(width, height) * SNAP.reach) { this.reset(); return null; }
    const current = this.current ? layout.targets.find(target => target.id === this.current) : undefined;
    if (current && current !== best && rectDistance(median, current) <= bestDistance + Math.min(width, height) * SNAP.hysteresis) return current.id;
    this.current = best.id;
    return best.id;
  }
}
