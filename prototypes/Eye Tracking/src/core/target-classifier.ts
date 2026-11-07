import type { Point, Viewport } from './tracking';
import type { GazeLayout, TargetRect } from './gaze';
import type { CorrectionReport } from './calibration-models';

export const CLASSIFIER = {
  /** Tracker noise σ as a fraction of the viewport's shorter side, until a check measures it. */
  defaultNoise: .06,
  /** Bounds on a measured σ, as fractions of the shorter side. */
  noiseRange: [.02, .15] as const,
  /**
   * How long attention tends to stay put, in ms: between two frames dt apart the chance of staying
   * on the current hypothesis is exp(-dt / holdMs) (≈ 0.9 at 30 frames per second). Time-based, so
   * a 100 ms glance counts the same whatever the camera's frame rate.
   */
  holdMs: 300,
  /** Frame spacing assumed when no timestamp is given, and the bounds on a measured spacing. */
  frameMs: 1000 / 30, frameRange: [5, 500] as const,
  /** Prior share of "looking away"; the targets share the rest equally. */
  away: .2,
  /** Share of estimates that are junk (a glance, a glitch) and can land anywhere on screen. */
  outliers: .05,
  /** Estimates this far past the screen edge, as a fraction of each side, count as looking away. */
  edgeSlack: .15,
  /** Posterior needed before a new target replaces the current one. */
  confidence: .85,
  /**
   * Posterior of "looking away" needed to drop the current target. Lower than `confidence` on
   * purpose: wrongly dropping a target costs another look, wrongly keeping one could select it.
   */
  release: .5,
  /** On the first frame after a blink, the favoured answer needs this posterior, or the result is "unsure". */
  reopening: .5,
  /** A check is trusted only if an affine correction leaves less than this share of the shorter side as error. */
  trustedCheck: .1,
};

/**
 * What a finished free-flow check can personalize: reference pairs to seed drift correction and
 * the tracker noise left after it. Null when the check does not look like someone following the
 * dot (too few references, or an error no affine correction explains), so a bad run changes nothing.
 */
export function personalizationFromCheck(report: CorrectionReport | null, viewport: Viewport): { pairs: { estimate: Point; target: Point }[]; sigmaPx: number } | null {
  if (!report) return null;
  const affine = report.scores.find(s => s.model === 'affine')?.medianPx ?? null;
  if (affine === null || !(affine >= 0) || affine > Math.min(viewport.width, viewport.height) * CLASSIFIER.trustedCheck) return null;
  // For 2D Gaussian noise the median error radius is 1.1774 σ.
  return { pairs: report.offsets.map(o => ({ estimate: { x: o.target.x + o.dx, y: o.target.y + o.dy }, target: { ...o.target } })), sigmaPx: affine / 1.1774 };
}

export type Classification = { target: string | null; confidence: number };
const AWAY = '\u0000away';

