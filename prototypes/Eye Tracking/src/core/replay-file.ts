import type { ReplayEntry } from './worker-engine';
import type { Viewport } from './tracking';

/**
 * Development replay file: one self-describing binary blob the person saves to their own disk.
 * Layout: an ASCII header line, a JSON manifest, then the PNG eye strips back to back.
 * Nothing in the app reads or writes it on its own; the dev replay page parses it.
 */
export const REPLAY_MAGIC = 'CLARTE-REPLAY-1';
export type ReplayManifest = {
  format: typeof REPLAY_MAGIC; createdAt: number; model: string;
  viewport: Viewport; pixelRatio: number; camera: { width: number; height: number } | null;
  /** How the eye strips were cropped; absent on older files, which are `upstream`. Do not mix crops when training. */
  crop?: 'upstream' | 'normalized';
  entries: (ReplayEntry & { offset: number; length: number })[];
};
export type ReplayFile = { manifest: ReplayManifest; images: Blob[] };
type Meta = Omit<ReplayManifest, 'format' | 'entries'>;

export function buildReplayFile(meta: Meta, entries: ReplayEntry[], images: Blob[]): Blob {
  if (entries.length !== images.length) throw new Error('Replay entries and images differ in length');
  let offset = 0;
  const manifest: ReplayManifest = { format: REPLAY_MAGIC, ...meta, entries: entries.map((entry, i) => { const length = images[i].size; const row = { ...entry, offset, length }; offset += length; return row; }) };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new TextEncoder().encode(`${REPLAY_MAGIC} ${json.byteLength}\n`);
  return new Blob([header, json, ...images], { type: 'application/octet-stream' });
}

export async function parseReplayFile(file: Blob): Promise<ReplayFile> {
  const head = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer());
  const match = /^CLARTE-REPLAY-1 (\d{1,9})\n/.exec(head);
  if (!match) throw new Error('Not a Clarte replay file');
  const headerLength = match[0].length, jsonLength = Number(match[1]);
  const manifest = JSON.parse(await file.slice(headerLength, headerLength + jsonLength).text()) as ReplayManifest;
  if (manifest.format !== REPLAY_MAGIC || !Array.isArray(manifest.entries)) throw new Error('Replay manifest is invalid');
  const base = headerLength + jsonLength;
  const images = manifest.entries.map(entry => file.slice(base + entry.offset, base + entry.offset + entry.length, 'image/png'));
  return { manifest, images };
}
