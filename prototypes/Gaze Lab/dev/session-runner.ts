import type { SessionFile, SessionManifest } from '../src/core/session-file';
import type { WorkerGaze } from '../src/core/tracking';
import type { TrainingOptions, TrainingReport } from '../src/core/training';
import { demuxWebm } from './webm-demux';
import { nearestFrames, scoreCheck, toPixels, type CheckScore, type ScoredSample } from './session-scoring';

/**
 * Replays a recorded test session through the real tracker worker, deterministically:
 * every recorded video frame is decoded with WebCodecs, the app's calibration labels are applied to
 * the same moments, the estimator is trained, and the free-flow check is scored on the same frames.
 * Any change to the tracker (worker, preprocessing, model, training) is measured by rerunning this.
 */
export type ReplayOptions = { workerUrl?: string; maxWidth?: number; onProgress?: (text: string) => void; /** Calibration training settings to A/B; omitted means the build's defaults. */ training?: Partial<TrainingOptions> | null; /** Eye strips from a pose-normalized view (development comparison). */ normalizedCrop?: boolean };
export type SessionScore = {
  tester: string; sample: number; complete: boolean; durationS: number;
  frames: { decoded: number; processed: number; withFace: number; openEyes: number };
  labels: { recorded: number; collected: number; missed: number };
  trained: boolean;
  crop: 'upstream' | 'normalized';
  training: TrainingReport | null;
  live: SessionManifest['live'];
  check: CheckScore | null;
  notes: string[];
  elapsedS: number;
};

type Call = (type: string, payload?: unknown, transfer?: Transferable[]) => Promise<unknown>;
/** A worker that crashes or stalls must fail the replay loudly, never hang it: every call has a deadline and worker errors reject it. */
function workerCaller(worker: Worker, deadlineMs = 120000): Call {
  let id = 0;
  const pending = new Map<number, (error: Error) => void>();
  worker.addEventListener('error', event => { const error = new Error(`Worker crashed: ${event.message || 'unknown error'}`); for (const fail of pending.values()) fail(error); pending.clear(); });
  return (type, payload = null, transfer = []) => new Promise((resolve, reject) => {
    const me = ++id;
    const timer = setTimeout(() => { pending.delete(me); worker.removeEventListener('message', onMessage); reject(new Error(`Worker did not answer '${type}' within ${deadlineMs / 1000} s`)); }, deadlineMs);
    const onMessage = ({ data }: MessageEvent) => {
      if (!data || data.id !== me) return;
      clearTimeout(timer); pending.delete(me);
      worker.removeEventListener('message', onMessage);
      if ('error' in data) reject(new Error(data.error)); else resolve(data.value);
    };
    pending.set(me, error => { clearTimeout(timer); worker.removeEventListener('message', onMessage); reject(error); });
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id: me, type, payload }, transfer);
  });
}

