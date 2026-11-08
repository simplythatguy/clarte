import { describe, expect, it } from 'vitest';
import { QUICK_TIMING, QUICK_WORKER, QuickRun, quickTargets } from '../src/lab/quick';
import { validationTargets } from '../src/lab/layout';

describe('Q8 quick calibration protocol', () => {
  it('places 8 dots at the cell centres in snake order and maps them onto the validation grid', () => {
    const v = { width: 1600, height: 1000 }, t = quickTargets(v), grid = validationTargets(v);
    expect(t).toHaveLength(8);
    expect(t.map(p => p.x / v.width)).toEqual([.125, .375, .625, .875, .875, .625, .375, .125]);
    expect(t.map(p => p.y / v.height)).toEqual([.25, .25, .25, .25, .75, .75, .75, .75]);
    expect(t.map(p => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.map(p => p.cell)).toEqual([0, 1, 2, 3, 7, 6, 5, 4]);
    expect(t.map(p => p.validationIndex)).toEqual([4, 5, 6, 7, 11, 10, 9, 8]);
    for (const p of t) { const g = grid[p.validationIndex]; expect([g.x, g.y, g.nx, g.ny, g.cell]).toEqual([p.x, p.y, p.nx, p.ny, p.cell]); }
    expect(t[7]).toMatchObject({ column: 0, row: 1, nx: -.375, ny: .25 });
  });
  it('fixes the worker options the offline budget run asked for', () => {
    expect(QUICK_WORKER).toEqual({ fixes: { freezePose: true }, limits: { maxSamples: 200, minSamples: 24, minTargets: 8 }, blend: { geometricShareMax: .2 } });
    expect(QUICK_TIMING).toEqual({ introMs: 2000, moveMs: 600, waitMs: 300, collectMs: 1000 });
  });
  it('runs a 2 s intro, then per dot 600 ms move, 300 ms wait and a 1.0 s collection window, in order, and completes after the eighth', () => {
    const run = new QuickRun(quickTargets({ width: 1600, height: 1000 }));
    expect(run.dotMs).toBe(1900); expect(run.totalMs).toBe(2000 + 8 * 1900);
    expect(run.position(0)).toBeNull();
    expect(run.start(1000)).toBe(true); expect(run.start(1000)).toBe(false);
    expect(run.classify(1000)).toEqual({ phase: 'intro', index: null, progress: 0 });
    expect(run.classify(2999)?.phase).toBe('intro');
    expect(run.classify(3000)).toMatchObject({ phase: 'move', index: 0, progress: 0 });
    expect(run.classify(3599)?.phase).toBe('move');
    expect(run.classify(3600)).toMatchObject({ phase: 'wait', index: 0 });
    expect(run.classify(3899)?.phase).toBe('wait');
    expect(run.classify(3900)).toMatchObject({ phase: 'collect', index: 0, progress: 0 });
    expect(run.classify(4400)?.progress).toBeCloseTo(.5);
    expect(run.classify(4400)).toBeNull(); // the same frame time is never classified twice
    expect(run.classify(4899)).toMatchObject({ phase: 'collect', index: 0 });
    expect(run.classify(4900)).toMatchObject({ phase: 'move', index: 1, progress: 0 });
    // Dot k's collection window is [3000 + k·1900 + 900, 3000 + k·1900 + 1900).
    for (let k = 0; k < 8; k++) expect(run.position(3000 + k * 1900 + 900)).toMatchObject({ phase: 'collect', index: k, progress: 0 });
    expect(run.position(1000 + run.totalMs - 1)).toMatchObject({ phase: 'collect', index: 7 });
    run.tick(1000 + run.totalMs - 1); expect(run.state).toMatchObject({ kind: 'running' });
    run.tick(1000 + run.totalMs); expect(run.state).toEqual({ kind: 'collected' });
    expect(run.position(1000 + run.totalMs)).toBeNull();
    expect(run.beginTraining()).toBe(true); expect(run.state).toEqual({ kind: 'training' });
    expect(run.finishTraining()).toBe(true); expect(run.state).toEqual({ kind: 'complete' });
  });
  it('pauses and restarts the current dot from its move phase on resume, skipping the intro', () => {
    const run = new QuickRun(quickTargets({ width: 1600, height: 1000 }));
    run.start(0);
    expect(run.position(2000 + 3 * 1900 + 1200)).toMatchObject({ phase: 'collect', index: 3 });
    expect(run.pause(2000 + 3 * 1900 + 1200)).toBe(true); expect(run.state).toEqual({ kind: 'paused', index: 3 });
    expect(run.position(2000 + 3 * 1900 + 1300)).toBeNull();
    expect(run.start(50000)).toBe(true);
    expect(run.position(50000)).toMatchObject({ phase: 'move', index: 3, progress: 0 });
    expect(run.position(50000 + 900)).toMatchObject({ phase: 'collect', index: 3 });
    run.tick(50000 + 5 * 1900); expect(run.state).toEqual({ kind: 'collected' });
    const early = new QuickRun(quickTargets({ width: 1600, height: 1000 }));
    early.start(0); early.pause(500); expect(early.state).toEqual({ kind: 'paused', index: 0 });
    early.fail('too few labels'); expect(early.state).toEqual({ kind: 'failed', reason: 'too few labels' });
  });
});
