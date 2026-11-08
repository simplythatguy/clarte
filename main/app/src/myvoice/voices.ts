/**
 * The person's voices and speaking with one (NAT-32).
 *
 * The voice service lists every voice made on this computer. Menu › My voice › Voice chooses one
 * (Settings.voiceId), or the system voice (null). Speaking with a voice keeps voice.ts's contract
 * (`onWord(i)` as word i starts, `done`, `cancel`): the service returns audio without word timings,
 * so the words are paced across the clip's real duration by their spoken length. When the voice
 * cannot speak (the service is off, the key is missing, the request fails), the system voice says
 * it instead, so a message is never lost.
 */
import { useSyncExternalStore } from 'react';
import { health, listVoices, speak, type Pacing, type Voice } from './service.ts';
import { speakWords, wordsOf, type Speech } from '../voice.ts';

export type ServiceState =
  | { kind: 'checking' }
  | { kind: 'offline'; message: string }
  /** Running, but without an ElevenLabs key: no new voices, and only cached phrases speak. */
  | { kind: 'no-key' }
  | { kind: 'ready' };

type Snapshot = { service: ServiceState; voices: Voice[] };

let snapshot: Snapshot = { service: { kind: 'checking' }, voices: [] };
const listeners = new Set<() => void>();
const emit = (next: Snapshot) => { snapshot = next; listeners.forEach((l) => l()); };

let refreshing: Promise<void> | null = null;
/** Ask the service again: its state and its voices, newest first. */
export function refreshVoices(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const [h, voices] = await Promise.all([health(), listVoices()]);
      emit({ service: h.keyConfigured ? { kind: 'ready' } : { kind: 'no-key' }, voices: [...voices].sort((a, b) => b.updatedAt - a.updatedAt) });
    } catch (error) {
      emit({ service: { kind: 'offline', message: (error as Error).message }, voices: snapshot.voices });
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
void refreshVoices();

export const voicesNow = (): Snapshot => snapshot;

export function useVoices(): Snapshot {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

/** Voices that can speak, for the Voice setting. */
export const readyVoices = (): Voice[] => snapshot.voices.filter((v) => v.status === 'ready');

export function voiceName(id: string | null): string {
  if (id === null) return 'System';
  return snapshot.voices.find((v) => v.id === id)?.name ?? 'My voice';
}

/** How long a word takes to say, relative to the others: its letters plus a pause after punctuation. */
function weight(word: string): number {
  const pause = /[.?!]$/.test(word) ? 5 : /[,;:]$/.test(word) ? 3 : 0;
  return 3 + word.replace(/[^\p{L}\p{N}']/gu, '').length + pause;
}

/** Speak `text` in voice `id`, or the system voice when `id` is null or the voice cannot speak. */
export function speakInVoice(text: string, onWord: (index: number) => void, id: string | null, pacing: Pacing): Speech {
  if (id === null) return speakWords(text, onWord);
  let cancelled = false;
  let inner: Speech | null = null;
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  const controller = new AbortController();
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const finish = () => { if (url) URL.revokeObjectURL(url); url = null; resolveDone(); };
  const fallback = () => {
    if (cancelled) return finish();
    inner = speakWords(text, onWord);
    void inner.done.then(finish);
  };

  void (async () => {
    try {
      const blob = await speak(id, text, pacing, controller.signal);
      if (cancelled) return finish();
      url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio = a;
      const weights = wordsOf(text).map(weight);
      const total = weights.reduce((s, w) => s + w, 0) || 1;
      let shown = -1;
      a.addEventListener('timeupdate', () => {
        if (!Number.isFinite(a.duration) || a.duration <= 0) return;
        const at = (a.currentTime / a.duration) * total;
        let sum = 0, index = 0;
        for (; index < weights.length - 1; index++) { if (sum + weights[index] > at) break; sum += weights[index]; }
        if (index !== shown) { shown = index; onWord(index); }
      });
      a.addEventListener('playing', () => { if (shown < 0) { shown = 0; onWord(0); } });
      a.addEventListener('ended', finish);
      a.addEventListener('error', () => { audio = null; fallback(); });
      await a.play();
    } catch (error) {
      if (cancelled) return finish();
      console.warn('[voice] the chosen voice could not speak; using the system voice', error);
      audio = null;
      fallback();
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      controller.abort();
      if (audio) { audio.pause(); audio = null; finish(); }
      inner?.cancel();
      if (!inner && !audio) finish();
    },
  };
}
