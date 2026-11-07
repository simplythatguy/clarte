import { describe, expect, it } from 'vitest';
import type { GazeLayout } from '../src/core/gaze';
import { TargetClassifier, personalizationFromCheck, rectDensity } from '../src/core/target-classifier';
import { compareCorrections } from '../src/core/calibration-models';
import { TargetSnapper } from '../src/core/target-snap';
import { SelectionLearning } from '../src/core/selection-learning';
import { validationTargets } from '../src/core/validation';
import type { Point } from '../src/core/tracking';

// The navigation page: four columns by two rows of blank targets with 20 px gaps.
const viewport = { width: 1280, height: 800 };
const columns = [0, 1, 2, 3].map(c => [40 + c * 305, 40 + c * 305 + 285]), rows = [[76, 416], [436, 776]];
const layout: GazeLayout = { viewport, targets: rows.flatMap(([top, bottom], r) => columns.map(([left, right], c) => ({ id: `${r ? 'bottom' : 'top'}-${c + 1}`, left, right, top, bottom }))) };
const rect = (id: string) => layout.targets.find(t => t.id === id)!;
const centre = (id: string) => { const t = rect(id); return { x: (t.left + t.right) / 2, y: (t.top + t.bottom) / 2 }; };
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function gaussian(random: () => number) { return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()); }

describe('rectDensity', () => {
  it('integrates to about one over the plane and peaks inside the rectangle', () => {
    const r = rect('top-2'); let total = 0;
    for (let x = -200; x < 1480; x += 4) for (let y = -200; y < 1000; y += 4) total += rectDensity({ x, y }, r, 40) * 16;
    expect(total).toBeCloseTo(1, 2);
    expect(rectDensity(centre('top-2'), r, 40)).toBeGreaterThan(rectDensity({ x: r.right + 60, y: centre('top-2').y }, r, 40) * 10);
  });
});

describe('TargetClassifier', () => {
  const steady = (classifier: TargetClassifier, p: Point, frames: number) => { let last = classifier.classify(p, layout); for (let i = 1; i < frames; i++) last = classifier.classify(p, layout); return last; };

  it('settles on the looked-at target within a few frames', () => {
    const classifier = new TargetClassifier();
    expect(steady(classifier, centre('bottom-3'), 3)).toMatchObject({ target: 'bottom-3' });
  });

  it('a single stray estimate does not flip the answer', () => {
    const classifier = new TargetClassifier();
    steady(classifier, centre('top-1'), 10);
    expect(classifier.classify(centre('bottom-4'), layout).target).toBe('top-1');
    expect(classifier.classify(centre('top-1'), layout).target).toBe('top-1');
  });

  it('evidence is time-based: the same glance counts the same at 10 or 30 frames per second', () => {
    const glance = (frameMs: number) => {
      const classifier = new TargetClassifier();
      for (let i = 0; i < 30; i++) classifier.classify(centre('top-1'), layout, i * frameMs);
      let frames = 0;
      while (classifier.classify(centre('top-2'), layout, (30 + frames) * frameMs).target !== 'top-2') frames++;
      return (frames + 1) * frameMs;
    };
    expect(glance(100)).toBeLessThanOrEqual(200);
    expect(glance(33)).toBeLessThanOrEqual(200);
    // One junk frame at 30 per second (33 ms) is not a glance.
    expect(glance(33)).toBeGreaterThan(33);
  });

  it('a deliberate move switches within a handful of frames', () => {
    const classifier = new TargetClassifier();
    steady(classifier, centre('top-1'), 30);
    let frames = 0;
    while (classifier.classify(centre('top-2'), layout).target !== 'top-2' && frames < 30) frames++;
    expect(frames).toBeLessThanOrEqual(4);
  });

  it('keeps the target across a blink, then re-identifies from fresh frames', () => {
    const classifier = new TargetClassifier();
    steady(classifier, centre('top-3'), 10);
    expect(classifier.classify(null, layout).target).toBe('top-3');
    expect(steady(classifier, centre('bottom-1'), 3).target).toBe('bottom-1');
  });

  it('after a blink, a single fresh frame that disagrees drops or replaces the held target', () => {
    const classifier = new TargetClassifier();
    steady(classifier, centre('top-1'), 20);
    classifier.classify(null, layout);
    expect(classifier.classify(centre('top-2'), layout).target).toBe('top-2');
    steady(classifier, centre('top-2'), 20);
    classifier.classify(null, layout);
    // Right on the border between two targets: unsure, so neither is kept.
    expect(classifier.classify({ x: (rect('top-2').right + rect('top-3').left) / 2, y: centre('top-2').y }, layout).target).toBeNull();
    steady(classifier, centre('top-3'), 20);
    classifier.classify(null, layout);
    expect(classifier.classify(centre('top-3'), layout).target).toBe('top-3');
  });

  it('drops the target after a short look at empty screen, but not for one junk frame', () => {
    const empty = { viewport, targets: [rect('top-1'), rect('top-2')] }, below = { x: centre('top-1').x, y: 650 };
    const settle = (frameMs: number) => { const c = new TargetClassifier(); for (let i = 0; i < 30; i++) c.classify(centre('top-1'), empty, i * frameMs); return c; };
    expect(settle(100).classify(below, empty, 3000).target).toBeNull();
    expect(settle(33).classify(below, empty, 30 * 33).target).toBe('top-1');
  });

  it('reports looking away for estimates well past the screen', () => {
    const classifier = new TargetClassifier();
    steady(classifier, centre('top-3'), 10);
    expect(classifier.classify({ x: 640, y: -400 }, layout).target).toBeNull();
    expect(new TargetClassifier().classify(centre('top-1'), { viewport, targets: [] }).target).toBeNull();
  });

  it('uses the measured noise, within bounds', () => {
    const classifier = new TargetClassifier();
    expect(classifier.sigma(layout)).toBeCloseTo(48);
    classifier.setNoise(30); expect(classifier.sigma(layout)).toBe(30);
    classifier.setNoise(5); expect(classifier.sigma(layout)).toBe(16);
    classifier.setNoise(null); expect(classifier.sigma(layout)).toBeCloseTo(48);
  });
});

