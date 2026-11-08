import { recordingMimeType } from '../core/session-recorder';
import type { DotRow, SessionEvent, SessionManifest } from '../core/session-file';
import type { Viewport } from '../core/tracking';

/** Raw camera video through MediaRecorder; chunks go to `onChunk` in order and `time()` gives the video clock. */
export class VideoRecorder {
  private recorder: MediaRecorder;
  private startedAt: number;
  private index = 0;
  readonly mimeType: string;
  private stopped: Promise<void> | null = null;
  constructor(stream: MediaStream, private readonly onChunk: (chunk: Blob, index: number) => void, private readonly clock: () => number = () => performance.now()) {
    this.mimeType = recordingMimeType();
    this.recorder = new MediaRecorder(new MediaStream(stream.getVideoTracks()), { ...(this.mimeType ? { mimeType: this.mimeType } : {}), videoBitsPerSecond: 5_000_000 });
    this.startedAt = clock();
    this.recorder.addEventListener('start', () => { this.startedAt = clock(); });
    this.recorder.addEventListener('dataavailable', event => { if (event.data.size) this.onChunk(event.data, this.index++); });
    this.recorder.start(1000);
  }
  get actualMimeType(): string { return this.recorder.mimeType || this.mimeType || 'video/webm'; }
  /** `at` is a performance.now() time; result is ms on the video clock, rounded to 0.1 ms. */
  time(at: number): number { return Math.round((at - this.startedAt) * 10) / 10; }
  durationMs(): number { return Math.max(0, this.clock() - this.startedAt); }
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.stopped = new Promise<void>(resolve => {
      if (this.recorder.state === 'inactive') { resolve(); return; }
      this.recorder.addEventListener('stop', () => resolve(), { once: true });
      try { this.recorder.stop(); } catch { resolve(); }
    });
    return this.stopped;
  }
}

type EventInput = SessionEvent extends infer E ? E extends SessionEvent ? Omit<E, 't'> : never : never;
/** The `.clarte-session` timeline for calibration + the first block, in the format the Clarte session runner replays. */
export class ClarteTimeline {
  events: SessionEvent[] = [];
  dots: DotRow[] = [];
  constructor(private readonly time: (at: number) => number) {}
  event(at: number, event: EventInput): void { this.events.push({ ...event, t: this.time(at) } as SessionEvent); }
  dot(at: number, phase: DotRow[1], state: string, x: number, y: number): void {
    if (Number.isFinite(x) && Number.isFinite(y)) this.dots.push([this.time(at), phase, state, Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  }
  /** `video.bytes` is filled in by the server from the uploaded file. */
  manifest(meta: { tester: string; sample: number; model: string; viewport: Viewport; pixelRatio: number; camera: { width: number; height: number } | null; mimeType: string; durationMs: number; complete: boolean; live: SessionManifest['live'] }): SessionManifest {
    return { format: 'CLARTE-SESSION-1', tester: meta.tester, sample: meta.sample, createdAt: Date.now(), model: meta.model, viewport: meta.viewport, pixelRatio: meta.pixelRatio, camera: meta.camera,
      video: { mimeType: meta.mimeType, bytes: 0, durationMs: meta.durationMs }, complete: meta.complete, live: meta.live, events: this.events, dots: this.dots };
  }
}
