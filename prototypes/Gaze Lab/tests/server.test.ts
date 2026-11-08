import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSessionFile, SESSION_MAGIC } from '../src/core/session-file';
import { parseReplayFile, buildReplayFile } from '../src/core/replay-file';
import { Uploader } from '../src/lab/uploader';
import { ClarteTimeline } from '../src/lab/recorder';

// A live instance of the real server on an ephemeral port; it writes under gaze-lab/sessions/<id>, removed afterwards.
const serverModule = await import('../server.mjs');
let origin = '', dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gaze-lab-'));
  await new Promise<void>(resolve => serverModule.server.listen(0, '127.0.0.1', () => resolve()));
  const address = serverModule.server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(async () => { await new Promise(resolve => serverModule.server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sessionDir = (id: string) => path.join(LAB, 'sessions', id);

describe('recording server', () => {
  const id = `test-${Date.now()}`;
  afterAll(async () => { await rm(sessionDir(id), { recursive: true, force: true }); });
  it('appends frames, landmarks and video in upload order and writes session/summary JSON', async () => {
    const uploader = new Uploader(origin, id);
    for (let i = 0; i < 5; i++) uploader.enqueue('frames', `{"i":${i}}\n`);
    uploader.enqueue('landmarks', new Uint8Array([1, 2, 3, 4]));
    uploader.enqueue('landmarks', new Uint8Array([5, 6, 7, 8]));
    uploader.enqueue('video', new Blob([new Uint8Array([9, 9])]));
    uploader.enqueue('video', new Blob([new Uint8Array([8])]));
    uploader.enqueue('session', JSON.stringify({ format: 'GAZE-LAB-SESSION-1', id }));
    uploader.enqueue('summary', JSON.stringify({ ok: 1 }));
    const status = await uploader.flush();
    expect(status.failed).toBe(0); expect(status.sent).toBe(11);
    expect(await readFile(path.join(sessionDir(id), 'frames.jsonl'), 'utf8')).toBe('{"i":0}\n{"i":1}\n{"i":2}\n{"i":3}\n{"i":4}\n');
    expect([...await readFile(path.join(sessionDir(id), 'landmarks.f32'))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...await readFile(path.join(sessionDir(id), 'video.webm'))]).toEqual([9, 9, 8]);
    expect(JSON.parse(await readFile(path.join(sessionDir(id), 'session.json'), 'utf8'))).toMatchObject({ id });
    expect(JSON.parse(await readFile(path.join(sessionDir(id), 'summary.json'), 'utf8'))).toEqual({ ok: 1 });
  });
  it('rejects bad ids, unknown parts and invalid JSON', async () => {
    expect((await fetch(`${origin}/api/session/../x/frames`, { method: 'POST', body: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${origin}/api/session/ok-id/nope`, { method: 'POST', body: 'x' })).status).toBe(400);
    expect((await fetch(`${origin}/api/session/ok-id/session`, { method: 'POST', body: '{not json' })).status).toBe(500);
    expect((await fetch(`${origin}/api/session/ok-id/frames`, { method: 'GET' })).status).toBe(404);
    await rm(sessionDir('ok-id'), { recursive: true, force: true });
  });
  it('splits a replay export into PNG files plus replay.json with the block side table', async () => {
    const png = (n: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n])]);
    const entry = (at: number, kind: 'calibration' | 'check', block: string) => ({ at, kind, label: [0, 0], headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], normPog: [0, 0], rawNormPog: [0, 0], faceRt: null, landmarks: [], frame: { width: 512, height: 128 }, block, point: kind === 'check' ? 3 : null });
    const blob = buildReplayFile({ createdAt: 1, model: 'm', viewport: { width: 10, height: 10 }, pixelRatio: 1, camera: null, crop: 'upstream' }, [entry(1, 'calibration', 'C0'), entry(2, 'check', 'B1')], [png(1), png(2)]);
    expect((await parseReplayFile(blob)).images).toHaveLength(2);
    const uploader = new Uploader(origin, id);
    uploader.enqueue('replay', blob);
    uploader.enqueue('replay', buildReplayFile({ createdAt: 1, model: 'm', viewport: { width: 10, height: 10 }, pixelRatio: 1, camera: null }, [entry(3, 'check', 'B2')], [png(3)]));
    expect((await uploader.flush()).failed).toBe(0);
    const files = (await readdir(path.join(sessionDir(id), 'eyestrips'))).sort();
    expect(files).toEqual(['00000.png', '00001.png', '00002.png', 'replay.json']);
    expect([...await readFile(path.join(sessionDir(id), 'eyestrips/00002.png'))]).toEqual([0x89, 0x50, 0x4e, 0x47, 3]);
    const manifest = JSON.parse(await readFile(path.join(sessionDir(id), 'eyestrips/replay.json'), 'utf8'));
    expect(manifest.entries.map((e: { file: string; block: string; point: number | null }) => [e.file, e.block, e.point])).toEqual([['00000.png', 'C0', null], ['00001.png', 'B1', 3], ['00002.png', 'B2', 3]]);
  });
  it('writes a .clarte-session that the copied parser reads back with the uploaded video bytes', async () => {
    const timeline = new ClarteTimeline(at => at - 1000);
    timeline.event(1000, { type: 'calibration-start' }); timeline.event(1500, { type: 'label', x: 0, y: 0, stage: 'eyes' }); timeline.event(2000, { type: 'train' }); timeline.event(2500, { type: 'trained' });
    timeline.event(3000, { type: 'check-start' }); timeline.event(3100, { type: 'check', x: .1, y: .2, index: 4 }); timeline.event(4000, { type: 'check-complete' }); timeline.event(4100, { type: 'end', reason: 'done' });
    timeline.dot(1200, 'calibration', 'eyes:moving', 0, 0); timeline.dot(3050, 'check', 'record', .1, .2);
    const manifest = timeline.manifest({ tester: 'T', sample: 1, model: 'm', viewport: { width: 100, height: 50 }, pixelRatio: 2, camera: { width: 1280, height: 720 }, mimeType: 'video/webm;codecs=vp9', durationMs: 3100, complete: true, live: { medianPx: 10, p90Px: 20, bins: 30 } });
    const uploader = new Uploader(origin, id);
    uploader.enqueue('clarte', JSON.stringify(manifest));
    expect((await uploader.flush()).failed).toBe(0);
    const file = path.join(sessionDir(id), `${id}.clarte-session`);
    expect((await stat(file)).size).toBeGreaterThan(0);
    const parsed = await parseSessionFile(new Blob([await readFile(file)]));
    expect(parsed.manifest.format).toBe(SESSION_MAGIC);
    expect(parsed.manifest.video.bytes).toBe(3); expect(parsed.video.size).toBe(3); expect([...new Uint8Array(await parsed.video.arrayBuffer())]).toEqual([9, 9, 8]);
    expect(parsed.manifest.events.map(e => e.type)).toEqual(['calibration-start', 'label', 'train', 'trained', 'check-start', 'check', 'check-complete', 'end']);
    expect(parsed.manifest.events[1]).toEqual({ type: 'label', t: 500, x: 0, y: 0, stage: 'eyes' });
    expect(parsed.manifest.dots).toEqual([[200, 'calibration', 'eyes:moving', 0, 0], [2050, 'check', 'record', .1, .2]]);
    expect(parsed.manifest.live).toEqual({ medianPx: 10, p90Px: 20, bins: 30 });
  });
});
