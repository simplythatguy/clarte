import { describe, expect, it } from 'vitest';
import { HeadPositionGuard, HEAD_STABLE_MS, readHeadPose, type HeadPose } from '../src/core/head-position';

const pose: HeadPose = { centerX: .5, centerY: .4, span: .3, roll: 0, yawRatio: 0, pitchRatio: .3 };
function fixture() {
  const head = new HeadPositionGuard();
  let now = 0;
  const sample = (current: HeadPose | null = pose, at = now + 100) => {
    now = at;
    return head.observe({ at, face: true, pose: current }, now);
  };
  const hold = (current = pose, count = 10) => { for (let i = 0; i < count; i++) sample(current); };
  const begin = () => { hold(); expect(head.establishReference(now)).toBe(true); };
  return { head, sample, hold, begin, get now() { return now; } };
}

describe('bounded head-position guard', () => {
  it('establishes only on explicit Start with stable fresh distinct pose samples', () => {
    const f = fixture();
    expect(f.head.establishReference(0)).toBe(false);
    f.sample();
    for (let now = 200; now < 800; now += 100) f.head.observe({ face: true, at: 100, pose }, now);
    expect(f.head.establishReference(700)).toBe(false);
    f.hold();
    expect(f.head.feedback(f.now).kind).toBe('setup');
    expect(f.head.allowsInput(f.now)).toBe(false);
    expect(f.head.establishReference(f.now)).toBe(true);
    expect(f.head.feedback(f.now).kind).toBe('matched');
  });

  it('tolerates small jitter, and uses a tighter recovery window to avoid chatter', () => {
    const f = fixture(); f.begin();
    for (let i = 0; i < 60; i++) expect(f.sample({ ...pose, centerX: .5 + (i % 2 ? .004 : -.004), roll: i % 2 ? .012 : -.012 }).kind).toBe('matched');
    expect(f.sample({ ...pose, centerX: .54 }).kind).toBe('changed');
    // Within the outer limit, outside the recovery limit: remains held.
    for (let i = 0; i < 20; i++) expect(f.sample({ ...pose, centerX: .53 }).kind).toBe('changed');
    expect(f.sample().kind).toBe('recovering');
    f.hold(pose, HEAD_STABLE_MS / 100 - 1);
    expect(f.head.allowsInput(f.now)).toBe(false);
    expect(f.sample().kind).toBe('matched');
  });

  it.each([
    { centerX: .55 }, { centerY: .45 }, { span: .35 }, { roll: .16 }, { yawRatio: .15 }, { pitchRatio: .45 },
  ])('immediately holds deliberate translation, size or orientation change %o', change => {
    const f = fixture(); f.begin();
    const original = f.head.feedback(f.now).reference;
    expect(f.sample({ ...pose, ...change }).kind).toBe('changed');
    f.hold({ ...pose, ...change }, 100);
    expect(f.head.establishReference(f.now)).toBe(false);
    expect(f.head.feedback(f.now).reference).toEqual(original);
    f.hold();
    expect(f.head.feedback(f.now).kind).toBe('matched');
    expect(f.head.feedback(f.now).reference).toEqual(original);
    // A new explicit calibration lifecycle may establish a different position.
    const next = fixture(); next.hold({ ...pose, ...change });
    expect(next.head.establishReference(next.now)).toBe(true);
    const reference = next.head.feedback(next.now).reference;
    expect(reference).not.toBeNull();
    const dimensions: (keyof HeadPose)[] = ['centerX', 'centerY', 'span', 'roll', 'yawRatio', 'pitchRatio'];
    for (const key of dimensions) expect(reference?.[key]).toBeCloseTo({ ...pose, ...change }[key]);
  });

  it('rejects missing, stale, future, lost and repeated frames without recovering on clock time', () => {
    const f = fixture(); f.begin();
    expect(f.sample(null).kind).toBe('missing');
    f.head.observe({ face: true, pose, at: f.now }, f.now);
    expect(f.head.feedback(f.now).kind).toBe('missing');
    f.hold();
    expect(f.head.feedback(f.now).kind).toBe('matched');
    const old = f.now;
    expect(f.head.feedback(old + 601).kind).toBe('missing');
    expect(f.head.feedback(old + 601).current).toBeNull();
    f.head.observe({ face: true, pose, at: old + 1000 }, old + 601);
    expect(f.head.allowsInput(old + 601)).toBe(false);
    f.head.observe({ face: true, pose, at: old }, old + 700);
    expect(f.head.allowsInput(old + 700)).toBe(false);
    f.head.observe({ face: false, pose, at: old + 800 }, old + 800);
    expect(f.head.feedback(old + 800).current).toBeNull();
    f.head.observe({ face: true, pose, at: old + 900 }, old + 900);
    // Silence and callbacks repeating that image never provide stable evidence.
    for (let now = old + 1000; now <= old + 2500; now += 100) {
      f.head.observe({ face: true, pose, at: old + 900 }, now);
      expect(f.head.allowsInput(now)).toBe(false);
    }
  });

  it('does not acquire a reference from unsettled samples or a single held image', () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.sample({ ...pose, centerX: i % 2 ? .52 : .48 });
    expect(f.head.establishReference(f.now)).toBe(false);
    f.hold();
    expect(f.head.establishReference(f.now + 601)).toBe(false);
  });

  it('can acquire and recover with a high-frame-rate camera without filling the stability window too early', () => {
    const guard = new HeadPositionGuard();
    for (let at = 8; at <= 1000; at += 8) guard.observe({ face: true, pose, at }, at);
    expect(guard.establishReference(1000)).toBe(true);
    guard.observe({ face: true, pose: null, at: 1008 }, 1008);
    for (let at = 1016; at <= 2016; at += 8) guard.observe({ face: true, pose, at }, at);
    expect(guard.allowsInput(2016)).toBe(true);
  });

  it('parses only finite geometry, including portrait image coordinates', () => {
    expect(readHeadPose(pose)).toEqual(pose);
    expect(readHeadPose({ ...pose, centerY: 1.1 })).not.toBeNull();
    for (const invalid of [null, {}, { ...pose, span: 0 }, { ...pose, roll: NaN }, { ...pose, pitchRatio: Infinity }, { ...pose, centerX: '0.5' }]) expect(readHeadPose(invalid)).toBeNull();
  });

});
