import { describe, expect, it } from 'vitest';
import { buildSessionFile, parseSessionFile, sessionBaseName, SESSION_MAGIC, type SessionManifest } from '../src/core/session-file';
import { recordingMimeType } from '../src/core/session-recorder';
import { demuxWebm } from '../dev/webm-demux';
import { nearestFrames, region, scoreCheck } from '../dev/session-scoring';

const manifest = (over: Partial<SessionManifest> = {}): SessionManifest => ({
  format: SESSION_MAGIC, tester: 'Mukhtar', sample: 2, createdAt: Date.UTC(2026, 10, 7, 9, 30), model: 'm', viewport: { width: 1280, height: 800 }, pixelRatio: 2,
  camera: { width: 1280, height: 720 }, video: { mimeType: 'video/webm;codecs=vp9', bytes: 0, durationMs: 1000 }, complete: true, live: { medianPx: 80, p90Px: 160, bins: 300 },
  events: [{ type: 'calibration-start', t: 0 }, { type: 'label', t: 500, x: -.45, y: -.4, stage: 'eyes' }, { type: 'check', t: 900, x: .1, y: .2, index: 3 }],
  dots: [[400, 'calibration', 'eyes:sampling', -.45, -.4]], ...over,
});

describe('test session file', () => {
  it('round-trips the timeline and the video bytes', async () => {
    const video = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/webm' });
    const parsed = await parseSessionFile(buildSessionFile(manifest(), video));
    expect(parsed.manifest.tester).toBe('Mukhtar'); expect(parsed.manifest.sample).toBe(2);
    expect(parsed.manifest.video.bytes).toBe(5); expect(parsed.manifest.events).toHaveLength(3); expect(parsed.manifest.live?.medianPx).toBe(80);
    expect(Array.from(new Uint8Array(await parsed.video.arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.video.type).toBe('video/webm');
  });
  it('rejects other files and truncated videos', async () => {
    await expect(parseSessionFile(new Blob(['hello']))).rejects.toThrow('Not a Clarte test session');
    const whole = buildSessionFile(manifest(), new Blob([new Uint8Array(10)]));
    await expect(parseSessionFile(whole.slice(0, whole.size - 3))).rejects.toThrow('truncated');
  });
  it('names files by tester and sample, safely', () => {
    expect(sessionBaseName(manifest())).toBe('clarte-session-Mukhtar-2-2026-11-07T09-30-00-000Z');
    expect(sessionBaseName(manifest({ tester: ' Omer / test ', sample: 1 }))).toMatch(/^clarte-session-Omer-test-1-/);
    expect(sessionBaseName(manifest({ tester: '   ' }))).toMatch(/^clarte-session-tester-2-/);
  });
  it('prefers VP9, then VP8', () => {
    expect(recordingMimeType(t => t.includes('vp9'))).toBe('video/webm;codecs=vp9');
    expect(recordingMimeType(t => t.includes('vp8'))).toBe('video/webm;codecs=vp8');
    expect(recordingMimeType(() => false)).toBe('');
  });
});

/** Builds EBML elements: an ID's bytes, then a size (8-byte form, or unknown), then the payload. */
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const idBytes = (id: number) => { const b: number[] = []; for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v & 255); return new Uint8Array(b); };
const sized = (id: number, payload: Uint8Array) => { const size = new Uint8Array(8); size[0] = 0x01; let v = payload.length; for (let i = 7; i > 0; i--) { size[i] = v & 255; v = Math.floor(v / 256); } return concat(idBytes(id), size, payload); };
const unknownSize = (id: number, payload: Uint8Array) => concat(idBytes(id), new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), payload);
const uint = (id: number, value: number, length = 4) => { const b = new Uint8Array(length); for (let i = length - 1, v = value; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 255; return sized(id, b); };
const text = (id: number, value: string) => sized(id, new TextEncoder().encode(value));
const block = (track: number, relative: number, key: boolean, data: number[]) => sized(0xa3, new Uint8Array([0x80 | track, (relative >> 8) & 255, relative & 255, key ? 0x80 : 0, ...data]));

describe('WebM demuxer', () => {
  const webm = (codec = 'V_VP9') => concat(
    sized(0x1a45dfa3, text(0x4282, 'webm')),
    unknownSize(0x18538067, concat(
      sized(0x1549a966, uint(0x2ad7b1, 1_000_000, 3)),
      sized(0x1654ae6b, concat(
        sized(0xae, concat(uint(0xd7, 2, 1), uint(0x83, 2, 1), text(0x86, 'A_OPUS'))),
        sized(0xae, concat(uint(0xd7, 1, 1), uint(0x83, 1, 1), text(0x86, codec), sized(0xe0, concat(uint(0xb0, 1280, 2), uint(0xba, 720, 2))))),
      )),
      unknownSize(0x1f43b675, concat(uint(0xe7, 0, 1), block(1, 0, true, [9, 9]), block(2, 5, true, [7]), block(1, 33, false, [8]))),
      unknownSize(0x1f43b675, concat(uint(0xe7, 1000, 2), block(1, 0, false, [1, 2, 3]), block(1, 34, true, [4]))),
    )),
  );
  it('reads the video track, codec, size and every frame with its timestamp and key flag', () => {
    const video = demuxWebm(webm());
    expect(video).toMatchObject({ codecId: 'V_VP9', codec: 'vp09.00.10.08', width: 1280, height: 720 });
    expect(video.frames.map(f => [f.timestampMs, f.key, Array.from(f.data)])).toEqual([[0, true, [9, 9]], [33, false, [8]], [1000, false, [1, 2, 3]], [1034, true, [4]]]);
  });
  it('maps VP8 and rejects unsupported or empty files', () => {
    expect(demuxWebm(webm('V_VP8')).codec).toBe('vp8');
    expect(() => demuxWebm(webm('V_MPEG4/ISO/AVC'))).toThrow('Unsupported');
    expect(() => demuxWebm(sized(0x1a45dfa3, text(0x4282, 'webm')))).toThrow('No video track');
  });
});

describe('session scoring', () => {
  it('finds the nearest frame within a gap', () => {
    expect(nearestFrames([0, 33, 66, 100, 133], [32, 50, 140, 400, -10], 40)).toEqual([1, 2, 4, -1, 0]);
    expect(nearestFrames([], [1], 10)).toEqual([-1]);
  });
  it('classifies screen regions', () => {
    expect(region(0, 0)).toBe('center'); expect(region(.4, 0)).toBe('edges'); expect(region(-.4, .45)).toBe('corners');
  });
  it('scores like the app check, with regions, bias and model comparison', () => {
    const viewport = { width: 1000, height: 800 };
    const targets = [[-.4, -.4], [0, -.4], [.4, -.4], [-.4, 0], [0, 0], [.4, 0], [-.4, .4], [0, .4], [.4, .4]].map(([x, y]) => ({ x, y }));
    const samples = targets.flatMap((t, target) => Array.from({ length: 5 }, (_, k) => ({ target, t: k, estimate: { x: (t.x + .5) * 1000 + 3, y: (t.y + .5) * 800 - 40 } })));
    const score = scoreCheck(samples, targets, viewport)!;
    expect(score.samples).toBe(45); expect(score.medianPx).toBeCloseTo(Math.hypot(3, 40), 6);
    expect(score.bias).toEqual({ dx: 3, dy: -40 });
    expect(score.regions.map(r => [r.name, r.samples])).toEqual([['center', 5], ['edges', 20], ['corners', 20]]);
    const affine = score.corrections!.scores.find(s => s.model === 'affine')!.medianPx!;
    expect(affine).toBeLessThan(1);
    expect(scoreCheck([], targets, viewport)).toBeNull();
  });
});
