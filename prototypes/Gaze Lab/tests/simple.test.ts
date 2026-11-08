import { describe, expect, it } from 'vitest';
import { BASELINE_WORKER, DWELL_TIMING, Dwell, GRID, TRIAL_TIMING, TrialRun, calibrationTargets, type Selection, decideQuadrant, nearestQuadrant, quadrants, rectDistance, tally, trialSchedule, usablePoint } from '../src/lab/simple';
import { QUICK_WORKER } from '../src/lab/quick';

const V = { width: 1280, height: 800 };

describe('simple flow · quadrant grid', () => {
  it('lays the 8 quadrants out as the app does: 4 × 2, inset 76 / clamp(16px, 4vw, 52px) / 24, gap 20', () => {
    const qs = quadrants(V);
    expect(qs.map(q => q.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(qs.map(q => [q.row, q.column])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]]);
    const side = Math.min(52, Math.max(16, .04 * 1280)); // 51.2
    const w = (1280 - 2 * side - 3 * 20) / 4, h = (800 - 76 - 24 - 20) / 2;
    expect(qs[0].rect).toEqual({ x: side, y: 76, width: w, height: h });
    expect(qs[7].rect).toEqual({ x: side + 3 * (w + 20), y: 76 + h + 20, width: w, height: h });
    expect(qs[7].rect.x + w).toBeCloseTo(1280 - side); expect(qs[7].rect.y + h).toBeCloseTo(800 - 24);
    expect(qs[5].centre).toEqual({ x: side + (w + 20) + w / 2, y: 76 + h + 20 + h / 2 });
    expect(quadrants({ width: 400, height: 600 })[0].rect.x).toBe(16); expect(quadrants({ width: 4000, height: 600 })[0].rect.x).toBe(52);
    expect(GRID.columns * GRID.rows).toBe(8);
  });
  it('maps a point to the quadrant containing it, and a point in a gap or margin to the nearest one', () => {
    const qs = quadrants(V);
    for (const q of qs) expect(nearestQuadrant(q.centre, qs)).toBe(q.id);
    const a = qs[1].rect, b = qs[2].rect;
    expect(rectDistance(qs[1].centre, a)).toBe(0);
    expect(nearestQuadrant({ x: a.x + a.width + 3, y: a.y + 10 }, qs)).toBe(1); // in the gap, 3 px right of quadrant 1
    expect(nearestQuadrant({ x: b.x - 3, y: a.y + 10 }, qs)).toBe(2); // 3 px left of quadrant 2
    expect(nearestQuadrant({ x: a.x + a.width + 10, y: a.y + 10 }, qs)).toBe(1); // exactly mid-gap: the lower id
    expect(nearestQuadrant({ x: 2, y: 2 }, qs)).toBe(0); // top-left margin
    expect(nearestQuadrant({ x: 1279, y: 799 }, qs)).toBe(7); // bottom-right margin
    expect(nearestQuadrant({ x: 640, y: a.y + a.height + 10 }, qs)).toBe(1); // the horizontal gap, left of centre: top row, lower id on the tie between 1 and 5
    expect(nearestQuadrant({ x: 640, y: a.y + a.height + 11 }, qs)).toBe(5);
    expect(nearestQuadrant({ x: -500, y: 5000 }, qs)).toBe(4); // far outside: nearest corner
  });
  it('decides from the per-axis median of usable frames only, null without frames', () => {
    const qs = quadrants(V);
    expect(decideQuadrant([], qs)).toBeNull();
    const c = qs[6].centre;
    // Two outliers in quadrant 0 do not move the median away from quadrant 6.
    expect(decideQuadrant([c, { x: c.x + 5, y: c.y - 5 }, { x: c.x - 5, y: c.y + 5 }, { x: 10, y: 80 }, { x: 12, y: 90 }], qs)).toBe(6);
    // The median is taken per axis: x from one half, y from the other → the quadrant of the combined point.
    expect(decideQuadrant([{ x: qs[0].centre.x, y: qs[4].centre.y }, { x: qs[0].centre.x, y: qs[4].centre.y }, { x: qs[3].centre.x, y: qs[0].centre.y }], qs)).toBe(4);
    expect(usablePoint({ facePresent: true, eyeState: 'open' }, [0, 0], V)).toEqual({ x: 640, y: 400 });
    expect(usablePoint({ facePresent: true, eyeState: 'closed' }, [0, 0], V)).toBeNull();
    expect(usablePoint({ facePresent: false, eyeState: 'unknown' }, [0, 0], V)).toBeNull();
    expect(usablePoint({ facePresent: true, eyeState: 'open' }, null, V)).toBeNull();
    expect(usablePoint({ facePresent: true, eyeState: 'open' }, [NaN, 0], V)).toBeNull();
  });
  it('puts the calibration dots at the quadrant centres in snake order, in the quick-target shape', () => {
    const qs = quadrants(V), t = calibrationTargets(qs, V);
    expect(t.map(x => x.cell)).toEqual([0, 1, 2, 3, 7, 6, 5, 4]);
    expect(t.map(x => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.map(x => x.validationIndex)).toEqual([4, 5, 6, 7, 11, 10, 9, 8]);
    for (const x of t) { const q = qs[x.cell]; expect([x.x, x.y]).toEqual([q.centre.x, q.centre.y]); expect(x.nx).toBeCloseTo(q.centre.x / V.width - .5); expect(x.ny).toBeCloseTo(q.centre.y / V.height - .5); }
  });
  it('trains the baseline with the raised limits only; the candidate adds the frozen pose and the blend cap', () => {
    expect(BASELINE_WORKER).toEqual({ limits: { maxSamples: 200, minSamples: 24, minTargets: 8 } });
    expect(QUICK_WORKER.limits).toEqual(BASELINE_WORKER.limits);
    expect(QUICK_WORKER.fixes.freezePose).toBe(true); expect(QUICK_WORKER.blend.geometricShareMax).toBe(.2);
  });
});

describe('simple flow · trial scheduler', () => {
  it('schedules rounds × 8 trials, each round a fresh seeded order covering every quadrant once', () => {
    const { rounds, trials } = trialSchedule(3, 12345);
    expect(rounds).toHaveLength(3); expect(trials).toHaveLength(24);
    for (const r of rounds) expect([...r.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(rounds.map(r => r.seed)).size).toBe(3);
    expect(rounds[0].order).not.toEqual(rounds[1].order);
    expect(trials.map(t => t.index)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(trials.slice(0, 8).map(t => t.quadrant)).toEqual(rounds[0].order); expect(trials.slice(16).map(t => t.quadrant)).toEqual(rounds[2].order);
    expect(trials.every((t, i) => t.round === Math.floor(i / 8) + 1)).toBe(true);
    expect(trialSchedule(3, 12345)).toEqual({ rounds, trials }); // reproducible from the seed
    expect(trialSchedule(1, 1).trials).toHaveLength(8);
  });
  it('runs 0.9 s settle, 1.5 s record, 0.4 s feedback per trial and completes after the last one', () => {
    const run = new TrialRun(trialSchedule(1, 7).trials);
    expect(TRIAL_TIMING).toEqual({ settleMs: 900, recordMs: 1500, feedbackMs: 400 });
    expect(run.trialMs).toBe(2800);
    expect(run.position(1000)).toBeNull();
    expect(run.start(1000)).toBe(true); expect(run.start(1000)).toBe(false);
    expect(run.attempts).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(run.classify(1000)).toMatchObject({ index: 0, attempt: 1, phase: 'settle', progress: 0 });
    expect(run.classify(1899)?.phase).toBe('settle');
    expect(run.classify(1900)).toMatchObject({ phase: 'record', progress: 0 });
    expect(run.classify(2650)?.progress).toBeCloseTo(.5);
    expect(run.classify(2650)).toBeNull(); // a frame time is never classified twice
    expect(run.classify(3399)?.phase).toBe('record');
    expect(run.classify(3400)).toMatchObject({ phase: 'feedback', progress: 0 });
    expect(run.classify(3799)?.phase).toBe('feedback');
    run.tick(3800);
    expect(run.state).toMatchObject({ kind: 'running', index: 1, startedAt: 3800 });
    expect(run.attempts).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(run.classify(3800)).toMatchObject({ index: 1, trial: run.trials[1], phase: 'settle' });
    run.tick(1000 + 8 * 2800 - 1); expect(run.state).toMatchObject({ kind: 'running', index: 7 });
    run.tick(1000 + 8 * 2800); expect(run.state).toEqual({ kind: 'complete' });
    expect(run.position(1000 + 8 * 2800)).toBeNull();
    expect(run.attempts).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(run.start(99999)).toBe(false);
  });
  it('drops the feedback phase when feedback is off', () => {
    const run = new TrialRun(trialSchedule(1, 7).trials, TRIAL_TIMING, false);
    expect(run.trialMs).toBe(2400);
    run.start(0);
    expect(run.position(2399)?.phase).toBe('record');
    run.tick(2400); expect(run.state).toMatchObject({ index: 1 });
  });
  it('pauses, restarts the current trial from settle as a new attempt, and can step back to redo the previous trial', () => {
    const run = new TrialRun(trialSchedule(1, 3).trials);
    run.start(0); run.tick(2800 * 2 + 1500); // trial 2, in its record window
    expect(run.position(2800 * 2 + 1500)?.phase).toBe('record');
    expect(run.pause()).toBe(true); expect(run.state).toEqual({ kind: 'paused', index: 2 });
    expect(run.position(2800 * 2 + 1600)).toBeNull();
    expect(run.start(50000)).toBe(true);
    expect(run.position(50000)).toMatchObject({ index: 2, attempt: 2, phase: 'settle', progress: 0 });
    expect(run.attempts).toEqual([1, 1, 2, 0, 0, 0, 0, 0]);
    run.pause(); expect(run.back()).toBe(true); expect(run.state).toEqual({ kind: 'paused', index: 1 });
    run.start(60000); expect(run.position(60000)).toMatchObject({ index: 1, attempt: 2 });
    expect(run.attempts).toEqual([1, 2, 2, 0, 0, 0, 0, 0]);
    const first = new TrialRun(trialSchedule(1, 3).trials); first.start(0); first.pause();
    expect(first.back()).toBe(false); // nothing before the first trial
    expect(new TrialRun(trialSchedule(1, 3).trials).back()).toBe(false); // only on a paused run
  });
  it('tallies hits per quadrant from decisions, counting missing decisions as attempted', () => {
    const { trials } = trialSchedule(2, 9);
    const decisions = trials.map((t, i) => (i % 4 === 3 ? null : i % 8 === 1 ? (t.quadrant + 1) % 8 : t.quadrant));
    const t = tally(trials, decisions);
    expect(t.total).toBe(16); expect(t.shown).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(t.correct).toBe(16 - 4 - 2); expect(t.hits.reduce((a, b) => a + b, 0)).toBe(t.correct);
    expect(tally(trials, []).total).toBe(0);
  });
});

describe('simple flow · free-look dwell', () => {
  /** Frames every 33 ms over [from, to) with one live quadrant; collects the selections they complete. */
  const look = (d: Dwell, from: number, to: number, live: number | null, out: Selection[] = []) => { for (let t = from; t < to; t += 33) { const s = d.step(t, live); if (s) out.push(s); } return out; };
  it('selects a quadrant 2 s after the look reached it, once, however long the look stays', () => {
    expect(DWELL_TIMING).toEqual({ dwellMs: 2000, holdMs: 150, rearmMs: 300, feedbackMs: TRIAL_TIMING.feedbackMs });
    expect(look(new Dwell(), 0, 6000, 3)).toEqual([{ quadrant: 3, at: 2013, dwellStartedAt: 0 }]);
  });
  it('marks the dwelt quadrant with its progress, and the looked-at one without progress while latched', () => {
    const d = new Dwell();
    d.step(0, 1);
    expect(d.quadrant).toBeNull(); // the hold: not marked yet
    expect(d.step(0, 1)).toBeNull(); expect(d.step(Number.NaN, 1)).toBeNull(); // repeated and invalid frames are ignored
    look(d, 33, 1023, 1);
    expect(d.quadrant).toBe(1); expect(d.progress(1000)).toBeCloseTo(.5); expect(d.progress(9000)).toBe(1);
    look(d, 1023, 2500, 1);
    expect(d.state.kind).toBe('selected'); expect(d.quadrant).toBe(1); expect(d.progress(2500)).toBe(0);
  });
  it('re-arms a selected quadrant only after the look has been off it for the hold and the re-arm time', () => {
    const d = new Dwell(), out: Selection[] = [];
    look(d, 0, 2500, 3, out);
    look(d, 2500, 2700, 5, out); // 200 ms away: off it from 2665, under the 300 ms re-arm
    look(d, 2700, 5000, 3, out); // back: still latched
    expect(out).toEqual([{ quadrant: 3, at: 2013, dwellStartedAt: 0 }]);
    look(d, 5000, 5300, 5, out); // 300 ms on 5: 3 is not re-armed yet, but 5 is marked and its fill counts from the look's arrival
    expect([d.state.kind, d.quadrant]).toEqual(['selected', 5]); expect(d.progress(5300)).toBeCloseTo(.15);
    look(d, 5300, 5600, 5, out); // 600 ms away re-arms 3; the dwell on 5 carries on from the same arrival (no jump), then is abandoned
    expect([d.state.kind, d.quadrant]).toEqual(['dwelling', 5]); expect(d.progress(5600)).toBeCloseTo(.3);
    look(d, 5600, 8000, 3, out);
    expect(out).toEqual([{ quadrant: 3, at: 2013, dwellStartedAt: 0 }, { quadrant: 3, at: 7613, dwellStartedAt: 5600 }]);
  });
  it('forgives a glance at another quadrant shorter than the hold, and restarts the dwell after a longer one', () => { // the hold alone does it: there is no grace window
    const short = new Dwell(), a: Selection[] = [];
    look(short, 0, 990, 2, a); look(short, 990, 1089, 6, a); look(short, 1089, 3000, 2, a);
    expect(a).toEqual([{ quadrant: 2, at: 2013, dwellStartedAt: 0 }]);
    const long = new Dwell(), b: Selection[] = [];
    look(long, 0, 990, 2, b); look(long, 990, 1386, 6, b); look(long, 1386, 4000, 2, b);
    expect(b).toEqual([{ quadrant: 2, at: 3399, dwellStartedAt: 1386 }]);
  });
  it('moves the look off a quadrant once it has been away for the hold, even while it flickers between two others', () => {
    const d = new Dwell(), out: Selection[] = [];
    look(d, 0, 528, 0, out);
    for (let t = 528, i = 0; t < 3000; t += 33, i++) { const s = d.step(t, i % 2 ? 2 : 1); if (s) out.push(s); }
    expect(out).toEqual([{ quadrant: 2, at: 2541, dwellStartedAt: 528 }]); // never quadrant 0, which the look left at 528
  });
  it('cancels the dwell when the look is lost, and starts over when it comes back', () => {
    const d = new Dwell(), out: Selection[] = [];
    look(d, 0, 1485, 4, out); look(d, 1485, 1980, null, out);
    expect(d.state.kind).toBe('idle'); expect(d.quadrant).toBeNull();
    look(d, 1980, 5000, 4, out);
    expect(out).toEqual([{ quadrant: 4, at: 3993, dwellStartedAt: 1980 }]);
  });
});