export async function replaySession(session: SessionFile, options: ReplayOptions = {}): Promise<SessionScore> {
  const started = performance.now(), progress = options.onProgress ?? (() => {});
  const { manifest } = session, notes: string[] = [];
  const video = demuxWebm(await session.video.arrayBuffer());
  if (!video.frames.length || !video.frames[0].key) throw new Error('Recording has no decodable first frame');
  const config: VideoDecoderConfig = { codec: video.codec, codedWidth: video.width, codedHeight: video.height };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error(`This browser cannot decode ${video.codecId}`);

  const labels = manifest.events.flatMap(e => (e.type === 'label' ? [e] : []));
  const checks = manifest.events.flatMap(e => (e.type === 'check' ? [e] : []));
  const trainAt = manifest.events.find(e => e.type === 'train')?.t ?? Infinity;
  const frameTimes = video.frames.map(f => f.timestampMs);
  const checkFrame = nearestFrames(frameTimes, checks.map(c => c.t), 80);
  const checksAtFrame = new Map<number, number[]>();
  checkFrame.forEach((frame, i) => { if (frame >= 0) checksAtFrame.set(frame, [...(checksAtFrame.get(frame) ?? []), i]); });
  // Frames near a labelled or scored moment are always processed; the rest every third frame keeps tracker state warm.
  const important = new Set<number>();
  for (const t of [...labels.map(l => l.t), ...checks.map(c => c.t)]) frameTimes.forEach((ft, i) => { if (Math.abs(ft - t) <= 250) important.add(i); });

  const worker = new Worker(options.workerUrl ?? '/vendor/webeyetrack/worker.js');
  const call = workerCaller(worker);
  const targets: { x: number; y: number }[] = [], targetIndex = new Map<string, number>();
  const samples: ScoredSample[] = [];
  const counts = { decoded: 0, processed: 0, withFace: 0, openEyes: 0 };
  let collected = 0, missed = 0, trained = false, trainTried = false, nextLabel = 0, lastAt = -Infinity, trainingReport: TrainingReport | null = null;
  const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Replay canvas unavailable');

  // Stall watchdog: names the await the replay is stuck in, so a hang is reported instead of waited on.
  let stage = 'starting', stageAt = performance.now();
  const mark = (name: string) => { stage = name; stageAt = performance.now(); };
  const watchdog = setInterval(() => { if (performance.now() - stageAt > 20000) progress(`Stalled for ${Math.round((performance.now() - stageAt) / 1000)} s at: ${stage}`); }, 5000);
  let pending: { resolve: (frame: VideoFrame) => void; reject: (error: Error) => void } | null = null;
  const decoder = new VideoDecoder({ output: frame => { const p = pending; pending = null; if (p) p.resolve(frame); else frame.close(); }, error: error => { const p = pending; pending = null; p?.reject(error instanceof Error ? error : new Error(String(error))); } });
  try {
    await call('init', { development: false, normalizeCrop: options.normalizedCrop === true });
    decoder.configure(config);
    for (let i = 0; i < video.frames.length; i++) {
      const chunk = video.frames[i];
      const output = new Promise<VideoFrame>((resolve, reject) => { pending = { resolve, reject }; });
      mark(`decoding frame ${i} (queue ${decoder.decodeQueueSize}, state ${decoder.state})`);
      decoder.decode(new EncodedVideoChunk({ type: chunk.key ? 'key' : 'delta', timestamp: Math.round(chunk.timestampMs * 1000), data: chunk.data }));
      const frame = await output;
      mark(`after decode ${i}`);
      counts.decoded++;
      const t = chunk.timestampMs;
      // Train once every recorded label has had its chance, at the moment the app trained.
      if (!trainTried && t >= trainAt) {
        trainTried = true;
        missed += labels.length - nextLabel; nextLabel = labels.length;
        if (collected >= 27) {
          try { progress(`Training on ${collected} labels…`); await call('train', options.training ?? null); trained = true; trainingReport = (await call('trainingReport')) as TrainingReport | null; }
          catch (error) { notes.push(`Training failed: ${error instanceof Error ? error.message : error}`); }
        }
      }
      const due = nextLabel < labels.length && t >= labels[nextLabel].t - 60;
      if (!important.has(i) && !due && i % 3 !== 0) { frame.close(); continue; }
      const width = Math.min(options.maxWidth ?? 1280, frame.displayWidth), height = Math.round(frame.displayHeight * width / frame.displayWidth);
      canvas.width = width; canvas.height = height;
      context.drawImage(frame, 0, 0, width, height); frame.close();
      const image = context.getImageData(0, 0, width, height);
      const at = Math.max(t, lastAt + .001); lastAt = at;
      mark(`worker step for frame ${i}`);
      const result = await call('step', { frame: image, at, epoch: performance.timeOrigin + performance.now() }, [image.data.buffer]) as WorkerGaze;
      mark(`after step ${i}`);
      counts.processed++;
      if (result.facePresent) counts.withFace++;
      if (result.eyeState === 'open') counts.openEyes++;
      // Calibration: apply the recorded label to the nearest usable frame (the dot was settled there).
      while (nextLabel < labels.length && !trained) {
        const label = labels[nextLabel];
        if (t < label.t - 60) break;
        if (t > label.t + 150) { missed++; nextLabel++; continue; }
        if (await call('collect', { at, x: label.x, y: label.y }) === true) { collected++; nextLabel++; }
        break;
      }
      // Check: score the raw (pre-filter) estimate against the dot the app was measuring.
      if (trained && result.rawNormPog) for (const c of checksAtFrame.get(i) ?? []) {
        const event = checks[c], key = `${event.index}`;
        if (!targetIndex.has(key)) { targetIndex.set(key, targets.length); targets.push({ x: event.x, y: event.y }); }
        const px = (p: number[] | null | undefined) => (p && p.length === 2 ? toPixels(p[0], p[1], manifest.viewport) : null);
        samples.push({ estimate: toPixels(result.rawNormPog[0], result.rawNormPog[1], manifest.viewport), target: targetIndex.get(key)!, t, estimates: result.estimates ? { network: px(result.estimates.network), geometric: px(result.estimates.geometric) } : null });
      }
      if (counts.decoded % 60 === 0) progress(`${manifest.tester} #${manifest.sample}: frame ${counts.decoded}/${video.frames.length}, ${collected} labels, ${samples.length} check samples`);
    }
    await decoder.flush().catch(() => {});
  } finally { clearInterval(watchdog); decoder.close(); worker.terminate(); }

  if (!labels.length) notes.push('No calibration labels were recorded.');
  if (collected < 27) notes.push(`Only ${collected} of ${labels.length} labels could be replayed (the tracker needs 27 on 9 dots).`);
  if (!checks.length) notes.push('No free-flow check was recorded, so there is nothing to score.');
  if (counts.processed && counts.withFace / counts.processed < .8) notes.push(`A face was found in only ${Math.round(100 * counts.withFace / counts.processed)}% of processed frames.`);
  return {
    tester: manifest.tester, sample: manifest.sample, complete: manifest.complete, durationS: Math.round(manifest.video.durationMs / 100) / 10,
    frames: counts, labels: { recorded: labels.length, collected, missed }, trained, crop: options.normalizedCrop ? 'normalized' : 'upstream', training: trainingReport,
    live: manifest.live ?? null,
    check: trained ? scoreCheck(samples, targets, manifest.viewport) : null, notes, elapsedS: Math.round((performance.now() - started) / 100) / 10,
  };
}
