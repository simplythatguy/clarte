import type { Segment, Voice } from './api';

// Mirrors server/clarte_voice/curate.py. ElevenLabs recommends one to two
// minutes of clean speech for an instant voice clone.
export const TRACK_S = 120;
export const RECOMMENDED_S = 60;
export const MIN_REFERENCE_S = 10;
const GAP_S = 0.25;

export interface StripBlock {
  n: number;
  left: number; // 0..1 of the two-minute track
  width: number; // 0..1
  quality: number;
}

export function stripBlocks(voice: Pick<Voice, 'segments' | 'reference'>): StripBlock[] {
  const byN = new Map<number, Segment>(voice.segments.map((s) => [s.n, s]));
  const blocks: StripBlock[] = [];
  let t = 0;
  for (const n of voice.reference.segments) {
    const segment = byN.get(n);
    if (!segment || t >= TRACK_S) continue;
    const duration = Math.min(segment.duration, TRACK_S - t);
    blocks.push({ n, left: t / TRACK_S, width: duration / TRACK_S, quality: segment.quality });
    t += duration + GAP_S;
  }
  return blocks;
}

/** Seconds of speech a selection would give. */
export function selectedSeconds(segments: Segment[], selected: Iterable<number>): number {
  const chosen = new Set(selected);
  const picked = segments.filter((s) => chosen.has(s.n));
  if (!picked.length) return 0;
  return picked.reduce((sum, s) => sum + s.duration, 0) + GAP_S * (picked.length - 1);
}

/** Best-first order for a manual selection, as the service would assemble it. */
export function bestFirst(segments: Segment[], selected: Iterable<number>): number[] {
  const chosen = new Set(selected);
  return segments
    .filter((s) => chosen.has(s.n))
    .sort((a, b) => b.quality - a.quality)
    .map((s) => s.n);
}
