/**
 * Is this sound the user's own select sound? Decided per person, from their enrolment.
 *
 * A useful sound is defined by what the person recorded, not by acoustics: people with dysarthria
 * make different sounds, so there is no generic "select sound". Enrolment keeps the person's takes
 * of their sound (positives) and sounds that must not select (negatives: their own coughs and
 * words, the room, and a bank of other people's vocal sounds). A new sound is accepted when it
 *  1. passes the cheap gates the person's own takes pass (not an impact, loud enough to be them,
 *     a duration and pitch like theirs, each gate on only where their takes are consistent), and
 *  2. is closer, by dynamic time warping over cepstra, level shape and pitch, to their takes than
 *     a threshold set from their takes, and closer to them than to any negative.
 * This follows the published recipe for nonverbal sound detection with disordered speech (Lea et
 * al. 2022: negatives plus a few personal examples) and prototype matching for dysarthric wake
 * words (PB-LRDWWS, SLT 2024).
 */
import { CEPS, MEL_BANDS, cepstraOf } from './features.ts';
import type { EventStats, SoundEvent } from './events.ts';

/** One frame of the matching sequence. */
const DIMS = CEPS - 1 + 3;

/** A take, or a variant of one: `take` groups a take with its variants. */
export type Template = { seq: Float32Array[]; stats: EventStats; take?: number; source?: 'own' | 'bank' };

export type Profile = {
  version: 1;
  createdAt: number;
  positives: Template[];
  negatives: Template[];
  /** Distance below which a sound counts as the person's own. */
  threshold: number;
  /** The person's peak level: median and 10th percentile of their takes (dB). */
  level: { median: number; low: number };
  gates: Gates;
};

type Range = { min: number; max: number } | null;
type Gates = { durationMs: Range; f0: Range; voiced: number | null; impact: boolean };

export type Verdict = { accept: boolean; reason: string; distance?: number; nearestNegative?: number; negativeSource?: string };

/**
 * The matching sequence: cepstra c1..c12, level relative to the peak, pitch and voicing. The
 * cepstra come from the mel spectrum with the noise measured just before the sound subtracted
 * (spectral subtraction, with a floor), so the same sound matches itself in a quiet room and on a
 * busy street.
 */
export function sequenceOf(event: Pick<SoundEvent, 'frames' | 'noise'>): Float32Array[] {
  const peak = Math.max(...event.frames.map((f) => f.db));
  const clean = new Float32Array(MEL_BANDS);
  return event.frames.filter((f) => f.db > peak - 25).map((f) => {
    for (let m = 0; m < MEL_BANDS; m++) { const p = Math.exp(f.mel[m]); clean[m] = Math.log(Math.max(p - 1.5 * event.noise[m], 0.03 * p) + 1e-10); }
    const ceps = cepstraOf(clean);
    const v = new Float32Array(DIMS);
    for (let c = 1; c < CEPS; c++) v[c - 1] = ceps[c];
    v[CEPS - 1] = (f.db - peak) / 4;
    v[CEPS] = f.f0 > 0 ? (12 * Math.log2(f.f0 / 120)) / 3 : 0;
    v[CEPS + 1] = f.clarity * 3;
    return v;
  });
}

