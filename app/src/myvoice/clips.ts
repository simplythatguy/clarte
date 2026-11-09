/**
 * Clips in the person's own voice, shared by preparing and speaking (NAT-54, audit B6).
 *
 * ElevenLabs charges for every clip it makes, and the voice service only caches a clip once it has finished
 * making it. Two requests for the same phrase while it is still being made would both be charged. So every
 * request for a clip goes through one store: a phrase is asked for once, and the early preparation (the eyes on
 * Speak) and Speak itself both wait on that same request.
 */
import type { Pacing } from './service.ts';

export type FetchClip = (id: string, text: string, pacing: Pacing) => Promise<Blob>;

/** Clips kept in memory, newest last; older phrases still come back from the service's cache. */
const KEEP = 8;

/** The text as the service caches it: runs of spaces are one space. */
const tidy = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');

export function clipStore(fetchClip: FetchClip) {
  const clips = new Map<string, Promise<Blob>>();
  return {
    /** The clip for this phrase: the request already made for it, or a new one. */
    get(id: string, text: string, pacing: Pacing): Promise<Blob> {
      const key = JSON.stringify([id, pacing, tidy(text)]);
      const known = clips.get(key);
      if (known) {
        clips.delete(key);
        clips.set(key, known);
        return known;
      }
      const clip = fetchClip(id, tidy(text), pacing);
      clips.set(key, clip);
      if (clips.size > KEEP) clips.delete(clips.keys().next().value!);
      // A failed clip is forgotten, so the next Speak asks again.
      clip.catch(() => { if (clips.get(key) === clip) clips.delete(key); });
      return clip;
    },
    size: () => clips.size,
  };
}

/**
 * The value, or null when it is not there within `ms`. The request itself goes on, so a clip that arrives late
 * is still cached for Say again.
 */
export function within<T>(value: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([value, late]).finally(() => clearTimeout(timer));
}
