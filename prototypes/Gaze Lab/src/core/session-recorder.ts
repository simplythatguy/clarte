import { buildSessionFile, type DotRow, type SessionEvent, type SessionManifest } from './session-file';
import type { Viewport } from './tracking';

/** Distributes the event type over the union so each variant keeps its own fields. */
type EventInput = SessionEvent extends infer E ? E extends SessionEvent ? Omit<E, 't'> : never : never;

export type RecordedSession = {
  id: string; tester: string; sample: number; complete: boolean; durationMs: number;
  manifest: SessionManifest; video: Blob;
  /** The bundle for the replay runner: manifest plus video in one file. */
  file(): Blob;
};
type Meta = { tester: string; sample: number; model: string; viewport: Viewport; pixelRatio: number; camera: { width: number; height: number } | null };

/** Prefers VP9, then VP8: both decode frame-accurately with WebCodecs in the replay runner. */
export function recordingMimeType(supported: (type: string) => boolean = type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)): string {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(supported) ?? '';
}

/**
 * Records the camera stream with MediaRecorder and keeps a timeline in the video's own clock.
 * Development only: the App creates one only when test-session recording is switched on.
 */
export class TestSessionRecorder {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private events: SessionEvent[] = [];
  private dots: DotRow[] = [];
  private startedAt: number;
  private stopped: Promise<RecordedSession> | null = null;
  readonly mimeType: string;

  constructor(stream: MediaStream, private readonly meta: Meta, private readonly clock: () => number = () => performance.now()) {
    this.mimeType = recordingMimeType();
    // A high bitrate keeps the iris edges the trackers rely on.
    this.recorder = new MediaRecorder(new MediaStream(stream.getVideoTracks()), { ...(this.mimeType ? { mimeType: this.mimeType } : {}), videoBitsPerSecond: 5_000_000 });
    this.startedAt = clock();
    this.recorder.addEventListener('start', () => { this.startedAt = clock(); });
    this.recorder.addEventListener('dataavailable', event => { if (event.data.size) this.chunks.push(event.data); });
    this.recorder.start(1000);
  }

  get recording(): boolean { return this.stopped === null; }
  /** `at` is a performance.now() time, such as a frame's capture time. */
  time(at: number): number { return Math.round((at - this.startedAt) * 10) / 10; }
  event(at: number, event: EventInput): void { if (this.recording) this.events.push({ ...event, t: this.time(at) } as SessionEvent); }
  dot(at: number, phase: DotRow[1], state: string, x: number, y: number): void {
    if (this.recording && Number.isFinite(x) && Number.isFinite(y)) this.dots.push([this.time(at), phase, state, Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  }

  stop(reason: string, complete: boolean, live: SessionManifest['live'] = null): Promise<RecordedSession> {
    if (this.stopped) return this.stopped;
    const end = this.clock();
    this.event(end, { type: 'end', reason });
    this.stopped = new Promise<RecordedSession>((resolve, reject) => {
      const finish = () => {
        const video = new Blob(this.chunks, { type: this.recorder.mimeType || this.mimeType || 'video/webm' });
        const durationMs = Math.max(0, end - this.startedAt);
        const manifest: SessionManifest = {
          format: 'CLARTE-SESSION-1', tester: this.meta.tester, sample: this.meta.sample, createdAt: Date.now(), model: this.meta.model,
          viewport: this.meta.viewport, pixelRatio: this.meta.pixelRatio, camera: this.meta.camera,
          video: { mimeType: video.type, bytes: video.size, durationMs }, complete, live, events: this.events, dots: this.dots,
        };
        resolve({ id: `${this.meta.tester}-${this.meta.sample}-${manifest.createdAt}`, tester: this.meta.tester, sample: this.meta.sample, complete, durationMs, manifest, video, file: () => buildSessionFile(manifest, video) });
      };
      if (this.recorder.state === 'inactive') { finish(); return; }
      this.recorder.addEventListener('stop', finish, { once: true });
      this.recorder.addEventListener('error', () => reject(new Error('Recording failed')), { once: true });
      try { this.recorder.stop(); } catch (error) { reject(error); }
    });
    return this.stopped;
  }
}
