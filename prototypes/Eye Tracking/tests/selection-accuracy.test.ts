import { describe, expect, it } from 'vitest';
import type { GazeLayout } from '../src/core/gaze';
import { TargetSnapper } from '../src/core/target-snap';
import { IDENTITY, SelectionLearning } from '../src/core/selection-learning';

// Same proportions as the navigation grid: 1fr 2fr 1fr columns, 1fr 2.25fr 1fr rows, 20px gaps.
const viewport = { width: 1000, height: 800 };
const cols = [[40, 255], [275, 725], [745, 960]], rows = [[76, 238], [258, 622], [642, 776]];
const names = [['top-left', 'top', 'top-right'], ['left', 'center', 'right'], ['bottom-left', 'bottom', 'bottom-right']];
const layout: GazeLayout = { viewport, targets: rows.flatMap(([top, bottom], r) => cols.map(([left, right], c) => ({ id: names[r][c], left, right, top, bottom }))) };
const rect = (id: string) => layout.targets.find(t => t.id === id)!;
const centre = (id: string) => { const t = rect(id); return { x: (t.left + t.right) / 2, y: (t.top + t.bottom) / 2 }; };

describe('TargetSnapper', () => {
  it('resolves gaps, the outer margin and small overshoot to the nearest target', () => {
    expect(new TargetSnapper().resolve({ x: 265, y: 400 }, layout)).toBe('left');
    expect(new TargetSnapper().resolve({ x: 500, y: 20 }, layout)).toBe('top');
    expect(new TargetSnapper().resolve({ x: 500, y: -60 }, layout)).toBe('top');
    expect(new TargetSnapper().resolve({ x: 990, y: 790 }, layout)).toBe('bottom-right');
  });

  it('treats estimates well past the screen, or missing, as looking away', () => {
    const snapper = new TargetSnapper();
    expect(snapper.resolve({ x: 500, y: -200 }, layout)).toBeNull();
    expect(snapper.resolve(null, layout)).toBeNull();
    expect(snapper.resolve({ x: NaN, y: 1 }, layout)).toBeNull();
    const sparse: GazeLayout = { viewport, targets: [rect('top')] };
    expect(new TargetSnapper().resolve({ x: 500, y: 600 }, sparse)).toBeNull();
  });

  it('stays on the current target near a border until another is clearly closer', () => {
    const snapper = new TargetSnapper();
    for (let i = 0; i < 3; i++) expect(snapper.resolve({ x: 500, y: 200 }, layout)).toBe('top');
    // 27px into the centre target (47px from the top one) is within the hysteresis band.
    for (let i = 0; i < 3; i++) expect(snapper.resolve({ x: 500, y: 285 }, layout)).toBe('top');
    // A deliberate move switches once the 3-frame median follows it.
    snapper.resolve({ x: 500, y: 400 }, layout);
    expect(snapper.resolve({ x: 500, y: 400 }, layout)).toBe('center');
  });

  it('ignores a single outlying estimate', () => {
    const snapper = new TargetSnapper();
    snapper.resolve({ x: 500, y: 400 }, layout); snapper.resolve({ x: 500, y: 410 }, layout);
    expect(snapper.resolve({ x: 900, y: 120 }, layout)).toBe('center');
  });

  it('keeps the target across a blink but uses only post-blink evidence', () => {
    const snapper = new TargetSnapper();
    for (let i = 0; i < 3; i++) snapper.resolve({ x: 150, y: 400 }, layout);
    expect(snapper.resolve(null, layout)).toBeNull();
    expect(snapper.resolve({ x: 600, y: 400 }, layout)).toBe('center');
  });
});

describe('SelectionLearning', () => {
  const around = (p: { x: number; y: number }) => [-6, -3, 0, 3, 6].map(d => ({ x: p.x + d, y: p.y - d }));

  it('starts as identity and needs enough estimates', () => {
    const learning = new SelectionLearning();
    expect(learning.transform).toBe(IDENTITY);
    expect(learning.learn([{ x: 1, y: 1 }], rect('center'), viewport)).toBe(false);
    expect(learning.count).toBe(0);
  });

  it('learns a consistent offset and corrects toward target centres', () => {
    const learning = new SelectionLearning();
    const bias = { x: 0, y: 90 };
    for (const id of ['top', 'top', 'top', 'center', 'top']) learning.learn(around({ x: centre(id).x + bias.x, y: centre(id).y + bias.y }), rect(id), viewport);
    const corrected = learning.apply({ x: centre('top').x, y: centre('top').y + bias.y }, viewport);
    expect(Math.abs(corrected.y - centre('top').y)).toBeLessThan(35);
  });

  it('fits scale once selections span several targets', () => {
    const learning = new SelectionLearning();
    // Estimates compressed toward the screen centre, a common webcam failure.
    const squash = (p: { x: number; y: number }) => ({ x: 500 + (p.x - 500) * .6, y: 400 + (p.y - 400) * .6 });
    for (const id of ['top', 'bottom', 'left', 'right', 'top-left', 'bottom-right', 'center', 'top', 'bottom']) learning.learn(around(squash(centre(id))), rect(id), viewport);
    expect(learning.transform[0]).toBeGreaterThan(1.3);
    expect(learning.transform[4]).toBeGreaterThan(1.3);
    const corrected = learning.apply(squash(centre('top-right')), viewport);
    expect(corrected.x).toBeGreaterThan(rect('top-right').left);
    expect(corrected.y).toBeLessThan(rect('top-right').bottom);
  });

  it('rejects a confirmation far from where the estimates were', () => {
    const learning = new SelectionLearning();
    expect(learning.learn(around(centre('bottom-right')), rect('top-left'), viewport)).toBe(false);
  });

  it('clips corrected navigation points to the screen and resets', () => {
    const learning = new SelectionLearning();
    for (let i = 0; i < 6; i++) learning.learn(around({ x: centre('top').x, y: centre('top').y + 150 }), rect('top'), viewport);
    const frame = learning.correct({ point: { x: 500, y: 10 }, rawPoint: { x: 500, y: 10 }, face: true, facePresent: true, eyeState: 'open', at: 1, pose: null }, viewport);
    expect(frame.point!.y).toBe(0);
    expect(frame.rawPoint!.y).toBeLessThan(0);
    learning.reset();
    expect(learning.transform).toBe(IDENTITY);
  });
});