/** Upper-tail normal probability Q(x) = P(Z > x), accurate in the far tail (Abramowitz–Stegun 7.1.26). */
function upperTail(x: number): number {
  if (x < 0) return 1 - upperTail(-x);
  const z = x / Math.SQRT2, t = 1 / (1 + .3275911 * z);
  const poly = t * (.254829592 + t * (-.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return .5 * poly * Math.exp(-z * z);
}
/** P(a < Z < b), computed from whichever tail keeps precision. */
function between(a: number, b: number): number {
  if (a >= 0) return Math.max(0, upperTail(a) - upperTail(b));
  if (b <= 0) return Math.max(0, upperTail(-b) - upperTail(-a));
  return Math.max(0, 1 - upperTail(-a) - upperTail(b));
}

/**
 * Density of an estimate when the person looks somewhere inside `rect` (uniformly) and the tracker
 * adds Gaussian noise σ: the rectangle blurred by the noise. Exact for that model.
 */
export function rectDensity(p: Point, rect: TargetRect, sigma: number): number {
  const area = (rect.right - rect.left) * (rect.bottom - rect.top);
  if (!(area > 0) || !(sigma > 0)) return 0;
  return between((rect.left - p.x) / sigma, (rect.right - p.x) / sigma) * between((rect.top - p.y) / sigma, (rect.bottom - p.y) / sigma) / area;
}

/**
 * Decides which target the person is looking at, rather than trusting the exact pointer.
 * A hidden Markov model over the targets plus "looking away": each frame's estimate updates a
 * belief, so a steady look wins within a few frames, a single stray estimate does not flip the
 * answer, and the current target is kept until another is clearly more likely.
 */
export class TargetClassifier {
  private belief = new Map<string, number>();
  private layoutKey = '';
  private current: string | null = null;
  private sigmaPx: number | null = null;
  /** Evidence was just dropped (a blink): the next frame must stand on its own. */
  private fresh = false;
  private lastAt: number | null = null;

  /** Measured tracker noise in px (e.g. from the free-flow check); null restores the default. */
  setNoise(sigmaPx: number | null): void { this.sigmaPx = sigmaPx !== null && Number.isFinite(sigmaPx) && sigmaPx > 0 ? sigmaPx : null; }

  reset(): void { this.belief.clear(); this.current = null; this.fresh = false; this.lastAt = null; }

  sigma(layout: GazeLayout): number {
    const side = Math.min(layout.viewport.width, layout.viewport.height), [lo, hi] = CLASSIFIER.noiseRange;
    return Math.min(side * hi, Math.max(side * lo, this.sigmaPx ?? side * CLASSIFIER.defaultNoise));
  }

  /**
   * A missing or non-finite estimate (closed eyes, no face) keeps the current answer but drops the
   * accumulated evidence, so after a blink the target is re-identified from fresh open-eye frames.
   */
  classify(point: Point | null | undefined, layout: GazeLayout, at?: number): Classification {
    const key = JSON.stringify(layout.targets);
    if (key !== this.layoutKey) { this.layoutKey = key; this.reset(); }
    if (!layout.targets.length) { this.reset(); return { target: null, confidence: 0 }; }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { this.belief.clear(); this.fresh = true; return { target: this.current, confidence: 0 }; }

    const { width, height } = layout.viewport, sx = width * CLASSIFIER.edgeSlack, sy = height * CLASSIFIER.edgeSlack;
    if (point.x < -sx || point.y < -sy || point.x > width + sx || point.y > height + sy) {
      this.reset(); this.belief.set(AWAY, 1);
      return { target: null, confidence: 1 };
    }
    const ids = [AWAY, ...layout.targets.map(t => t.id)];
    const prior = (id: string) => (id === AWAY ? CLASSIFIER.away : (1 - CLASSIFIER.away) / layout.targets.length);
    if (!this.belief.size) for (const id of ids) this.belief.set(id, prior(id));

    const [minDt, maxDt] = CLASSIFIER.frameRange;
    const dt = at !== undefined && Number.isFinite(at) && this.lastAt !== null ? Math.min(maxDt, Math.max(minDt, at - this.lastAt)) : CLASSIFIER.frameMs;
    if (at !== undefined && Number.isFinite(at)) this.lastAt = at;
    const stay = Math.exp(-dt / CLASSIFIER.holdMs);
    const uniform = 1 / ((width + 2 * sx) * (height + 2 * sy)), sigma = this.sigma(layout);
    const likelihood = (id: string) => {
      if (id === AWAY) return uniform;
      const rect = layout.targets.find(t => t.id === id)!;
      return (1 - CLASSIFIER.outliers) * rectDensity(point, rect, sigma) + CLASSIFIER.outliers * uniform;
    };
    let total = 0;
    const next = new Map<string, number>();
    for (const id of ids) {
      const value = (stay * (this.belief.get(id) ?? 0) + (1 - stay) * prior(id)) * likelihood(id);
      next.set(id, value); total += value;
    }
    if (!(total > 0) || !Number.isFinite(total)) { this.reset(); return { target: null, confidence: 0 }; }
    for (const id of ids) next.set(id, next.get(id)! / total);
    this.belief = next;

    let best = AWAY;
    for (const id of ids) if (next.get(id)! > next.get(best)!) best = id;
    const confidence = next.get(best)!, answer = best === AWAY ? null : best;
    if (this.fresh) {
      // Reopening after a blink: this fresh frame alone decides; the held target gets no benefit of the doubt.
      this.fresh = false;
      this.current = confidence >= CLASSIFIER.reopening ? answer : null;
    } else if (answer === null ? confidence >= CLASSIFIER.release : confidence >= CLASSIFIER.confidence) this.current = answer; // Hysteresis.
    return { target: this.current, confidence: this.current ? next.get(this.current)! : next.get(AWAY)! };
  }
}
