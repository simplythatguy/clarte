import { describe, expect, it, vi } from 'vitest';
import { CalibrationRun, CALIBRATION_TIMING } from '../src/core/calibration';
const viewport = { width: 1400, height: 900 };
const frame = (at: number) => ({ at, face: true, point: null, pose: null, facePresent: true, eyeState: 'open' as const });
describe('instruction reading regression', () => {
  it.each(['quick','comfortable','gentle'] as const)('Continue now dismisses reading but keeps full travel, settling and fresh-frame boundaries (%s)', async pace => {
    const run = new CalibrationRun(viewport, pace), record = vi.fn(async () => true);
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    expect(run.continueNow(0)).toBe(false);
    run.start(0); run.tick(1000, frame(1000));
    expect(run.continueNow(1000)).toBe(true);
    const firstAt = 1000 + CALIBRATION_TIMING[pace].moveMs + CALIBRATION_TIMING[pace].settleMs;
    for (let at = 1100; at < firstAt; at += 100) await run.capture(frame(at), at, record);
    expect(record).not.toHaveBeenCalled();
    await run.capture(frame(firstAt - 1), firstAt, record); expect(record).not.toHaveBeenCalled();
    await run.capture(frame(firstAt), firstAt, record); expect(record).toHaveBeenCalledOnce();
    expect(run.continueNow(firstAt)).toBe(false);
  });
  it('allows explicit readiness from a frozen reading pause, but cannot skip lost-frame readiness or settling', async () => {
    const run = new CalibrationRun(viewport, 'quick'), record = vi.fn(async () => true);
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    run.start(0); run.tick(1000, frame(1000)); run.pause();
    expect(run.state).toMatchObject({kind:'paused',reading:{remainingMs:2000}});
    expect(run.continueNow(10000)).toBe(true);
    for (let at = 10100; at <= 12000; at += 100) await run.capture({...frame(at),eyeState:'unknown',face:false}, at, record);
    for (let at = 12100; at < 13400; at += 100) await run.capture(frame(at), at, record);
    expect(record).not.toHaveBeenCalled();
    await run.capture(frame(13400), 13400, record); expect(record).toHaveBeenCalledOnce();
  });
  it('holds the first instruction without labels before full travel and settling', async () => {
    const run = new CalibrationRun(viewport, 'comfortable');
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    expect(run.start(0)).toBe(true);
    expect(run.state.kind).toBe('reading');
    const record = vi.fn(async () => true);
    for (let at = 100; at < 6000; at += 100) await run.capture(frame(at), at, record);
    expect(record).not.toHaveBeenCalled();
    await run.capture(frame(6000), 6000, record);
    expect(record).toHaveBeenCalledOnce();
  });
  it('moves directly to the next head reference without a second reading pause', async () => {
    const run = new CalibrationRun(viewport, 'comfortable', () => 0);
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    run.state = { kind: 'sampling', stage: 'head', step: 0, samples: 2, lastLabelAt: -Infinity };
    const oldPoint = run.point; await run.capture(frame(0), 0, async () => true);
    expect(run.state).toMatchObject({ kind: 'moving', stage: 'head', step: 1, samples: 0, until: 1200 });
    expect(run.point).not.toEqual(oldPoint);
  });
  it('freezes the reading countdown on pause, then travels and settles fully with fresh frames', async () => {
    const run = new CalibrationRun(viewport, 'comfortable'), record = vi.fn(async () => true);
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    run.start(0);
    for (let at = 100; at <= 2000; at += 100) await run.capture(frame(at), at, record);
    run.pause();
    expect(run.state).toMatchObject({ kind: 'paused', reading: { remainingMs: 1000 } });
    for (let at = 2100; at <= 20000; at += 100) await run.capture(frame(at), at, record);
    expect(run.state).toMatchObject({ kind: 'paused', reading: { remainingMs: 1000 } });
    run.start(20000);
    for (let at = 20100; at < 24000; at += 100) await run.capture(frame(at), at, record);
    expect(record).not.toHaveBeenCalled();
    await run.capture(frame(23999), 24000, record); expect(record).not.toHaveBeenCalled();
    await run.capture(frame(24000), 24000, record); expect(record).toHaveBeenCalledOnce();
  });
  it('keeps the next head reference paused when the final acknowledgement arrives after pause', async () => {
    let clock = 0, ack: (value: boolean) => void = () => {};
    const run = new CalibrationRun(viewport, 'comfortable', () => clock);
    for (let at = -800; at <= 0; at += 100) run.tick(at, frame(at));
    run.state = { kind: 'sampling', stage: 'head', step: 3, samples: 2, lastLabelAt: -Infinity };
    const pending = run.capture(frame(0), 0, () => new Promise(resolve => { ack = resolve; }));
    run.pause(); clock = 10000; ack(true); await pending;
    expect(run.state).toMatchObject({ kind: 'paused', step: 4, reading: null });
    run.tick(30000, frame(30000));
    expect(run.state.kind).toBe('paused');
  });
});

it('provides one three-second head introduction and full travel/settle at all five references', async () => {
  let clock=0;
  const run=new CalibrationRun(viewport,'comfortable',()=>clock), record=vi.fn(async()=>true);
  for(let at=-800;at<=0;at+=100)run.tick(at,frame(at));
  run.state={kind:'ready',stage:'head',step:0,samples:0};expect(run.start(0)).toBe(true);
  expect(run.state).toMatchObject({kind:'reading',remainingMs:3000});
  for(let at=100;at<=3000;at+=100){clock=at;await run.capture(frame(at),at,record);}
  for(let step=0;step<5;step++) {
    expect(run.state).toMatchObject({kind:'moving',step});
    for(let delta=100;delta<=4600;delta+=100) {
      clock+=100;await run.capture(frame(clock),clock,record);
      if(delta<3000)expect(record).toHaveBeenCalledTimes(step*3);
    }
    expect(record).toHaveBeenCalledTimes((step+1)*3);
  }
  expect(run.state.kind).toBe('collected');
});
