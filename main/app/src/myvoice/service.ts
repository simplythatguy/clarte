/**
 * Client for the local voice service (prototypes/Voice/server, port 4322). The service binds
 * 127.0.0.1 and answers only the pages in its CLARTE_VOICE_ORIGINS; `./clarte ui` starts it with
 * this app's origin. It picks the clearest speech on this computer and sends only that, and the
 * text to speak, to ElevenLabs.
 */
export const SERVICE_URL: string = (import.meta.env.VITE_CLARTE_VOICE_URL as string | undefined) ?? 'http://localhost:4322';
/**
 * `./clarte ui` sets this to "off" when it started no voice service, because .env has no ElevenLabs key (NAT-57).
 * .env is git-ignored, so every fresh clone starts this way until the key is put in it.
 */
export const SERVICE_STARTED = import.meta.env.VITE_CLARTE_VOICE !== 'off';
/** What to do when there is no key: said the same way whether the service is off or running without one. */
export const NO_KEY = 'Voice making needs the ElevenLabs key. Put ELEVENLABS_API_KEY in the .env file in the Clarté folder, then start Clarté again.';

export type Source = 'past' | 'current';
export type Pacing = 'like-me' | 'clearer';

export type Voice = {
  id: string;
  name: string;
  source: Source;
  status: 'ready' | 'need-more';
  createdAt: number;
  updatedAt: number;
  problems: { file: string; problem: string }[];
  reference: { seconds: number; segments: number[] };
};

export type Health = { ok: boolean; engine: string; model: string; keyConfigured: boolean; storage: string };

export class ServiceError extends Error {}

const OFFLINE = 'Voice making is not answering. Start Clarté again with ./clarte ui.';
const SLOW = 'Voice making took too long to answer.';

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: string }).message);
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  } catch { /* not JSON */ }
  return `The voice service answered ${response.status}.`;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ServiceError((error as Error).name === 'TimeoutError' ? SLOW : OFFLINE);
  }
  if (!response.ok) throw new ServiceError(await errorMessage(response));
  return (await response.json()) as T;
}

export const health = () => request<Health>('/health');
export const listVoices = () => request<Voice[]>('/voices');
export const deleteVoice = (id: string) => request<{ deleted: string }>(`/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Make a voice. Analysis and the clone take a minute or more, so this waits up to 10 minutes. */
export function createVoice(name: string, source: Source, files: File[]): Promise<Voice> {
  const form = new FormData();
  form.set('name', name);
  form.set('source', source);
  form.set('consent', 'true');
  for (const file of files) form.append('files', file, file.name);
  return request<Voice>('/voices', { method: 'POST', body: form }, 600_000);
}

/**
 * The phrase as audio in the voice. Every phrase is cached, so saying it again is instant and free.
 *
 * The request is not cancelled when the person stops waiting for it (NAT-54): the voice service is charged for
 * the clip either way, so it is better kept for the next time the phrase is said. How long the person waits
 * is decided by the caller (voices.ts); this only gives up on a service that has stopped answering.
 */
export async function speak(id: string, text: string, pacing: Pacing, timeoutMs = 30_000): Promise<Blob> {
  try {
    const response = await fetch(`${SERVICE_URL}/voices/${encodeURIComponent(id)}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style: pacing }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new ServiceError(await errorMessage(response));
    return await response.blob();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError((error as Error).name === 'TimeoutError' ? SLOW : OFFLINE);
  }
}
