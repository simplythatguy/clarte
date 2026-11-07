import type { CorrectionModel } from './calibration-models';
import type { ValidationResult } from './validation';
import type { Viewport } from './tracking';

/** What a person sees after a free-flow check: aggregates only, no samples. */
export type CheckSummary = {
  at: number; condition: ValidationResult['condition']; viewport: Viewport;
  coverage: number; bins: number; references: number;
  medianPx: number; p90Px: number;
  models: { model: CorrectionModel; label: string; medianPx: number | null; p90Px: number | null; best: boolean }[];
  offsets: { x: number; y: number; dx: number; dy: number; samples: number }[];
  bias: { dx: number; dy: number } | null;
  regions: { name: string; dx: number; dy: number; references: number }[];
  notes: string[];
};
export const MODEL_LABELS: Record<CorrectionModel, string> = {
  none: 'No correction', affine: 'Affine (current)', 'ransac-affine': 'Affine, robust', quadratic: 'Quadratic', 'thin-plate': 'Thin-plate spline',
};
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const px = (v: number) => `${Math.round(Math.abs(v))} px`;

export function summarizeCheck(result: ValidationResult, at: number): CheckSummary | null {
  if (result.kind !== 'measured') return null;
  const { corrections } = result;
  const scores = corrections?.scores ?? [];
  const measured = scores.filter(s => s.medianPx !== null) as { model: CorrectionModel; medianPx: number; p90Px: number }[];
  const best = measured.length ? measured.reduce((a, b) => (b.medianPx < a.medianPx ? b : a)) : null;
  const models = scores.map(s => ({ model: s.model, label: MODEL_LABELS[s.model], medianPx: s.medianPx, p90Px: s.p90Px, best: best?.model === s.model }));
  const offsets = corrections?.offsets.map(o => ({ x: o.target.x, y: o.target.y, dx: o.dx, dy: o.dy, samples: o.samples })) ?? [];
  const bias = offsets.length ? { dx: median(offsets.map(o => o.dx)), dy: median(offsets.map(o => o.dy)) } : null;
  const { width, height } = result.viewport;
  const region = (name: string, keep: (o: typeof offsets[number]) => boolean) => { const rows = offsets.filter(keep); return { name, dx: mean(rows.map(o => o.dx)), dy: mean(rows.map(o => o.dy)), references: rows.length }; };
  const regions = offsets.length ? [
    region('Top half', o => o.y < height / 2), region('Bottom half', o => o.y >= height / 2),
    region('Left half', o => o.x < width / 2), region('Right half', o => o.x >= width / 2),
  ] : [];
  const notes: string[] = [];
  const side = Math.min(width, height);
  if (bias) {
    const parts: string[] = [];
    if (Math.abs(bias.dy) >= side * .02) parts.push(`${px(bias.dy)} ${bias.dy < 0 ? 'above' : 'below'}`);
    if (Math.abs(bias.dx) >= side * .02) parts.push(`${px(bias.dx)} to the ${bias.dx < 0 ? 'left' : 'right'}`);
    notes.push(parts.length ? `On average the pointer sits ${parts.join(' and ')} of where you look. Navigation corrects this automatically after the check.` : 'No consistent offset: the pointer is centred on where you look.');
  }
  const score = (m: CorrectionModel) => measured.find(s => s.model === m)?.medianPx ?? null;
  const affine = score('affine'), robust = score('ransac-affine'), spline = score('thin-plate'), quad = score('quadratic');
  if (affine !== null) {
    if (robust !== null && robust < affine * .85) notes.push('One reference looks spoiled (a blink or a glance away): the robust fit is clearly better.');
    const flexible = Math.min(spline ?? Infinity, quad ?? Infinity);
    if (flexible < affine * .85) notes.push('The error changes across the screen: a flexible correction would help, which needs more calibration dots.');
    else if (flexible !== Infinity) notes.push('The leftover error is the same everywhere on screen: the current correction type is enough.');
  }
  const vertical = regions.find(r => r.name === 'Top half'), lower = regions.find(r => r.name === 'Bottom half');
  if (vertical && lower && vertical.references && lower.references && Math.abs(vertical.dy - lower.dy) >= side * .05) notes.push(`The vertical offset differs between the top (${px(vertical.dy)} ${vertical.dy < 0 ? 'above' : 'below'}) and bottom (${px(lower.dy)} ${lower.dy < 0 ? 'above' : 'below'}) of the screen.`);
  if (result.p90Px > side * .25) notes.push('Errors are large and scattered. Check lighting on your face, turn off Center Stage and keep the window size fixed, then recalibrate.');
  return { at, condition: result.condition, viewport: result.viewport, coverage: result.coverage, bins: result.bins, references: corrections?.references ?? 0, medianPx: result.medianPx, p90Px: result.p90Px, models, offsets, bias, regions, notes };
}
