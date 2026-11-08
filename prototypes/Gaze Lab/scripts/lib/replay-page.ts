/**
 * Browser side of scripts/replay-blocks.mjs (bundled with esbuild at run time and served as /replay-page.js).
 * Decodes the session's video.webm with WebCodecs frame by frame and feeds the frames the live run processed (one decoded
 * frame per live frames.jsonl row, nearest to row.videoT + offset) to the gaze-lab worker, applies the recorded calibration
 * labels on the recorded frames, trains at the recorded train moment, and returns one record per stepped frame.
 * `align` mode instead steps the five decoded frames around sampled live rows and measures the landmark distance to the
 * recorded landmarks, so the video-clock offset between MediaRecorder timestamps and the live `videoT` can be estimated.
 */
import { demuxWebm } from '../../dev/webm-demux';

type LiveRow = { idx: number; t: number; videoT: number; landmarkRow: number | null };
type Label = { rowIdx: number; x: number; y: number; t: number };
export type Payload = {
  videoUrl: string; landmarksUrl: string | null; workerUrl: string;
  rows: LiveRow[]; labels: Label[]; trainRowIdx: number | null; trainAt: number;
  fixes: { matrixLayout: boolean; freezePose: boolean };
  mode: 'align' | 'run' | 'strips'; offsetMs: number; alignRows: number[]; maxGapMs: number; maxWidth: number;
  /** strips mode: live eye-strip PNG per label row index (served from the session's eyestrips folder). */
  liveStrips?: Record<number, string>;
};
type Call = (type: string, payload?: unknown, transfer?: Transferable[]) => Promise<any>;
function workerCaller(url: string, deadlineMs = 180000): { call: Call; terminate: () => void } {
  const worker = new Worker(url); let id = 0;
  const call: Call = (type, payload = null, transfer = []) => new Promise((resolve, reject) => {
    const me = ++id;
    const timer = setTimeout(() => { worker.removeEventListener('message', onMessage); reject(new Error(type + ' timed out')); }, deadlineMs);
    const onMessage = ({ data }: MessageEvent) => { if (!data || data.id !== me) return; clearTimeout(timer); worker.removeEventListener('message', onMessage); if ('error' in data) reject(new Error(data.error)); else resolve(data.value); };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', e => { clearTimeout(timer); reject(new Error('worker error: ' + e.message)); }, { once: true });
    worker.postMessage({ id: me, type, payload }, transfer);
  });
  return { call, terminate: () => worker.terminate() };
}
const log = (...a: unknown[]) => console.log('[replay]', ...a);
const LANDMARK_FLOATS = 478 * 3;

/** Nearest index in ascending `times` to `t`. */
function nearest(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t) ? lo - 1 : lo;
}

