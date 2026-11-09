/**
 * Making the person's voice (NAT-32): the recording session behind the voice pages
 * (VoiceSetup.tsx), from the Voice prototype's RecordToday and Upload screens (myvoice/SOURCE.md).
 *
 * Today: the person reads the prompts one at a time (prompts.ts: a held "ah", the six CAPE-V
 * sentences, part of the Rainbow Passage and their own words). Each take is kept per prompt, so
 * Back and recording again replace it. About a minute is best and 15 s is the floor. The
 * microphone opens on the first recording page, with the browser's voice processing off
 * (recorder.ts), and closes when the pages are left. A take stops itself after 30 s.
 *
 * From before: a helper chooses audio or video files; the service keeps the clearest speech.
 */
import { useSyncExternalStore } from 'react';
import { ENOUGH_SECONDS, MINIMUM_SECONDS, PROMPTS } from './prompts.ts';
import { Recorder, takeToFile, type Take } from './recorder.ts';
import { createVoice, deleteVoice, type Source, type Voice } from './service.ts';
import { refreshVoices } from './voices.ts';

export { ENOUGH_SECONDS, MINIMUM_SECONDS, PROMPTS };

const MAX_TAKE_S = 30;
/** Shorter than this is a stray selection, not a take. */
const MIN_TAKE_S = 0.6;

export type MakerState = {
  index: number;
  takes: Record<string, number>;
  /** Seconds into the take being recorded, or null when not recording. */
  recording: number | null;
  /** The microphone is open. */
  mic: boolean;
  /** What went wrong, in words for the page; null when nothing did. */
  error: string | null;
  /** The voice the last make produced. */
  made: Voice | null;
};

let state: MakerState = { index: 0, takes: {}, recording: null, mic: false, error: null, made: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<MakerState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

let recorder: Recorder | null = null;
const takes = new Map<string, Take>();
let ticker: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

export const makerNow = (): MakerState => state;
export function useMaker(): MakerState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export const recordedSeconds = (s: MakerState = state): number => Object.values(s.takes).reduce((t, n) => t + n, 0);

/** Open the microphone for recording. False, with the reason on the page, when it is blocked. */
export async function openMic(): Promise<boolean> {
  if (recorder) return true;
  try {
    const r = new Recorder();
    await r.open();
    recorder = r;
    set({ mic: true, error: null });
    return true;
  } catch {
    set({ mic: false, error: 'Clarté needs the microphone to record. Allow it in the browser, then try again.' });
    return false;
  }
}

export function startTake(): void {
  if (!recorder || recorder.recording) return;
  recorder.start();
  startedAt = performance.now();
  set({ recording: 0, error: null });
  ticker = setInterval(() => {
    const s = (performance.now() - startedAt) / 1000;
    if (s >= MAX_TAKE_S) void stopTake();
    else set({ recording: s });
  }, 250);
}

/** Stop the take. A real take is kept for this prompt and the next prompt comes up. */
export async function stopTake(): Promise<void> {
  if (ticker) { clearInterval(ticker); ticker = null; }
  if (!recorder?.recording) { set({ recording: null }); return; }
  const take = await recorder.stop();
  const prompt = PROMPTS[state.index];
  if (take.seconds < MIN_TAKE_S) { URL.revokeObjectURL(take.url); set({ recording: null }); return; }
  const old = takes.get(prompt.id);
  if (old) URL.revokeObjectURL(old.url);
  takes.set(prompt.id, take);
  set({
    recording: null,
    takes: { ...state.takes, [prompt.id]: take.seconds },
    index: Math.min(PROMPTS.length - 1, state.index + 1),
  });
}

export function move(step: number): void {
  if (state.recording !== null) return;
  set({ index: Math.min(PROMPTS.length - 1, Math.max(0, state.index + step)) });
}

/** Close the microphone (leaving the pages, or making the voice). The takes stay until reset. */
export function closeMic(): void {
  if (ticker) { clearInterval(ticker); ticker = null; }
  recorder?.close();
  recorder = null;
  set({ mic: false, recording: null });
}

/** Forget the session: takes, results and errors. */
export function resetMaker(): void {
  closeMic();
  for (const t of takes.values()) URL.revokeObjectURL(t.url);
  takes.clear();
  set({ index: 0, takes: {}, error: null, made: null });
}

export const setMakerError = (error: string | null) => set({ error });

/** Debug phases only (debug.ts): show a session without a microphone. */
export function showMaker(patch: Partial<MakerState>): void { set(patch); }

/**
 * Make the voice from today's takes, or from files chosen from before. A voice that came back
 * needing more speech is replaced, not kept beside the new one.
 */
export async function makeVoice(source: Source, files?: File[]): Promise<Voice | null> {
  closeMic();
  const chosen = files ?? PROMPTS.filter((p) => takes.has(p.id)).map((p) => takeToFile(takes.get(p.id)!, p.id));
  const previous = state.made?.status === 'need-more' ? state.made.id : null;
  set({ error: null });
  try {
    const voice = await createVoice(source === 'past' ? 'My voice, from before' : 'My voice', source, chosen);
    if (previous) await deleteVoice(previous).catch(() => undefined);
    set({ made: voice });
    await refreshVoices();
    return voice;
  } catch (error) {
    set({ error: (error as Error).message });
    void refreshVoices(); // the service may have stopped or lost its key: the voice pages should say so
    return null;
  }
}