/** DTW distance per step between two sequences, within a band that limits tempo changes to 2×. */
export function dtw(a: Float32Array[], b: Float32Array[]): number {
  const n = a.length, m = b.length;
  if (!n || !m) return Infinity;
  if (n > 2 * m + 2 || m > 2 * n + 2) return Infinity;
  let prev = new Float64Array(m + 1).fill(Infinity), cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const lo = Math.max(1, Math.floor((i * m) / n - m / 2) - 1), hi = Math.min(m, Math.ceil((i * m) / n + m / 2) + 1);
    const ai = a[i - 1];
    for (let j = lo; j <= hi; j++) {
      const bj = b[j - 1];
      let d = 0;
      for (let k = 0; k < DIMS; k++) { const x = ai[k] - bj[k]; d += x * x; }
      d = Math.sqrt(d);
      cur[j] = d + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

const templateOf = (e: SoundEvent, take?: number): Template => ({ seq: sequenceOf(e), stats: e.stats, take });

/** Mean of the k smallest distances from a sequence to a set of templates. */
function nearest(seq: Float32Array[], set: Template[], k: number, skipTake?: number): number {
  const d = set.filter((t) => skipTake === undefined || t.take !== skipTake).map((t) => dtw(seq, t.seq)).sort((x, y) => x - y);
  if (!d.length) return Infinity;
  const take = d.slice(0, Math.min(k, d.length));
  return take.reduce((s, x) => s + x, 0) / take.length;
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

const K = 2;

/**
 * Build a profile from the person's takes of their sound (each with its variants, see
 * `augment.ts`) and from negatives (their own other sounds, the room, and an optional shipped
 * bank of other people's sounds).
 */
export function enroll(takes: SoundEvent[][], negatives: SoundEvent[], bank: Template[] = []): Profile {
  const positives = takes.flatMap((variants, take) => variants.map((e) => templateOf(e, take)));
  const negs = [...negatives.map((e): Template => ({ ...templateOf(e), source: 'own' })), ...bank.map((t): Template => ({ ...t, source: 'bank' }))];
  // Each take against the other takes (never its own variants): how far the person's sound wanders.
  const own = positives.filter((p, i) => positives.findIndex((q) => q.take === p.take) === i).map((p) => nearest(p.seq, positives, K, p.take)).filter(Number.isFinite);
  // A take's distance to the others, with the spread of the person's sound as headroom; never so
  // loose that the negatives would pass.
  const genuine = own.length ? quantile(own, 0.9) * 1.3 : Infinity;
  const impostor = negs.map((n) => nearest(n.seq, positives, K)).filter(Number.isFinite);
  const guard = impostor.length ? quantile(impostor, 0.02) : Infinity;
  const threshold = Math.min(genuine, Math.max(guard, quantile(own, 0.5) * 1.05));
  const stats = positives.map((p) => p.stats);
  const peaks = stats.map((s) => s.peakDb);
  const durations = stats.map((s) => s.durationMs);
  const voiced = stats.map((s) => s.voiced);
  const f0s = stats.filter((s) => s.f0 > 0).map((s) => s.f0);
  const consistentPitch = f0s.length >= Math.ceil(stats.length * 0.8) && quantile(f0s, 0.9) / quantile(f0s, 0.1) < 1.6;
  return {
    version: 1,
    createdAt: Date.now(),
    positives,
    negatives: negs,
    threshold,
    level: { median: quantile(peaks, 0.5), low: quantile(peaks, 0.1) },
    gates: {
      durationMs: { min: Math.min(...durations) * 0.5, max: Math.max(...durations) * 2 },
      f0: consistentPitch ? { min: Math.min(...f0s) / 1.3, max: Math.max(...f0s) * 1.3 } : null,
      voiced: Math.min(...voiced) >= 0.5 ? 0.25 : null,
      // Impacts are rejected unless the person's own sound is itself a sharp click or pop.
      impact: quantile(stats.map((s) => s.attackMs), 0.5) > 15,
    },
  };
}

/** Impacts (claps, knocks, a dropped object): a near-instant rise, short or noise-like. */
function isImpact(s: EventStats): boolean {
  return s.attackMs <= 10 && (s.durationMs < 160 || s.flatness > 0.3);
}

/** Generic judgement before anyone has enrolled: a voiced sound that is not an impact. */
export function judgeGeneric(event: SoundEvent): Verdict {
  const s = event.stats;
  // Temporarily much more sensitive for the demo video (owner, 2026-11-09). A voiced sound is never
  // an impact; only a short unvoiced burst is (was: any sharp sound under 160 ms). A voiced sound
  // needs 6 dB over the room (was 12); an unvoiced one (a whisper) 7 dB and 90 ms (was never).
  if (s.voiced < 0.3 && isImpact(s) && s.durationMs < 90) return { accept: false, reason: 'impact' };
  if (s.voiced < 0.3) {
    if (s.riseDb >= 7 && s.durationMs >= 90) return { accept: true, reason: 'whisper' };
    return { accept: false, reason: s.riseDb < 7 ? 'faint' : 'unvoiced' };
  }
  if (s.riseDb < 6) return { accept: false, reason: 'faint' };
  return { accept: true, reason: 'voiced' };
}

export type JudgeOptions = { levelMarginDb?: number; scale?: number; ratio?: number; negK?: number };

/**
 * How far past the enrolment threshold a sound may be. Measured on CNVVE (29 people, "mm-hmm" as
 * the select sound, three takes each, scenes with noise, talkers and neighbours; listen-eval.ts):
 * at 1.0 the person's sound selected 70 % of the time, at 1.3 86 %, at 1.5 90 %, while wrong
 * selections stayed at 0.26, 0.45 and 0.47 a minute of always-armed listening.
 */
export const DEFAULT_SCALE = 1.5;

/**
 * `scale` loosens (above 1) or tightens the person's threshold; `ratio` is how much nearer to
 * their takes than to the nearest negative a sound must be (1 = just nearer).
 */
export function judge(profile: Profile, event: SoundEvent, { levelMarginDb = 9, scale = DEFAULT_SCALE, ratio = 1, negK = 1 }: JudgeOptions = {}): Verdict {
  const s = event.stats;
  const g = profile.gates;
  if (g.impact && isImpact(s)) return { accept: false, reason: 'impact' };
  if (s.peakDb < profile.level.low - levelMarginDb) return { accept: false, reason: 'too quiet to be them' };
  if (event.ended && g.durationMs && (s.durationMs < g.durationMs.min || s.durationMs > g.durationMs.max)) return { accept: false, reason: 'duration' };
  if (g.voiced !== null && s.voiced < g.voiced) return { accept: false, reason: 'unvoiced' };
  if (g.f0 && s.f0 > 0 && (s.f0 < g.f0.min || s.f0 > g.f0.max)) return { accept: false, reason: 'pitch' };
  const seq = sequenceOf(event);
  const distance = nearest(seq, profile.positives, K);
  if (distance > profile.threshold * scale) return { accept: false, reason: 'not their sound', distance };
  const nearestNegative = nearest(seq, profile.negatives, negK);
  if (nearestNegative * ratio < distance) {
    const closest = profile.negatives.reduce((best, t) => { const d = dtw(seq, t.seq); return d < best.d ? { d, t } : best; }, { d: Infinity, t: profile.negatives[0] });
    return { accept: false, reason: 'closer to a negative', distance, nearestNegative, negativeSource: closest.t?.source };
  }
  return { accept: true, reason: 'their sound', distance, nearestNegative };
}