describe('personalizationFromCheck', () => {
  const references = validationTargets(viewport, rng(9));
  const random = rng(4);
  const samples = (track: (p: Point) => Point) => references.flatMap((target, index) => Array.from({ length: 30 }, () => ({ target: index, estimate: track(target) })));

  it('trusts a check where the person followed the dot', () => {
    const report = compareCorrections(samples(p => ({ x: p.x + 20 * gaussian(random), y: p.y - 70 + 20 * gaussian(random) })), references, viewport);
    const personal = personalizationFromCheck(report, viewport)!;
    expect(personal.pairs).toHaveLength(10);
    expect(personal.sigmaPx).toBeGreaterThan(10); expect(personal.sigmaPx).toBeLessThan(40);
  });

  it('ignores a check where the person stared at one spot instead', () => {
    const report = compareCorrections(samples(() => ({ x: 300 + 5 * gaussian(random), y: 200 + 5 * gaussian(random) })), references, viewport);
    expect(personalizationFromCheck(report, viewport)).toBeNull();
    expect(personalizationFromCheck(null, viewport)).toBeNull();
  });
});

describe('SelectionLearning.seed', () => {
  it('removes a measured offset before any selection', () => {
    const learning = new SelectionLearning();
    const references = validationTargets(viewport, rng(3));
    expect(learning.seed(references.map(target => ({ target, estimate: { x: target.x + 10, y: target.y - 70 } })), viewport)).toBe(10);
    const corrected = learning.apply({ x: 640, y: 330 }, viewport);
    expect(corrected.x).toBeCloseTo(630, 0); expect(corrected.y).toBeCloseTo(400, 0);
  });

  it('ignores implausible pairs', () => {
    expect(new SelectionLearning().seed([{ target: { x: 100, y: 100 }, estimate: { x: 1200, y: 700 } }], viewport)).toBe(0);
  });
});

/**
 * Simulated use of the navigation page. The person looks somewhere inside a target for 1.5 s
 * (45 frames), then moves to another; the tracker reports their gaze shifted 70 px UP (the
 * reported problem), with 35 px noise per axis and 5% junk frames. Frames after the first 10
 * of each look are scored. "Check-seeded" first runs a simulated 60 s free-flow check.
 */
