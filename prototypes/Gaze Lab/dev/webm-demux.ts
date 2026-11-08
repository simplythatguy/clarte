/**
 * Minimal WebM (Matroska/EBML) demuxer for browser MediaRecorder output: one video track, VP8 or
 * VP9, SimpleBlocks without lacing, Segment/Cluster of unknown size. Enough to feed WebCodecs
 * frame by frame, with exact per-frame timestamps, so a recording replays deterministically.
 */
export type DemuxedFrame = { timestampMs: number; key: boolean; data: Uint8Array };
export type DemuxedVideo = { codecId: string; codec: string; width: number; height: number; frames: DemuxedFrame[] };

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
};
// Containers are descended into in place, so unknown-size Segments and Clusters need no end offset.
const MASTERS = new Set([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Video, ID.Cluster, ID.BlockGroup]);

function vintLength(first: number): number {
  for (let length = 1; length <= 8; length++) if (first & (0x80 >> (length - 1))) return length;
  throw new Error('Invalid EBML variable-length integer');
}

export function demuxWebm(buffer: ArrayBuffer | Uint8Array): DemuxedVideo {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let pos = 0, timecodeScale = 1_000_000, clusterTimecode = 0;
  let codecId = '', width = 0, height = 0, videoTrack = -1;
  let entry: { number: number; type: number; codecId: string; width: number; height: number } | null = null;
  const frames: DemuxedFrame[] = [];
  const uint = (start: number, length: number) => { let v = 0; for (let i = 0; i < length; i++) v = v * 256 + bytes[start + i]; return v; };
  const commitEntry = () => {
    if (entry && entry.type === 1 && videoTrack < 0) { videoTrack = entry.number; codecId = entry.codecId; width = entry.width; height = entry.height; }
    entry = null;
  };
  const readBlock = (start: number, end: number, simple: boolean, flagsKnownKey: boolean) => {
    const trackLength = vintLength(bytes[start]);
    const track = uint(start, trackLength) - (0x80 >> (trackLength - 1)) * 2 ** (8 * (trackLength - 1));
    const relative = (bytes[start + trackLength] << 24 >> 16) | bytes[start + trackLength + 1];
    const flags = bytes[start + trackLength + 2];
    if (track !== videoTrack) return;
    if (flags & 0x06) throw new Error('Laced WebM blocks are not supported');
    const data = bytes.subarray(start + trackLength + 3, end);
    frames.push({ timestampMs: ((clusterTimecode + relative) * timecodeScale) / 1e6, key: simple ? (flags & 0x80) !== 0 : flagsKnownKey, data });
  };

  while (pos < bytes.length) {
    const idLength = vintLength(bytes[pos]);
    if (idLength > 4) throw new Error('Invalid EBML element ID');
    const id = uint(pos, idLength);
    pos += idLength;
    const sizeLength = vintLength(bytes[pos]);
    const marker = 0x80 >> (sizeLength - 1);
    let unknown = (bytes[pos] & (marker - 1)) === marker - 1;
    for (let i = 1; i < sizeLength && unknown; i++) unknown = bytes[pos + i] === 0xff;
    const size = unknown ? Infinity : (bytes[pos] & (marker - 1)) * 2 ** (8 * (sizeLength - 1)) + uint(pos + 1, sizeLength - 1);
    pos += sizeLength;
    const end = Math.min(bytes.length, pos + size);
    if (id === ID.TrackEntry) { commitEntry(); entry = { number: 0, type: 0, codecId: '', width: 0, height: 0 }; }
    if (id === ID.Cluster) commitEntry();
    if (MASTERS.has(id)) continue;
    if (unknown) throw new Error('Unknown-size leaf element in WebM');
    switch (id) {
      case ID.TimecodeScale: timecodeScale = uint(pos, end - pos); break;
      case ID.TrackNumber: if (entry) entry.number = uint(pos, end - pos); break;
      case ID.TrackType: if (entry) entry.type = uint(pos, end - pos); break;
      case ID.CodecID: if (entry) entry.codecId = new TextDecoder().decode(bytes.subarray(pos, end)).replace(/\0+$/, ''); break;
      case ID.PixelWidth: if (entry) entry.width = uint(pos, end - pos); break;
      case ID.PixelHeight: if (entry) entry.height = uint(pos, end - pos); break;
      case ID.Timecode: clusterTimecode = uint(pos, end - pos); break;
      case ID.SimpleBlock: readBlock(pos, end, true, false); break;
      case ID.Block: readBlock(pos, end, false, frames.length === 0); break;
    }
    pos = end;
  }
  commitEntry();
  if (videoTrack < 0) throw new Error('No video track in WebM');
  const codec = codecId === 'V_VP8' ? 'vp8' : codecId === 'V_VP9' ? 'vp09.00.10.08' : codecId === 'V_AV1' ? 'av01.0.04M.08' : '';
  if (!codec) throw new Error(`Unsupported WebM codec ${codecId}`);
  return { codecId, codec, width, height, frames };
}
