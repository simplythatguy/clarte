import { describe, expect, it, vi } from 'vitest';
import { CalibrationRun, READING_MS, CALIBRATION_TIMING, calibrationPoints, viewportChanged, type CalibrationPace, type Point } from '../src/core/calibration';
import type { GazeFrame } from '../src/core/tracking';
const viewport = { width: 1400, height: 900 };
const frame = (at: number, face = true): GazeFrame => ({ face, point: null, at, pose: null, facePresent: true, eyeState: 'open' as const });
function fixture(pace: CalibrationPace = 'comfortable') {
  let now = 0;
  const run = new CalibrationRun(viewport, pace, () => now);
  for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
  const record = vi.fn(async (_point: Point, _at: number) => true);
  const advance = async (until: number, face = true) => { while (now < until) { now += 100; await run.capture(frame(now, face), now, record); } };
  return { run, record, advance, now: () => now };
}
describe('explicit WebEyeTrack calibration', () => {
  it('covers nine viewport references, with five gentler head references', () => {
    const points = calibrationPoints(viewport);
    expect(points).toHaveLength(9); expect(points[0]).toEqual({ x: 700, y: 450 });
    expect(new Set(points.map(p => `${p.x},${p.y}`)).size).toBe(9);
    expect(Math.min(...points.map(p => p.x))).toBe(56); expect(Math.max(...points.map(p => p.x))).toBe(1344);
    expect(calibrationPoints(viewport, 'head')).toHaveLength(5);
  });
  it('requires distinct fresh frames and explicit start; clock ticks cannot collect', async () => {
    const run = new CalibrationRun(viewport, 'comfortable'); const record = vi.fn(async () => true);
    run.tick(0, frame(0)); run.tick(500, frame(0)); expect(run.start(500)).toBe(false);
    for (let at = 100; at <= 1000; at += 100) await run.capture(frame(at), at, record);
    expect(record).not.toHaveBeenCalled(); expect(run.start(1000)).toBe(true);
    for (let at = 1100; at < 7000; at += 100) await run.capture(frame(at), at, record);
    await run.capture(frame(6999), 7001, record); expect(record).not.toHaveBeenCalled();
    await run.capture(frame(7000), 7001, record); expect(record).toHaveBeenCalledTimes(1);
    await run.capture(frame(7000), 7100, record); expect(record).toHaveBeenCalledTimes(1);
    run.tick(7200, frame(7200)); expect(record).toHaveBeenCalledTimes(1);
  });
  it.each(['quick','comfortable','gentle'] as const)('keeps remaining movement and a full settle on pause/continue (%s)', async pace => {
    const f = fixture(pace); const t = CALIBRATION_TIMING[pace]; f.run.start(0);
    await f.advance(READING_MS + t.moveMs + t.settleMs + 2 * t.sampleMs);
    expect(f.run.state.kind).toBe('moving'); let moveUntil = f.now() + t.moveMs;
    f.run.pause(); await f.advance(f.now() + 100); expect(f.run.start(f.now())).toBe(true); moveUntil = f.now() + t.moveMs;
    await f.advance(moveUntil + t.settleMs - 100); expect(f.record).toHaveBeenCalledTimes(3);
    await f.advance(moveUntil + t.settleMs); expect(f.record).toHaveBeenCalledTimes(4);
  });
  it.each(['quick','comfortable','gentle'] as const)('collects exactly three fresh labels at each of nine points, after full travel and settle (%s)', async pace => {
    const f = fixture(pace), timing = CALIBRATION_TIMING[pace];
    expect(f.run.start(0)).toBe(true);
    const perPoint = timing.moveMs + timing.settleMs + 2 * timing.sampleMs;
    await f.advance(READING_MS + 9 * perPoint - 100);
    expect(f.record).toHaveBeenCalledTimes(26);
    expect(f.run.state.kind).toBe('sampling');
    await f.advance(READING_MS + 9 * perPoint);
    expect(f.run.state.kind).toBe('collected');
    expect(f.record).toHaveBeenCalledTimes(27);
    const calls = f.record.mock.calls;
    expect(new Set(calls.map(([,at]) => at)).size).toBe(27);
    for (let point = 0; point < 9; point++) {
      const firstAt = READING_MS + point * perPoint + timing.moveMs + timing.settleMs;
      expect(calls.slice(point * 3, point * 3 + 3)).toEqual([0,1,2].map(sample => [calibrationPoints(viewport)[point], firstAt + sample * timing.sampleMs]));
    }
    expect(f.run.finishTraining()).toBe(false);
  });
  it('holds on closed/missing/stale observations, settles after recovery and ignores head-reference geometry', async () => {
    const f = fixture(); f.run.start(0); await f.advance(6000); expect(f.record).toHaveBeenCalledTimes(1);
    await f.advance(6500, false); await f.advance(8200); expect(f.record).toHaveBeenCalledTimes(1);
    await f.advance(9200); expect(f.record.mock.calls.length).toBeGreaterThan(1);
    const before = f.record.mock.calls.length; f.run.tick(10200, frame(9200));
    await f.run.capture(frame(11200), 10200, f.record); expect(f.record).toHaveBeenCalledTimes(before);
    // There is deliberately no WebGazer fixed-pose reference on this runner.
    expect('head' in f.run).toBe(false);
  });
  it('serializes async collection and honours pause even when its acknowledgement is pending', async () => {
    const f = fixture(); f.run.start(0); await f.advance(5900);
    let ack: (v: boolean) => void = () => {};
    const record = vi.fn(() => new Promise<boolean>(resolve => { ack = resolve; }));
    const pending = f.run.capture(frame(6000), 6000, record); expect(f.run.state.kind).toBe('collecting');
    await f.run.capture(frame(6100), 6100, record); expect(record).toHaveBeenCalledTimes(1);
    f.run.pause(); ack(true); await pending;
    expect(f.run.state).toMatchObject({ kind: 'paused', samples: 1 });
  });
  it('starts target travel at the acknowledgement time, rather than a delayed old capture time', async () => {
    let clock=0;const run=new CalibrationRun(viewport,'comfortable',()=>clock);
    for(let at=-800;at<=0;at+=100)run.tick(at,frame(at));run.start(0);
    for(let at=100;at<7600;at+=100){clock=at;await run.capture(frame(at),at,async()=>true);}
    let ack:(v:boolean)=>void=()=>{};clock=7600;
    const pending=run.capture(frame(7600),7600,()=>new Promise<boolean>(resolve=>{ack=resolve;}));
    clock=9200;ack(true);await pending;
    expect(run.state).toMatchObject({kind:'moving',step:1,until:10400});
  });
  it('rejects an unacknowledged label and requires explicit training after 27 references', async () => {
    const f = fixture(); f.run.start(0); await f.advance(5900);
    await f.run.capture(frame(6000), 6000, async () => false); expect(f.run.state.samples).toBe(0);
    await f.advance(50000); expect(f.run.state.kind).toBe('collected'); expect(f.record).toHaveBeenCalledTimes(27);
    expect(f.run.finishTraining()).toBe(false); expect(f.run.beginTraining()).toBe(true);
    expect(f.run.state.kind).toBe('training'); expect(f.run.finishTraining()).toBe(true);
  });
  it('collects same-frame head samples separately before training', async () => {
    const f = fixture(); f.run.start(0); await f.advance(50000); f.run.addHeadStage();
    expect(f.run.state).toMatchObject({ kind: 'ready', stage: 'head' });
    f.run.start(f.now()); await f.advance(110000);
    expect(f.record).toHaveBeenCalledTimes(42); expect(f.run.state).toMatchObject({ kind: 'collected', stage: 'head' });
    expect(f.run.beginTraining()).toBe(true);
  });
  it('detects cumulative viewport movement against the original calibration', () => {
    expect(viewportChanged(viewport, { width:1360, height:900 })).toBe(false);
    expect(viewportChanged(viewport, { width:1350, height:900 })).toBe(true);
    expect(viewportChanged(viewport, { width:1400, height:819 })).toBe(true);
  });
});
