import { describe, expect, it } from 'vitest';
import { FrameLog, LANDMARK_FLOATS, type FrameRow } from '../src/lab/frames';
import { summarizeBlock } from '../src/lab/summary';
import { validationTargets } from '../src/lab/layout';
import { headReference } from '../src/lab/head';

const viewport = { width: 1000, height: 500 };
const base = (over: Partial<FrameRow>): Omit<FrameRow, 'i' | 'landmarkRow'> => ({
  t: 0, videoT: null, screen: 'block', block: 'B1', point: 0, phase: 'record', target: { x: 125, y: 50, nx: -.375, ny: -.4 },
  rawNormPog: null, network: null, geometric: null, normPog: null, pointer: null, facePresent: true, face: true, eyeState: 'open', pose: null, camera: null,
  headVector: null, faceOrigin3D: [0, 0, 60], faceRt: null, features12: null, gaze: null, timings: null, candidate: null, viewport, ...over,
});

describe('frame log batching', () => {
  it('assigns landmark rows only to frames with 478 landmarks and flushes JSONL plus float32 bytes every batch interval', () => {
    let now = 0;
    const batches: { jsonl: string; bytes: number | null }[] = [];
    const log = new FrameLog((jsonl, lm) => batches.push({ jsonl, bytes: lm ? lm.byteLength : null }), 2000, () => now);
    const a = log.add(base({ t: 1 }), Array.from({ length: LANDMARK_FLOATS }, (_, i) => i / 1000));
    const b = log.add(base({ t: 2 }), null);
    const c = log.add(base({ t: 3 }), Array.from({ length: LANDMARK_FLOATS }, () => 1));
    expect([a.landmarkRow, b.landmarkRow, c.landmarkRow]).toEqual([0, null, 1]);
    expect([a.i, b.i, c.i]).toEqual([0, 1, 2]);
    expect(batches).toHaveLength(1); // the first add flushes at t=0 (since -Infinity)
    now = 2500; log.add(base({ t: 4 }), null);
    expect(batches).toHaveLength(2);
    const lines = batches[1].jsonl.trim().split('\n');
    expect(lines).toHaveLength(3); // rows 1, 2 and 3 (row 0 went out in the first flush)
    expect(JSON.parse(lines[0])).toMatchObject({ i: 1, landmarkRow: null });
    expect(batches[1].bytes).toBe(LANDMARK_FLOATS * 4);
    log.flush(); expect(log.pending).toBe(0);
  });
});

describe('block summary', () => {
  it('scores record-phase frames with a face and open eyes only, per estimator and per axis, with cell hits and head shift', () => {
    const targets = validationTargets(viewport), reference = headReference([{ origin: [0, 0, 60], faceRt: null }])!;
    const rows: FrameRow[] = [];
    const push = (over: Partial<FrameRow>) => rows.push({ ...base(over), i: rows.length, landmarkRow: null });
    // Dot 0 at (125, 50): blend 20 px right and 40 px below; network 10 px right; geometric missing.
    for (let k = 0; k < 5; k++) push({ point: 0, target: { x: 125, y: 50, nx: -.375, ny: -.4 }, rawNormPog: [-.375 + .02, -.4 + .08], network: [-.375 + .01, -.4], faceOrigin3D: [10, 0, 60] });
    // Excluded frames: travel phase, closed eyes, no face.
    push({ point: 0, phase: 'travel', rawNormPog: [.4, .4] });
    push({ point: 0, eyeState: 'closed', face: false, rawNormPog: [.4, .4] });
    push({ point: 0, facePresent: false, face: false, eyeState: 'unknown', rawNormPog: [.4, .4] });
    // Dot 7 at (875, 125), cell 3: blend lands in the wrong cell (bottom row).
    for (let k = 0; k < 3; k++) push({ point: 7, target: { x: 875, y: 125, nx: .375, ny: -.25 }, rawNormPog: [.375, .3], network: [.375, -.25], faceOrigin3D: [10, 0, 60] });
    const s = summarizeBlock('B1', rows, targets, viewport, .02, reference);
    expect(s.frames).toEqual({ total: 11, record: 10, used: 8 });
    expect(s.estimators.geometric).toBeNull();
    expect(s.estimators.blend!.frames).toBe(8);
    // Dot 0 errors: dx 20, dy 40 → 44.7 px; dot 7: dx 0, dy 275 px. Median of [44.7×5, 275×3] = 44.7.
    expect(s.estimators.blend!.medianPx).toBeCloseTo(Math.hypot(20, 40), 3);
    expect(s.estimators.blend!.medianAbsDxPx).toBeCloseTo(20, 3); expect(s.estimators.blend!.medianAbsDyPx).toBeCloseTo(40, 3);
    expect(s.estimators.blend!.biasDyPx).toBeCloseTo(40, 3); expect(s.estimators.blend!.medianCm).toBeCloseTo(Math.hypot(20, 40) * .02, 3);
    expect(s.estimators.network!.medianPx).toBeCloseTo(10, 3);
    expect(s.cellHit).toEqual({ hits: 1, points: 2 });
    expect(s.headShift).toMatchObject({ dx: 10, dy: 0, dz: 0, samples: 8 });
  });
});
