import { describe, expect, it } from 'vitest';
import { calibrationPoints } from '../src/core/calibration';
import { validationTargets } from '../src/core/validation';
import {
  CORRECTION_MODELS, compareCorrections, fitAffine, fitCorrection, fitQuadratic, fitRansacAffine, fitThinPlate, solveLinear, toUnits,
  type CorrectionModel, type CorrectionPair, type CorrectionSample,
} from '../src/core/calibration-models';
import type { Point } from '../src/core/tracking';

const viewport = { width: 1280, height: 800 };
const centre = { x: viewport.width / 2, y: viewport.height / 2 };
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function gaussian(random: () => number) { return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()); }
const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe('fitters', () => {
  const grid = [-.4, 0, .4].flatMap(x => [-.25, 0, .25].map(y => ({ x, y })));
  const affine = (p: Point) => ({ x: 1.1 * p.x - .05 * p.y + .03, y: .04 * p.x + .9 * p.y - .02 });
  const quadratic = (p: Point) => ({ x: affine(p).x + .3 * p.x * p.x, y: affine(p).y - .2 * p.x * p.y + .25 * p.y * p.y });
  const pairsFrom = (f: (p: Point) => Point): CorrectionPair[] => grid.map(estimate => ({ estimate, target: f(estimate) }));

  it('affine recovers an exact affine map', () => {
    const fit = fitAffine(pairsFrom(affine))!;
    for (const p of [{ x: .2, y: -.1 }, { x: -.45, y: .3 }]) expect(close(fit(p), affine(p))).toBeLessThan(1e-12);
  });

  it('quadratic without ridge recovers an exact quadratic map, and affine cannot', () => {
    const p = { x: .33, y: -.21 };
    expect(close(fitQuadratic(pairsFrom(quadratic), 0)!(p), quadratic(p))).toBeLessThan(1e-12);
    expect(close(fitAffine(pairsFrom(quadratic))!(p), quadratic(p))).toBeGreaterThan(.005);
  });

  it('a heavy quadratic ridge collapses toward the affine fit', () => {
    const pairs = pairsFrom(quadratic), p = { x: .1, y: .2 };
    expect(close(fitQuadratic(pairs, 1e9)!(p), fitAffine(pairs)!(p))).toBeLessThan(1e-6);
  });

  it('thin-plate without smoothing passes through every pair; it reproduces affine maps exactly', () => {
    const pairs = pairsFrom(quadratic), fit = fitThinPlate(pairs, 0)!;
    for (const pair of pairs) expect(close(fit(pair.estimate), pair.target)).toBeLessThan(1e-9);
    expect(close(fitThinPlate(pairsFrom(affine), 0)!({ x: .17, y: .11 }), affine({ x: .17, y: .11 }))).toBeLessThan(1e-9);
  });

  it('RANSAC ignores one spoiled reference point; plain affine is dragged by it', () => {
    const pairs = pairsFrom(affine);
    pairs[4] = { ...pairs[4], target: { x: pairs[4].target.x + .2, y: pairs[4].target.y } };
    const p = { x: .25, y: .15 };
    expect(close(fitRansacAffine(pairs)!(p), affine(p))).toBeLessThan(1e-9);
    expect(close(fitAffine(pairs)!(p), affine(p))).toBeGreaterThan(.01);
  });

  it('refuses degenerate input instead of returning a broken map', () => {
    expect(solveLinear([[1, 2], [2, 4]], [[1], [2]])).toBeNull();
    const line = [0, .1, .2, .3].map(x => ({ estimate: { x, y: x }, target: { x, y: x } }));
    expect(fitAffine(line)).toBeNull();
    expect(fitAffine(line.slice(0, 2))).toBeNull();
    for (const model of CORRECTION_MODELS) if (model !== 'none') expect(fitCorrection(model, line.slice(0, 2))).toBeNull();
  });
});

/**
 * Synthetic benchmark. A simulated tracker reports `distort(true point)` plus 20 px Gaussian
 * noise per axis. Each model is fitted on the 9 real calibration dots (20 samples each, median)
 * and scored on held-out validation targets it never saw, averaged over 30 seeded trials.
 */
