import { describe, expect, it } from 'vitest';
import { BLOCKS, BLOCK_TIMING, BlockRun, blockSeed } from '../src/lab/protocol';
import { COLUMNS, ROWS, cellOf, cmPerCssPx, seededRandom, shuffle, validationTargets } from '../src/lab/layout';

describe('validation layout', () => {
  it('places 16 targets at the specified columns and rows with 4×2 cells', () => {
    const v = { width: 1600, height: 1000 }, t = validationTargets(v);
    expect(t).toHaveLength(16);
    expect(t.map(p => p.x / v.width)).toEqual(ROWS.flatMap(() => [...COLUMNS]));
    expect(t.map(p => p.y / v.height)).toEqual(ROWS.flatMap(r => COLUMNS.map(() => r)));
    expect(t.map(p => p.cell)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7]);
    expect(t[5]).toMatchObject({ index: 5, column: 1, row: 1, nx: -.125, ny: -.25 });
    expect(cellOf({ x: -1, y: 10 }, v)).toBeNull(); expect(cellOf({ x: 1599, y: 999 }, v)).toBe(7);
  });
  it('derives cm per CSS px from the diagonal and the physical pixel grid', () => {
    // 14.2" 3024×1964 at dpr 2 (a 14" MacBook Pro): 3604 physical px diagonal → 0.01 cm per physical px → 0.02 cm per CSS px.
    expect(cmPerCssPx(14.2, { width: 1512, height: 982 }, 2)).toBeCloseTo(14.2 * 2.54 / Math.hypot(3024, 1964) * 2, 6);
    expect(cmPerCssPx(0, { width: 1512, height: 982 }, 2)).toBeNaN();
  });
  it('shuffles reproducibly from a seed', () => {
    const a = shuffle([0, 1, 2, 3, 4, 5, 6, 7], seededRandom(42)), b = shuffle([0, 1, 2, 3, 4, 5, 6, 7], seededRandom(42)), c = shuffle([0, 1, 2, 3, 4, 5, 6, 7], seededRandom(43));
    expect(a).toEqual(b); expect(a).not.toEqual(c); expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(blockSeed(1, 'B1')).not.toBe(blockSeed(1, 'B2')); expect(blockSeed(1, 'B1')).toBe(blockSeed(1, 'B1'));
  });
});

describe('block protocol', () => {
  it('lists the thirteen blocks with one instruction line each and only B13 optional', () => {
    expect(BLOCKS.map(b => b.id)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13']);
    expect(BLOCKS.filter(b => b.optional).map(b => b.id)).toEqual(['B13']);
    for (const b of BLOCKS) expect(b.instruction.split('\n')).toHaveLength(1);
  });
  it('runs 0.9 s travel then 1.6 s record per dot, in a seeded random order, and completes after the last dot', () => {
    const run = new BlockRun(BLOCKS[0], 16, 7);
    expect([...run.order].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(run.order).not.toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(run.start(1000)).toBe(true);
    expect(run.classify(1000)).toMatchObject({ index: 0, target: run.order[0], phase: 'travel', progress: 0 });
    expect(run.classify(1899)?.phase).toBe('travel');
    expect(run.classify(1900)).toMatchObject({ phase: 'record', progress: 0 });
    expect(run.classify(2700)?.progress).toBeCloseTo(.5);
    expect(run.classify(2700)).toBeNull(); // the same frame time is never classified twice
    run.tick(1000 + BLOCK_TIMING.travelMs + BLOCK_TIMING.recordMs + 10);
    expect(run.state).toMatchObject({ kind: 'running', index: 1 });
    expect(run.classify(1000 + 2500 + 10)).toMatchObject({ index: 1, target: run.order[1], phase: 'travel' });
    run.tick(1000 + 16 * 2500);
    expect(run.state).toEqual({ kind: 'complete' });
    expect(run.position(1000 + 16 * 2500)).toBeNull();
  });
  it('pauses and restarts the current dot from travel on resume', () => {
    const run = new BlockRun(BLOCKS[1], 16, 3);
    run.start(0); run.tick(2500 * 3 + 1200); // dot 3, in its record window
    expect(run.position(2500 * 3 + 1200)?.phase).toBe('record');
    expect(run.pause()).toBe(true); expect(run.state).toEqual({ kind: 'paused', index: 3 });
    expect(run.position(2500 * 3 + 1300)).toBeNull();
    expect(run.start(20000)).toBe(true);
    expect(run.position(20000)).toMatchObject({ index: 3, phase: 'travel' });
  });
});
