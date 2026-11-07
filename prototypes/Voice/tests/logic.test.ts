import { describe, expect, it } from 'vitest';
import { errorMessage, qualityWord, type Segment } from '../src/api';
import { ENOUGH_SECONDS, MINIMUM_SECONDS, PROMPTS } from '../src/prompts';
import { extensionFor, pickMimeType } from '../src/recorder';
import { bestFirst, selectedSeconds, stripBlocks } from '../src/strip';

const seg = (n: number, duration: number, quality: number, extra: Partial<Segment> = {}): Segment => ({
  n, file: 'a.m4a', start: n * 5, end: n * 5 + duration, duration, quality, snr_db: 30, voiced: 0.8,
  steadiness: 0.6, f0_hz: 120, clipped: 0, speaker_sim: 0.9, other_speaker: false, selected: true, ...extra,
});

describe('voice strip', () => {
  it('lays pieces end to end, best first, on a two-minute track', () => {
    const segments = [seg(0, 50, 0.9), seg(1, 50, 0.8), seg(2, 50, 0.7)];
    const blocks = stripBlocks({ segments, reference: { seconds: 120, segments: [1, 0, 2] } });
    expect(blocks.map((b) => b.n)).toEqual([1, 0, 2]);
    expect(blocks[1].left).toBeCloseTo(50.25 / 120);
    // The last piece is cut at the end of the track.
    const last = blocks[2];
    expect(last.left + last.width).toBeCloseTo(1, 5);
  });

  it('computes chosen seconds and best-first order for manual choices', () => {
    const segments = [seg(0, 2, 0.5), seg(1, 3, 0.9), seg(2, 4, 0.7)];
    expect(selectedSeconds(segments, [0, 1])).toBeCloseTo(5.25);
    expect(selectedSeconds(segments, [])).toBe(0);
    expect(bestFirst(segments, [0, 1, 2])).toEqual([1, 2, 0]);
  });
});

describe('labels and errors', () => {
  it('names quality in plain words and flags other speakers first', () => {
    expect(qualityWord({ quality: 0.9, other_speaker: false })).toBe('Clear');
    expect(qualityWord({ quality: 0.6, other_speaker: false })).toBe('Some noise');
    expect(qualityWord({ quality: 0.2, other_speaker: false })).toBe('Hard to hear');
    expect(qualityWord({ quality: 0.9, other_speaker: true })).toBe('Maybe someone else');
  });

  it('reads FastAPI error bodies', async () => {
    const json = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status });
    expect(await errorMessage(json({ detail: 'Confirm whose voice this is.' }))).toBe('Confirm whose voice this is.');
    expect(await errorMessage(json({ detail: { message: 'No usable speech.' } }))).toBe('No usable speech.');
    expect(await errorMessage(json({ detail: [{ msg: 'Field required' }] }, 422))).toBe('Field required');
    expect(await errorMessage(new Response('oops', { status: 500 }))).toBe('The voice service answered 500.');
  });
});

describe('recording', () => {
  it('prefers Opus and names files by container', () => {
    expect(pickMimeType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4');
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });

  it('asks for enough material, starting with the CAPE-V protocol', () => {
    expect(PROMPTS[0].id).toBe('ah');
    expect(PROMPTS.filter((p) => p.id.startsWith('cape-'))).toHaveLength(6);
    expect(MINIMUM_SECONDS).toBeLessThan(ENOUGH_SECONDS);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
  });
});