function simulate(bias: Point, seed: number) {
  const random = rng(seed), ids = layout.targets.map(t => t.id);
  const track = (p: Point) => random() < .05 ? { x: random() * 1280, y: random() * 800 } : { x: p.x + bias.x + 35 * gaussian(random), y: p.y + bias.y + 35 * gaussian(random) };
  // The free-flow check: 30 frames at each of 10 references; medians per reference.
  const learning = new SelectionLearning();
  const references = validationTargets(viewport, rng(seed + 1));
  learning.seed(references.map(target => {
    const s = Array.from({ length: 30 }, () => track(target)), med = (a: 'x' | 'y') => s.map(p => p[a]).sort((u, v) => u - v)[15];
    return { target, estimate: { x: med('x'), y: med('y') } };
  }), viewport);
  const checkError = (() => {
    const e = references.flatMap(target => Array.from({ length: 30 }, () => { const q = learning.apply(track(target), viewport); return Math.hypot(q.x - target.x, q.y - target.y); })).sort((a, b) => a - b);
    return e[e.length >> 1];
  })();
  const methods = {
    'hit test (pointer inside box)': { pick: (p: Point) => layout.targets.find(t => p.x >= t.left && p.x <= t.right && p.y >= t.top && p.y <= t.bottom)?.id ?? null },
    'nearest-box snapper (current)': (() => { const s = new TargetSnapper(); return { pick: (p: Point) => s.resolve(p, layout) }; })(),
    'classifier': (() => { const c = new TargetClassifier(); return { pick: (p: Point) => c.classify(p, layout).target }; })(),
    'snapper, check-seeded': (() => { const s = new TargetSnapper(); return { pick: (p: Point) => s.resolve(learning.apply(p, viewport), layout) }; })(),
    'classifier, check-seeded': (() => { const c = new TargetClassifier(); c.setNoise(checkError / 1.1774); return { pick: (p: Point) => c.classify(learning.apply(p, viewport), layout).target }; })(),
  };
  const correct = Object.fromEntries(Object.keys(methods).map(k => [k, 0])) as Record<keyof typeof methods, number>;
  let scored = 0;
  for (let look = 0; look < 40; look++) {
    const id = ids[Math.floor(random() * ids.length)], r = rect(id);
    const gaze = { x: r.left + (.15 + .7 * random()) * (r.right - r.left), y: r.top + (.15 + .7 * random()) * (r.bottom - r.top) };
    for (let frame = 0; frame < 45; frame++) {
      const estimate = track(gaze);
      for (const [name, method] of Object.entries(methods)) if (method.pick(estimate) === id && frame >= 10) correct[name as keyof typeof methods]++;
      if (frame >= 10) scored++;
    }
  }
  return Object.fromEntries(Object.entries(correct).map(([k, v]) => [k, v / scored])) as Record<keyof typeof methods, number>;
}

describe('simulated navigation: share of frames on the right target', () => {
  const average = (bias: Point) => {
    const runs = Array.from({ length: 20 }, (_, i) => simulate(bias, 100 + i));
    return Object.fromEntries(Object.keys(runs[0]).map(k => [k, runs.reduce((s, r) => s + r[k as keyof typeof r], 0) / runs.length])) as ReturnType<typeof simulate>;
  };
  const up = average({ x: 0, y: -70 }), none = average({ x: 0, y: 0 });
  console.table(Object.fromEntries(Object.keys(up).map(k => [k, { 'pointer 70 px above': `${(up[k as keyof typeof up] * 100).toFixed(1)}%`, 'no offset': `${(none[k as keyof typeof none] * 100).toFixed(1)}%` }])));

  it('the classifier beats both the hit test and the current snapper', () => {
    for (const r of [up, none]) {
      expect(r.classifier).toBeGreaterThan(r['hit test (pointer inside box)']);
      expect(r.classifier).toBeGreaterThan(r['nearest-box snapper (current)']);
    }
  });

  it('seeding from the check fixes a pointer that sits above the gaze', () => {
    expect(up['classifier, check-seeded']).toBeGreaterThan(.97);
    expect(up['classifier, check-seeded']).toBeGreaterThan(up.classifier);
    expect(up['snapper, check-seeded']).toBeGreaterThan(up['nearest-box snapper (current)']);
  });

  it('seeding costs nothing when there is no offset', () => {
    expect(none['classifier, check-seeded']).toBeGreaterThan(none.classifier - .01);
  });
});
