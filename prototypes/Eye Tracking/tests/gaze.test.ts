import { describe, expect, it } from 'vitest';
import { GazeResolver, type GazeLayout, type ResolvedGaze } from '../src/core/gaze';
import { initialDwell, stepDwell, type DwellState } from '../src/core/dwell';

const layout: GazeLayout = { viewport: { width: 1000, height: 700 }, targets: [
  { id: 'yes', left: 100, right: 450, top: 100, bottom: 300 },
  { id: 'no', left: 500, right: 850, top: 100, bottom: 300 },
] };
const point = { x: 280, y: 200 };
function fixture() {
  const resolver = new GazeResolver();
  let now = 0;
  let dwell: DwellState = initialDwell;
  const selections: string[] = [];
  const sample = (x: number, y: number, options: { face?: boolean; at?: number; geometry?: GazeLayout } = {}) => {
    now += 100;
    const frame = { point: { x, y }, at: options.at ?? now, face: options.face ?? true, pose: null, facePresent: true, eyeState: 'open' as const };
    const result = resolver.sample(frame, options.geometry ?? layout, now);
    if (result.layoutChanged) dwell = initialDwell;
    const next = result.kind === 'target' || result.kind === 'neutral'
      ? stepDwell(dwell, { type: 'sample', target: result.target, at: frame.at, now }, 2400)
      : stepDwell(dwell, (result.kind === 'duplicate' || (result.kind === 'hold' && dwell.kind !== 'rearming')) ? { type: 'tick', now } : { type: 'lost' }, 2400);
    dwell = next.state;
    if (next.selected) selections.push(next.selected);
    return result;
  };
  const rest = (x: number, y: number, count = 20) => {
    let result: ResolvedGaze = sample(x, y);
    for (let i = 1; i < count; i++) result = sample(x, y);
    return result;
  };
  return { resolver, sample, rest, selections, get dwell() { return dwell; } };
}

describe('local temporal filter and bounded target geometry', () => {
  it('steadies boundary jitter while retaining a single target', () => {
    const f = fixture();
    f.rest(300, 600, 8);
    f.rest(440, 200);
    const positions: number[] = [];
    for (let i = 0; i < 35; i++) {
      const result = f.sample(i % 2 ? 454 : 432, 200 + (i % 3 - 1) * 9);
      expect(result.kind).toBe('target');
      expect(result.target).toBe('yes');
      if (result.point) positions.push(result.point.x);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(22);
    expect(f.selections).toEqual(['yes']);
  });
  it('does not jump to or select a second target on one distant outlier', () => {
    const f = fixture();
    f.rest(point.x, point.y);
    const before = f.sample(point.x, point.y);
    const outlier = f.sample(760, 200);
    expect(outlier.kind).toBe('hold');
    expect(outlier.point).toEqual(before.point);
    expect(f.sample(point.x, point.y)).toMatchObject({ kind: 'target', target: 'yes' });
    expect(f.selections).toEqual([]);
  });
  it('follows a sustained deliberate switch with bounded per-frame movement and entry evidence', () => {
    const f = fixture();
    f.rest(point.x, point.y);
    expect(f.sample(750, 200).kind).toBe('hold');
    expect(f.sample(750, 200).kind).toBe('hold');
    let previous = point.x;
    let final: ResolvedGaze | undefined;
    for (let i = 0; i < 25; i++) {
      final = f.sample(750, 200);
      if (final.point) {
        expect(Math.abs(final.point.x - previous)).toBeLessThanOrEqual(120);
        previous = final.point.x;
      }
    }
    expect(final).toMatchObject({ kind: 'target', target: 'no' });
  });
  it('keeps a real neutral corridor, requires neutral rearm and never repeats a resting selection', () => {
    const f = fixture();
    f.rest(475, 200, 10);
    expect(f.dwell.kind).toBe('idle');
    f.rest(300, 200, 45);
    expect(f.selections).toEqual(['yes']);
    f.rest(300, 200, 50);
    f.rest(650, 200, 50);
    expect(f.selections).toEqual(['yes']);
    expect(f.rest(475, 200, 30).kind).toBe('neutral');
    expect(f.dwell.kind).toBe('idle');
    f.rest(650, 200, 45);
    expect(f.selections).toEqual(['yes', 'no']);
  });
  it('never turns duplicate, stale, lost, future or off-viewport input into dwell progress', () => {
    const f = fixture();
    f.rest(300, 600, 10);
    f.rest(300, 200, 22);
    expect(f.selections).toEqual([]);
    for (let i = 0; i < 20; i++) f.sample(300, 200, { at: 3200 });
    expect(f.selections).toEqual([]);
    expect(f.dwell.kind).not.toBe('dwelling');
    expect(f.sample(300, 200, { face: false }).kind).toBe('lost');
    expect(f.sample(300, 200, { at: 10000 }).kind).toBe('lost');
    expect(f.sample(-10, 200).kind).toBe('lost');
  });
  it('resets filter and evidence on layout and mode changes', () => {
    const f = fixture();
    f.rest(point.x, point.y);
    const moved = { ...layout, targets: [{ ...layout.targets[0], left: 600, right: 950 }] };
    const changed = f.sample(point.x, point.y, { geometry: moved });
    expect(changed.layoutChanged).toBe(true);
    expect(changed.target).toBeNull();
    f.resolver.reset();
    const afterReset = f.sample(750, 200, { geometry: moved });
    expect(afterReset.point).toEqual({ x: 750, y: 200 });
    expect(afterReset.kind).toBe('uncertain');
    expect(afterReset.target).toBeNull();
  });
  it('ambiguous overlapping target regions do not become neutral or select a nearest target', () => {
    const resolver = new GazeResolver();
    const overlap = { ...layout, targets: [layout.targets[0], { ...layout.targets[1], left: 200 }] };
    for (let at = 100; at <= 4000; at += 100) expect(resolver.sample({ point, face: true, at, pose: null, facePresent: true, eyeState: 'open' as const }, overlap, at).kind).toBe('uncertain');
  });
});
