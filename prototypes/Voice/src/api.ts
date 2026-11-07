// Client for the local voice service (server/clarte_voice). The service binds
// 127.0.0.1 and only accepts this page. It picks the clearest speech locally
// and sends only that, and the text to speak, to ElevenLabs.

export const SERVICE_URL: string =
  (import.meta.env.VITE_CLARTE_VOICE_URL as string | undefined) ?? 'http://localhost:4322';

export type Source = 'past' | 'current';
export type Style = 'like-me' | 'clearer';

export interface Segment {
  n: number;
  file: string;
  start: number;
  end: number;
  duration: number;
  quality: number;
  snr_db: number;
  voiced: number;
  steadiness: number;
  f0_hz: number | null;
  clipped: number;
  speaker_sim: number | null;
  other_speaker: boolean;
  selected: boolean;
}

export interface Voice {
  id: string;
  name: string;
  source: Source;
  status: 'ready' | 'need-more';
  createdAt: number;
  updatedAt: number;
  files: string[];
  problems: { file: string; problem: string }[];
  segments: Segment[];
  order: number[];
  reference: { seconds: number; segments: number[] };
}

export interface Health {
  ok: boolean;
  engine: string;
  model: string;
  keyConfigured: boolean;
  storage: string;
}

export interface Spoken {
  url: string;
  synthesisMs: number;
  cached: boolean;
}

export class ServiceError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}${path}`, init);
  } catch {
    throw new ServiceError('The voice service on this computer is not running.');
  }
  if (!response.ok) throw new ServiceError(await errorMessage(response));
  return (await response.json()) as T;
}

export async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
      return String((detail as { message: string }).message);
    }
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  } catch {
    /* not JSON */
  }
  return `The voice service answered ${response.status}.`;
}

export const health = () => request<Health>('/health');
export const warmup = () => request<Health>('/warmup', { method: 'POST' });
export const listVoices = () => request<Voice[]>('/voices');
export const getVoice = (id: string) => request<Voice>(`/voices/${id}`);

export function createVoice(name: string, source: Source, files: File[]): Promise<Voice> {
  const form = new FormData();
  form.set('name', name);
  form.set('source', source);
  form.set('consent', 'true');
  for (const file of files) form.append('files', file, file.name);
  return request<Voice>('/voices', { method: 'POST', body: form });
}

export function addRecordings(id: string, files: File[]): Promise<Voice> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return request<Voice>(`/voices/${id}/recordings`, { method: 'POST', body: form });
}

export const updateVoice = (id: string, body: { name?: string; selected?: number[] }) =>
  request<Voice>(`/voices/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteVoice = (id: string) => request<{ deleted: string }>(`/voices/${id}`, { method: 'DELETE' });

export const referenceUrl = (voice: Voice) => `${SERVICE_URL}/voices/${voice.id}/reference.wav?v=${voice.updatedAt}`;
export const segmentUrl = (voice: Voice, n: number) => `${SERVICE_URL}/voices/${voice.id}/segments/${n}.wav`;

export async function speak(id: string, text: string, style: Style): Promise<Spoken> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/voices/${id}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style }),
    });
  } catch {
    throw new ServiceError('The voice service on this computer is not running.');
  }
  if (!response.ok) throw new ServiceError(await errorMessage(response));
  const blob = await response.blob();
  return {
    url: URL.createObjectURL(blob),
    synthesisMs: Number(response.headers.get('X-Clarte-Synthesis-Ms') ?? 0),
    cached: response.headers.get('X-Clarte-Cached') === '1',
  };
}

/** Plain-language label for a segment's measured quality. */
export function qualityWord(segment: Pick<Segment, 'quality' | 'other_speaker'>): string {
  if (segment.other_speaker) return 'Maybe someone else';
  if (segment.quality >= 0.75) return 'Clear';
  if (segment.quality >= 0.5) return 'Some noise';
  return 'Hard to hear';
}