type Scenario = { name: string; distort: (p: Point) => Point; spoiled?: number };
const screenWide = (p: Point) => {
  const a = 2 * Math.PI / 180, dx = p.x - centre.x, dy = p.y - centre.y;
  return { x: centre.x + .92 * (Math.cos(a) * dx - Math.sin(a) * dy) + 35, y: centre.y + .95 * (Math.sin(a) * dx + Math.cos(a) * dy) - 25 };
};
const scenarios: Scenario[] = [
  { name: 'screen-wide error (affine is the truth)', distort: screenWide },
  { name: 'corners pulled inward', distort: p => {
    const dx = p.x - centre.x, dy = p.y - centre.y, r2 = (dx / centre.x) ** 2 + (dy / centre.y) ** 2, k = 1 - .1 * r2;
    return { x: centre.x + dx * k + 20, y: centre.y + dy * k + 10 };
  } },
  { name: 'off-centre camera (lower rows worse)', distort: p => {
    const t = p.y / viewport.height;
    return { x: centre.x + (p.x - centre.x) * (1 - .15 * t * t), y: p.y - 70 * t * t + 15 };
  } },
  { name: 'one spoiled calibration dot', distort: screenWide, spoiled: 3 },
];

/** Today's 9 dots plus 4 inner dots at the quarter points between them. */
const thirteen = (() => {
  const nine = calibrationPoints(viewport), xs = nine.map(p => p.x), ys = nine.map(p => p.y);
  const [l, r, t, b] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [...nine, ...[[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => ({ x: l + x * (r - l), y: t + y * (b - t) }))];
})();

function benchmark(scenario: Scenario, noise: number, dots: Point[] = calibrationPoints(viewport), trials = 30) {
  const totals = new Map<CorrectionModel, number>();
  for (let trial = 0; trial < trials; trial++) {
    const random = rng(1000 + trial), noisy = (p: Point) => { const d = scenario.distort(p); return { x: d.x + noise * gaussian(random), y: d.y + noise * gaussian(random) }; };
    const pairs = dots.map((dot, index) => {
      const samples = Array.from({ length: 20 }, () => noisy(dot)).map(s => (index === scenario.spoiled ? { x: s.x + 220, y: s.y - 90 } : s));
      const med = (axis: 'x' | 'y') => { const v = samples.map(s => s[axis]).sort((a, b) => a - b); return (v[9] + v[10]) / 2; };
      return { estimate: toUnits({ x: med('x'), y: med('y') }, viewport), target: toUnits(dot, viewport) };
    });
    const held = validationTargets(viewport, rng(trial)).flatMap(target => Array.from({ length: 20 }, () => ({ target, estimate: noisy(target) })));
    for (const model of CORRECTION_MODELS) {
      const fit = fitCorrection(model, pairs)!;
      const errors = held.map(({ target, estimate }) => {
        const u = fit(toUnits(estimate, viewport)), s = Math.max(viewport.width, viewport.height);
        return close({ x: u.x * s + centre.x, y: u.y * s + centre.y }, target);
      }).sort((a, b) => a - b);
      totals.set(model, (totals.get(model) ?? 0) + errors[Math.floor(errors.length / 2)] / trials);
    }
  }
  return Object.fromEntries(totals) as Record<CorrectionModel, number>;
}

function table(noise: number) {
  const results = Object.fromEntries(scenarios.map(s => [s.name, benchmark(s, noise)]));
  console.log(`Held-out median error in px, ${noise} px tracker noise per axis`);
  console.table(Object.fromEntries(Object.entries(results).map(([name, r]) => [name, Object.fromEntries(Object.entries(r).map(([m, v]) => [m, Math.round(v)]))])));
  return scenarios.map(s => results[s.name]);
}

describe('synthetic benchmark at realistic webcam noise (20 px)', () => {
  const [wide, corners, camera, spoiled] = table(20);

  it('every model beats no correction in every scenario', () => {
    for (const r of [wide, corners, camera, spoiled]) for (const model of CORRECTION_MODELS) if (model !== 'none') expect(r[model]).toBeLessThan(r.none);
  });

  it('when the error really is screen-wide, the flexible models cost little', () => {
    expect(wide.quadratic).toBeLessThan(wide.affine * 1.1);
    expect(wide['thin-plate']).toBeLessThan(wide.affine * 1.1);
  });

  it('when the error changes across the screen, thin-plate helps a little; noise dominates', () => {
    for (const r of [corners, camera]) expect(r['thin-plate']).toBeLessThan(r.affine);
    expect(camera.quadratic).toBeLessThan(camera.affine);
  });

  it('a spoiled calibration dot hurts every non-robust model; RANSAC shrugs it off', () => {
    expect(spoiled['ransac-affine']).toBeLessThan(spoiled.affine * .7);
    expect(spoiled['ransac-affine']).toBeLessThan(wide.affine * 1.1);
  });
});

describe('synthetic benchmark at low noise (5 px): the ceiling each model can reach', () => {
  const [wide, corners, camera] = table(5);

  it('flexible models clearly beat affine on the off-centre camera bend', () => {
    expect(camera.quadratic).toBeLessThan(camera.affine * .7);
    expect(camera['thin-plate']).toBeLessThan(camera.affine * .7);
    expect(wide['thin-plate']).toBeLessThan(wide.affine * 1.2);
  });

  it('with only 9 dots no model can follow corner pull: nothing pins the curve between a corner and its neighbours', () => {
    for (const model of ['quadratic', 'thin-plate'] as const) expect(corners[model]).toBeGreaterThan(corners.affine * .9);
  });

  it('4 extra inner dots let thin-plate fix corner pull; a quadratic still cannot (it is a cubic r²·r distortion)', () => {
    const more = benchmark(scenarios[1], 5, thirteen);
    console.log(`Corner pull, 5 px noise, 13 dots: ${Object.entries(more).map(([m, v]) => `${m} ${Math.round(v)}`).join(', ')}`);
    expect(more['thin-plate']).toBeLessThan(more.affine * .65);
    expect(more.quadratic).toBeGreaterThan(more.affine * .9);
  });
});

describe('compareCorrections on validation-style samples', () => {
  const targets = validationTargets(viewport, rng(7));
  const random = rng(42);
  // A strong vertical bend so the systematic error clearly exceeds the noise.
  const curved = (p: Point) => { const t = p.y / viewport.height; return { x: p.x + 40 * t, y: p.y - 120 * t * t + 30 }; };
  const samples: CorrectionSample[] = targets.flatMap((target, index) => Array.from({ length: 30 }, () => {
    const d = curved(target);
    return { target: index, estimate: { x: d.x + 15 * gaussian(random), y: d.y + 15 * gaussian(random) } };
  }));

  it('scores every model leave-one-out and reports the uncorrected offset at each reference', () => {
    const report = compareCorrections(samples, targets, viewport)!;
    expect(report.references).toBe(10);
    expect(report.scores.map(s => s.model)).toEqual([...CORRECTION_MODELS]);
    const score = (m: CorrectionModel) => report.scores.find(s => s.model === m)!.medianPx!;
    expect(score('affine')).toBeLessThan(score('none'));
    expect(score('quadratic')).toBeLessThan(score('affine'));
    // The lowest reference sits higher than the highest: the pattern a non-affine model can fix.
    const bottom = report.offsets.reduce((a, b) => (b.target.y > a.target.y ? b : a)), top = report.offsets.reduce((a, b) => (b.target.y < a.target.y ? b : a));
    expect(bottom.dy).toBeLessThan(top.dy - 20);
  });

  it('needs at least four reference points with enough samples', () => {
    expect(compareCorrections(samples.filter(s => s.target < 3), targets, viewport)).toBeNull();
    expect(compareCorrections(samples.filter((_, i) => i % 15 === 0), targets, viewport)).toBeNull();
  });
});
