import type { Viewport } from './tracking';

/**
 * A recorded test session: the raw webcam video of one calibration and free-flow check, plus a
 * timeline of where the dot was and which frames the app labelled. Development only. It lets any
 * tracking method be re-run offline on exactly the same input instead of recalibrating by hand.
 *
 * Times (`t`) are milliseconds on the video's own clock: 0 is the first recorded frame.
 * Labels and dot positions are normalized screen coordinates in [-0.5, 0.5], as the tracker uses.
 */
export const SESSION_MAGIC = 'CLARTE-SESSION-1';
export type SessionEvent =
  | { type: 'calibration-start'; t: number }
  | { type: 'label'; t: number; x: number; y: number; stage: 'eyes' | 'head' }
  | { type: 'train'; t: number }
  | { type: 'trained'; t: number }
  | { type: 'check-start'; t: number }
  | { type: 'check'; t: number; x: number; y: number; index: number }
  | { type: 'check-complete'; t: number }
  | { type: 'end'; t: number; reason: string };
/** One row per processed app frame while a dot was shown: [t, phase, state, x, y]. */
export type DotRow = [number, 'calibration' | 'check', string, number, number];
export type SessionManifest = {
  format: typeof SESSION_MAGIC; tester: string; sample: number; createdAt: number; model: string;
  viewport: Viewport; pixelRatio: number; camera: { width: number; height: number } | null;
  video: { mimeType: string; bytes: number; durationMs: number };
  /** True when the free-flow check finished, so the session can be scored. */
  complete: boolean;
  /** What the app measured live on that check, for comparison with a replay of the unchanged tracker. */
  live?: { medianPx: number; p90Px: number; bins: number } | null;
  events: SessionEvent[]; dots: DotRow[];
};
export type SessionFile = { manifest: SessionManifest; video: Blob };

export function sessionBaseName(manifest: Pick<SessionManifest, 'tester' | 'sample' | 'createdAt'>): string {
  const tester = manifest.tester.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tester';
  return `clarte-session-${tester}-${manifest.sample}-${new Date(manifest.createdAt).toISOString().replace(/[:.]/g, '-')}`;
}

export function buildSessionFile(manifest: SessionManifest, video: Blob): Blob {
  const json = new TextEncoder().encode(JSON.stringify({ ...manifest, video: { ...manifest.video, bytes: video.size } }));
  const header = new TextEncoder().encode(`${SESSION_MAGIC} ${json.byteLength}\n`);
  return new Blob([header, json, video], { type: 'application/octet-stream' });
}

export async function parseSessionFile(file: Blob): Promise<SessionFile> {
  const head = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer());
  const match = /^CLARTE-SESSION-1 (\d{1,9})\n/.exec(head);
  if (!match) throw new Error('Not a Clarte test session file');
  const start = match[0].length, length = Number(match[1]);
  const manifest = JSON.parse(await file.slice(start, start + length).text()) as SessionManifest;
  if (manifest.format !== SESSION_MAGIC || !Array.isArray(manifest.events) || !Array.isArray(manifest.dots) || !manifest.viewport) throw new Error('Session manifest is invalid');
  const video = file.slice(start + length, start + length + manifest.video.bytes, manifest.video.mimeType.split(';')[0] || 'video/webm');
  if (video.size !== manifest.video.bytes) throw new Error('Session video is truncated');
  return { manifest, video };
}
