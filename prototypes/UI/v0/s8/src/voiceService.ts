/**
 * Read-only client for the local voice service (prototypes/Voice, `npm run server`, port 4322).
 * The setup page reports what voice exists; making one stays in the Voice prototype, which owns
 * recording, consent and the ElevenLabs clone. Nothing here sends audio or text anywhere.
 *
 * The service only answers pages it lists in CLARTE_VOICE_ORIGINS (default: the Voice page on
 * 4321). To let this page read it, start the service with
 * CLARTE_VOICE_ORIGINS=http://localhost:4321,http://localhost:5106.
 */
export const SERVICE_URL: string = import.meta.env.VITE_CLARTE_VOICE_URL ?? 'http://localhost:4322';
export const VOICE_APP_URL: string = import.meta.env.VITE_CLARTE_VOICE_APP_URL ?? 'http://localhost:4321';

export type Segment = { n: number; file: string; duration: number; quality: number; other_speaker: boolean; selected: boolean };
export type Voice = {
  id: string;
  name: string;
  source: 'past' | 'current';
  status: 'ready' | 'need-more';
  updatedAt: number;
  files: string[];
  problems: { file: string; problem: string }[];
  segments: Segment[];
  order: number[];
  reference: { seconds: number; segments: number[] };
};

export type VoiceReport =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'none' }
  | { kind: 'voice'; voice: Voice; sample?: boolean };

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export async function readVoices(signal: AbortSignal): Promise<VoiceReport> {
  try {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
    const body = await get<Voice[] | { voices: Voice[] }>('/voices', timeout);
    const voices = Array.isArray(body) ? body : body.voices;
    if (!voices.length) return { kind: 'none' };
    const newest = [...voices].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return { kind: 'voice', voice: newest };
  } catch {
    return { kind: 'offline' };
  }
}

/** Design-review data, shown only by the `setup-voice-sample` debug phase and labelled "Sample". */
export const SAMPLE_VOICE: Voice = (() => {
  const files = ['Birthday 2019.mp4', 'Voicemail to Sam.m4a', 'Wedding toast.mov'];
  const durations = [6.2, 5.1, 7.4, 4.3, 3.9, 8.0, 5.6, 4.8, 3.2, 6.9, 2.7, 4.1, 3.5, 5.0];
  const segments: Segment[] = durations.map((duration, n) => ({
    n, file: files[n % 3], duration, quality: 1 - n / durations.length, other_speaker: n === 9, selected: n !== 9 && n < 12,
  }));
  const selected = segments.filter((s) => s.selected);
  return {
    id: 'sample', name: 'Sample voice', source: 'past', status: 'ready', updatedAt: 0, files,
    problems: [{ file: files[2], problem: 'Music under most of it' }],
    segments, order: segments.map((s) => s.n),
    reference: { seconds: Math.round(selected.reduce((t, s) => t + s.duration, 0)), segments: selected.map((s) => s.n) },
  };
})();