export async function run(P: Payload) {
  const started = performance.now();
  const bytes = new Uint8Array(await (await fetch(P.videoUrl)).arrayBuffer());
  const video = demuxWebm(bytes);
  const landmarks = P.landmarksUrl ? new Float32Array(await (await fetch(P.landmarksUrl)).arrayBuffer()) : null;
  log(`demuxed ${video.frames.length} frames (${video.codecId} ${video.width}×${video.height}), ${(bytes.length / 1e6).toFixed(0)} MB, landmarks ${landmarks ? landmarks.length / LANDMARK_FLOATS : 0} rows`);
  if (!video.frames.length || !video.frames[0].key) throw new Error('Recording has no decodable first frame');
  const config: VideoDecoderConfig = { codec: video.codec, codedWidth: video.width, codedHeight: video.height };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error(`Cannot decode ${video.codecId}`);
  const times = video.frames.map(f => f.timestampMs);
  const dt = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const frameDt = dt[Math.floor(dt.length / 2)];

  // Which decoded frame each live row gets (run mode): nearest to videoT + offset within maxGapMs; a frame serves one row.
  const plan = new Map<number, { row: LiveRow; gapMs: number }>();
  const alignPlan = new Map<number, { row: LiveRow; k: number }[]>();
  let unmatched = 0;
  if (P.mode === 'run' || P.mode === 'strips') {
    for (const row of (P.mode === 'strips' ? P.rows.filter(r => P.labels.some(l => l.rowIdx === r.idx)) : P.rows)) {
      const j = nearest(times, row.videoT + P.offsetMs), gap = times[j] - (row.videoT + P.offsetMs);
      if (Math.abs(gap) > P.maxGapMs) { unmatched++; continue; }
      const taken = plan.get(j);
      if (!taken || Math.abs(gap) < Math.abs(taken.gapMs)) { if (taken) unmatched++; plan.set(j, { row, gapMs: gap }); } else unmatched++;
    }
  } else {
    for (const idx of P.alignRows) {
      const row = P.rows.find(r => r.idx === idx); if (!row || row.landmarkRow === null) continue;
      const j = nearest(times, row.videoT);
      for (let k = -2; k <= 2; k++) if (j + k >= 0 && j + k < times.length) alignPlan.set(j + k, [...(alignPlan.get(j + k) ?? []), { row, k }]);
    }
  }
  const labelsByRow = new Map<number, Label>(); P.labels.forEach(l => labelsByRow.set(l.rowIdx, l));
  const worker = workerCaller(P.workerUrl);
  const init = await worker.call('init', { development: P.mode === 'strips', debug: true, fixes: P.fixes });
  if (P.mode === 'strips') await worker.call('recording', { enabled: true });
  if (!init || JSON.stringify(init.fixes) !== JSON.stringify(P.fixes)) throw new Error(`worker init did not take the fixes: ${JSON.stringify(init)}`);
  log(`worker ready: backend ${init.backend}, fixes ${JSON.stringify(init.fixes)}, mode ${P.mode}, offset ${P.offsetMs} ms, planned ${plan.size} steps, unmatched rows ${unmatched}`);
  const canvas = new OffscreenCanvas(1, 1), ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  const records: unknown[] = [], alignRecords: unknown[] = [];
  const counts = { decoded: 0, stepped: 0, withFace: 0, openEyes: 0, collected: 0, shifted: 0, missed: 0 };
  let pendingLabel: Label | null = null, trained = false, trainingReport: unknown = null, trainError: string | null = null, lastAt = -Infinity;
  const landmarkDelta = (lm: number[], rowIdx: number | null) => {
    if (!landmarks || rowIdx === null || lm.length !== LANDMARK_FLOATS) return null;
    let s = 0; const o = rowIdx * LANDMARK_FLOATS; if (o + LANDMARK_FLOATS > landmarks.length) return null;
    for (let i = 0; i < LANDMARK_FLOATS; i++) s += Math.abs(lm[i] - landmarks[o + i]);
    return s / LANDMARK_FLOATS;
  };
  const stepFrame = async (frame: VideoFrame, row: LiveRow) => {
    const width = Math.min(P.maxWidth, frame.displayWidth), height = Math.round(frame.displayHeight * width / frame.displayWidth);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.drawImage(frame, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const at = Math.max(row.t, lastAt + .001); lastAt = at;
    const r = await worker.call('step', { frame: image, at, epoch: performance.timeOrigin + performance.now() }, [image.data.buffer]);
    return { at, r };
  };
  const onDecoded = async (frame: VideoFrame, j: number) => {
    counts.decoded++;
    try {
      if (P.mode === 'align') {
        const list = alignPlan.get(j); if (!list) return;
        for (const { row, k } of list) {
          const { r } = await stepFrame(frame, { ...row, t: 1e6 + counts.decoded });
          alignRecords.push({ idx: row.idx, k, ts: times[j], videoT: row.videoT, facePresent: r.facePresent, lmd: r.debug ? landmarkDelta(r.debug.landmarks, row.landmarkRow) : null });
        }
        return;
      }
      const planned = plan.get(j); if (!planned) return;
      const { row } = planned;
      // Train at the recorded moment, before the first frame at or after it.
      if (!trained && !trainError && P.trainRowIdx !== null && row.idx >= P.trainRowIdx) {
        if (pendingLabel) { counts.missed++; pendingLabel = null; }
        log(`training on ${counts.collected} labels at videoT ${row.videoT}`);
        try { await worker.call('train', null); trained = true; trainingReport = await worker.call('trainingReport'); log('trained', JSON.stringify(trainingReport)); }
        catch (e) { trainError = e instanceof Error ? e.message : String(e); log('training failed: ' + trainError); }
      }
      const { at, r } = await stepFrame(frame, row);
      counts.stepped++; if (r.facePresent) counts.withFace++; if (r.eyeState === 'open') counts.openEyes++;
      // Labels: the recorded label frame first, else the following frames within +150 ms of the recorded label time.
      let labelResult: string | null = null;
      const own = labelsByRow.get(row.idx);
      if (own && !trained) { if (pendingLabel) { counts.missed++; } pendingLabel = own; }
      if (pendingLabel && !trained) {
        if (row.videoT > pendingLabel.t + 150) { counts.missed++; labelResult = 'missed'; pendingLabel = null; }
        else {
          const ok = await worker.call('collect', { at, x: pendingLabel.x, y: pendingLabel.y }) === true;
          if (ok) { counts.collected++; if (pendingLabel.rowIdx === row.idx) labelResult = 'collected'; else { counts.shifted++; labelResult = 'shifted'; } pendingLabel = null; }
          else labelResult = 'retry';
        }
      }
      const d = r.debug ?? null;
      records.push({ idx: row.idx, ts: times[j], gap: planned.gapMs, fp: r.facePresent, es: r.eyeState, raw: r.rawNormPog, net: r.estimates?.network ?? null, geo: r.estimates?.geometric ?? null,
        hv: d && r.facePresent ? d.headVector : null, fo: d && r.facePresent ? d.faceOrigin3D : null, rt: d?.faceRt ?? null, lmd: d ? landmarkDelta(d.landmarks, row.landmarkRow) : null, label: labelResult, trained });
      if (counts.stepped % 500 === 0) log(`${counts.stepped} stepped / ${counts.decoded} decoded, ${counts.collected} labels, trained ${trained}, ${((performance.now() - started) / 1000).toFixed(0)} s`);
    } finally { frame.close(); }
  };
  // Decode sequentially; outputs are matched to chunks by timestamp and processed in order.
  const byTs = new Map<number, number>(); video.frames.forEach((f, i) => byTs.set(Math.round(f.timestampMs * 1000), i));
  const outputs: VideoFrame[] = []; let wake: (() => void) | null = null, decodeError: Error | null = null;
  const decoder = new VideoDecoder({ output: f => { outputs.push(f); wake?.(); }, error: e => { decodeError = e instanceof Error ? e : new Error(String(e)); wake?.(); } });
  decoder.configure(config);
  const drain = async () => { while (outputs.length) { const f = outputs.shift()!; const j = byTs.get(f.timestamp); if (j === undefined) { f.close(); continue; } await onDecoded(f, j); } };
  for (let i = 0; i < video.frames.length; i++) {
    const c = video.frames[i];
    decoder.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: Math.round(c.timestampMs * 1000), data: c.data }));
    while (decoder.decodeQueueSize > 2 && !outputs.length && !decodeError) await new Promise<void>(r => { wake = r; setTimeout(r, 50); });
    if (decodeError) throw decodeError;
    await drain();
  }
  await decoder.flush().catch(() => {}); await drain(); decoder.close();
  if (P.mode === 'run' && !trained && !trainError && P.trainRowIdx !== null) trainError = 'train moment never reached';
  // strips mode: the worker kept the eye strip of every collected label; compare each with the live PNG of the same frame.
  const strips: unknown[] = [];
  if (P.mode === 'strips') {
    const exported = await worker.call('exportReplay');
    const draw = async (blob: Blob) => { const bmp = await createImageBitmap(blob); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d')!; x.drawImage(bmp, 0, 0); bmp.close(); return x.getImageData(0, 0, c.width, c.height); };
    for (let k = 0; k < exported.entries.length; k++) {
      const e = exported.entries[k];
      const row = P.rows.find(r => Math.abs(r.t - e.at) < 1e-6);
      const liveFile = row ? P.liveStrips?.[row.idx] : undefined;
      if (!row || !liveFile) { strips.push({ at: e.at, error: 'no live strip' }); continue; }
      const a = await draw(exported.images[k]), b = await draw(await (await fetch('/eyestrips/' + liveFile)).blob());
      if (a.width !== b.width || a.height !== b.height) { strips.push({ idx: row.idx, error: `size ${a.width}×${a.height} vs ${b.width}×${b.height}` }); continue; }
      let sum = 0, sq = 0, max = 0, n = 0; const signed = [0, 0, 0], meanA = [0, 0, 0], meanB = [0, 0, 0];
      for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; signed[c] += d; meanA[c] += a.data[i + c]; meanB[c] += b.data[i + c]; const ad = Math.abs(d); sum += ad; sq += d * d; if (ad > max) max = ad; n++; }
      const px = n / 3;
      strips.push({ idx: row.idx, at: e.at, label: e.label, meanAbs: sum / n, rmse: Math.sqrt(sq / n), psnr: sq ? 10 * Math.log10(255 * 255 / (sq / n)) : Infinity, max, signedMeanRGB: signed.map(v => v / px), meanReplayRGB: meanA.map(v => v / px), meanLiveRGB: meanB.map(v => v / px), width: a.width, height: a.height, replayNetwork: e.rawNormPog, headVector: e.headVector, faceOrigin3D: e.faceOrigin3D });
    }
  }
  worker.terminate();
  return { backend: init.backend, fixes: init.fixes, video: { frames: video.frames.length, codec: video.codecId, width: video.width, height: video.height, frameDtMs: frameDt, firstTs: times[0], lastTs: times[times.length - 1] }, counts, unmatched, trained, trainingReport, trainError, records, alignRecords, strips, elapsedS: (performance.now() - started) / 1000 };
}
(window as unknown as { replay: { run: typeof run } }).replay = { run };
