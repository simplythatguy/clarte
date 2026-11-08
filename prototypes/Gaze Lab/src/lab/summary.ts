import type { Point, Viewport } from '../core/tracking';
import { cellOf, type Target } from './layout';
import { median, medianOffset, percentile, type HeadOffset, type HeadReference } from './head';
import type { FrameRow } from './frames';

export const ESTIMATORS = ['network', 'geometric', 'blend', 'normPog', 'pointer', 'candidate'] as const;
/** The quick-calibration shadow worker's streams; summarised only in quick sessions, so default summaries are unchanged. */
export const QUICK_ESTIMATORS = ['quickBlend', 'quickNetwork'] as const;
export type EstimatorName = typeof ESTIMATORS[number] | typeof QUICK_ESTIMATORS[number];
export const ESTIMATOR_LABELS: Record<EstimatorName, string> = { network: 'network', geometric: 'geometric', blend: 'blend (shipped)', normPog: 'normPog', pointer: 'pointer (One Euro)', candidate: 'candidate', quickBlend: 'quick blend', quickNetwork: 'quick network' };
export const estimatorLabels = (names: readonly EstimatorName[]): Partial<Record<EstimatorName, string>> => Object.fromEntries(names.map(n => [n, ESTIMATOR_LABELS[n]]));
export type Stats = {
  frames: number;
  medianPx: number; medianAbsDxPx: number; medianAbsDyPx: number; biasDxPx: number; biasDyPx: number; p90Px: number; p90DxPx: number; p90DyPx: number;
  medianCm: number | null; medianAbsDxCm: number | null; medianAbsDyCm: number | null;
};
export type BlockSummary = {
  block: string; frames: { total: number; record: number; used: number };
  /** The shipped estimators always; the quick ones only when the session asked for them. */
  estimators: Record<typeof ESTIMATORS[number], Stats | null> & Partial<Record<typeof QUICK_ESTIMATORS[number], Stats | null>>;
  /** 4×2 cell hit-rate from each dot's record-phase median of the shipped blend. */
  cellHit: { hits: number; points: number };
  headShift: (HeadOffset & { samples: number }) | null;
  cameraMoved: number;
};

/** Record-phase frames with a face present and eyes open: the only frames any number here counts. */
export const usable = (r: FrameRow) => r.phase === 'record' && r.facePresent && r.eyeState === 'open';

function estimatePx(row: FrameRow, name: EstimatorName): Point | null {
  const v = row.viewport;
  const norm = (p: number[] | null | undefined): Point | null => (p && p.length === 2 && p.every(Number.isFinite) ? { x: (p[0] + .5) * v.width, y: (p[1] + .5) * v.height } : null);
  switch (name) {
    case 'network': return norm(row.network);
    case 'geometric': return norm(row.geometric);
    case 'blend': return norm(row.rawNormPog);
    case 'normPog': return norm(row.normPog);
    case 'pointer': return row.pointer && row.pointer.length === 2 ? { x: row.pointer[0], y: row.pointer[1] } : null;
    case 'candidate': return norm(row.candidate?.final);
    case 'quickBlend': return norm(row.quick?.rawNormPog);
    case 'quickNetwork': return norm(row.quick?.network);
  }
}

function stats(pairs: { p: Point; t: Point }[], cmPerPx: number | null): Stats | null {
  if (!pairs.length) return null;
  const dx = pairs.map(q => q.p.x - q.t.x), dy = pairs.map(q => q.p.y - q.t.y), d = dx.map((x, i) => Math.hypot(x, dy[i]));
  const adx = dx.map(Math.abs), ady = dy.map(Math.abs);
  const cm = (px: number) => (cmPerPx ? px * cmPerPx : null);
  const medianPx = median(d), medianAbsDxPx = median(adx), medianAbsDyPx = median(ady);
  return { frames: pairs.length, medianPx, medianAbsDxPx, medianAbsDyPx, biasDxPx: median(dx), biasDyPx: median(dy), p90Px: percentile(d, .9), p90DxPx: percentile(adx, .9), p90DyPx: percentile(ady, .9), medianCm: cm(medianPx), medianAbsDxCm: cm(medianAbsDxPx), medianAbsDyCm: cm(medianAbsDyPx) };
}

export function summarizeBlock(blockId: string, rows: readonly FrameRow[], targets: readonly Target[], viewport: Viewport, cmPerPx: number | null, reference: HeadReference | null, names: readonly EstimatorName[] = ESTIMATORS): BlockSummary {
  const own = rows.filter(r => r.block === blockId && r.screen === 'block');
  const record = own.filter(r => r.phase === 'record'), used = record.filter(usable);
  const targetOf = (r: FrameRow): Point | null => (r.target ? { x: r.target.x, y: r.target.y } : null);
  const estimators = Object.fromEntries([...ESTIMATORS, ...names.filter(n => !(ESTIMATORS as readonly string[]).includes(n))].map(name => [name, stats(used.flatMap(r => { const p = estimatePx(r, name), t = targetOf(r); return p && t ? [{ p, t }] : []; }), cmPerPx)])) as BlockSummary['estimators'];
  // Cell hit-rate: each dot's record-phase median blend estimate must land in the dot's 4×2 cell.
  let hits = 0, points = 0;
  for (const target of targets) {
    const ps = used.filter(r => r.point === target.index).map(r => estimatePx(r, 'blend')).filter((p): p is Point => p !== null);
    if (!ps.length) continue;
    points++;
    const cell = cellOf({ x: median(ps.map(p => p.x)), y: median(ps.map(p => p.y)) }, viewport);
    if (cell === target.cell) hits++;
  }
  const headShift = reference ? medianOffset(used.filter(r => r.faceOrigin3D).map(r => ({ origin: r.faceOrigin3D!, faceRt: r.faceRt })), reference) : null;
  return { block: blockId, frames: { total: own.length, record: record.length, used: used.length }, estimators, cellHit: { hits, points }, headShift, cameraMoved: own.filter(r => r.camera?.moved).length };
}

export const fmtPx = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v)));
export const fmtCm = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));
