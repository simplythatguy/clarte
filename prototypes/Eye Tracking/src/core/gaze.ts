import { STALE_MS } from './dwell';
import type { Point, Viewport } from './calibration';
import { freshFeatures } from './calibration';
import type { GazeFrame } from './tracking';

export type TargetRect = { id: string; left: number; top: number; right: number; bottom: number };
export type GazeLayout = { viewport: Viewport; targets: TargetRect[] };
export type ResolvedGaze = {
  point: Point | null; target: string | null; kind: 'target' | 'neutral' | 'uncertain' | 'hold' | 'duplicate' | 'lost'; layoutChanged: boolean;
};
type Evidence = { target: string | null; since: number; count: number };
type Region = { rect: TargetRect; x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p: Point, region: Region, hold = false) => {
  const factor = hold ? 1.5 : 1;
  return p.x >= region.rect.left - region.x * factor && p.x <= region.rect.right + region.x * factor && p.y >= region.rect.top - region.y * factor && p.y <= region.rect.bottom + region.y * factor;
};

function regionsFor(layout: GazeLayout): Region[] {
  const limit = Math.min(20, Math.min(layout.viewport.width, layout.viewport.height) * .025);
  return layout.targets.map(rect => {
    let x = limit, y = limit;
    for (const other of layout.targets) {
      if (other === rect) continue;
      if (rect.top < other.bottom && other.top < rect.bottom) {
        const gap = Math.max(other.left - rect.right, rect.left - other.right);
        if (gap >= 0) x = Math.min(x, gap * .2);
      }
      if (rect.left < other.right && other.left < rect.right) {
        const gap = Math.max(other.top - rect.bottom, rect.top - other.bottom);
        if (gap >= 0) y = Math.min(y, gap * .2);
      }
    }
    return { rect, x, y };
  });
}

/** Local geometry assistance. No confidence/intent claim; unresolved regions cannot rearm dwell. */
export class GazeResolver {
  private layoutKey = '';
  private regions: Region[] = [];
  private point: Point | null = null;
  private history: Point[] = [];
  private lastFrameAt = -Infinity;
  private lastAcceptedAt = -Infinity;
  private active: string | null = null;
  private entry: Evidence | null = null;
  private exit: Evidence | null = null;
  private outlier: { point: Point; since: number; count: number } | null = null;

  reset(): void {
    this.point = null;
    this.history = [];
    this.lastFrameAt = -Infinity;
    this.lastAcceptedAt = -Infinity;
    this.active = null;
    this.entry = null;
    this.exit = null;
    this.outlier = null;
  }

  sample(frame: GazeFrame, layout: GazeLayout, now: number): ResolvedGaze {
    const key = JSON.stringify(layout);
    const layoutChanged = key !== this.layoutKey;
    if (layoutChanged) { this.reset(); this.layoutKey = key; this.regions = regionsFor(layout); }
    const result = (kind: ResolvedGaze['kind'], target = this.active): ResolvedGaze => ({ kind, target, point: this.point, layoutChanged });
    const raw = frame.point;
    if (!freshFeatures(frame, now) || !raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || raw.x < 0 || raw.y < 0 || raw.x >= layout.viewport.width || raw.y >= layout.viewport.height) {
      this.reset();
      return result('lost', null);
    }
    if (frame.at <= this.lastFrameAt) return result('duplicate');
    if (frame.at - this.lastFrameAt > STALE_MS) this.reset();
    this.lastFrameAt = frame.at;

    const jump = Math.max(100, Math.hypot(layout.viewport.width, layout.viewport.height) * .18);
    if (this.point && distance(raw, this.point) > jump) {
      const previous = this.outlier;
      this.outlier = previous && distance(raw, previous.point) < jump * .45 ? { ...previous, point: raw, count: previous.count + 1 } : { point: raw, since: frame.at, count: 1 };
      if (this.outlier.count < 3 || frame.at - this.outlier.since < 180) {
        if (this.entry?.target === null) this.entry = null;
        return result('hold');
      }
      this.history = [];
    } else this.outlier = null;

    this.history.push(raw);
    this.history = this.history.slice(-3);
    const middle = Math.floor(this.history.length / 2);
    const median = { x: this.history.map(p => p.x).sort((a, b) => a - b)[middle], y: this.history.map(p => p.y).sort((a, b) => a - b)[middle] };
    if (!this.point) this.point = median;
    else {
      const elapsed = Math.max(1, Math.min(100, frame.at - this.lastAcceptedAt));
      const alpha = 1 - Math.exp(-elapsed / 240);
      const length = distance(this.point, median);
      const step = Math.min(alpha, length ? elapsed * 1.2 / length : 1);
      this.point = { x: this.point.x + (median.x - this.point.x) * step, y: this.point.y + (median.y - this.point.y) * step };
    }
    this.lastAcceptedAt = frame.at;
    const filtered = this.point;

    if (this.active) {
      const region = this.regions.find(item => item.rect.id === this.active);
      if (region && inside(raw, region, true) && inside(filtered, region, true)) {
        this.exit = null;
        return result('target');
      }
      this.exit = this.exit ? { ...this.exit, count: this.exit.count + 1 } : { target: null, since: frame.at, count: 1 };
      if (frame.at - this.exit.since < 180 || this.exit.count < 3) return result('hold');
      this.active = null;
      this.entry = null;
      this.exit = null;
    }

    const rawCandidates = this.regions.filter(region => inside(raw, region));
    const candidates = this.regions.filter(region => inside(filtered, region));
    let candidate: string | null;
    if (rawCandidates.length === 1 && candidates.length === 1 && rawCandidates[0].rect.id === candidates[0].rect.id) candidate = candidates[0].rect.id;
    else if (!rawCandidates.length && !candidates.length && !this.regions.some(region => inside(raw, region, true) || inside(filtered, region, true))) candidate = null;
    else { this.entry = null; return result('uncertain', null); }

    this.entry = this.entry && this.entry.target === candidate ? { ...this.entry, count: this.entry.count + 1 } : { target: candidate, since: frame.at, count: 1 };
    if (this.entry.count < 3 || frame.at - this.entry.since < (candidate ? 240 : 160)) return result('uncertain', null);
    this.active = candidate;
    return result(candidate ? 'target' : 'neutral', candidate);
  }
}
