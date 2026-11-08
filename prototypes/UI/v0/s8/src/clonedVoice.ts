/**
 * Speaking in the person's own voice (NAT-27): the ElevenLabs clone made in `prototypes/Voice`
 * (PR #9), through its local service (`POST /voices/{id}/speak`, port 4322). The service caches
 * every phrase per voice, so repeated phrases play instantly and cost nothing.
 *
 * `speakInVoice` keeps voice.ts's contract (`onWord(i)` as word i starts, `done`, `cancel`). The
 * service returns audio without word timings, so words are paced across the clip's real duration
 * in proportion to their spoken length. If there is no ready voice, the service is offline, or
 * the request fails, it falls back to the browser's speech synthesis (voice.ts).
 */
import { SERVICE_URL, readVoices, type Voice } from './voiceService.ts';
import { speakWords, wordsOf, type Speech } from './voice.ts';

const REFRESH_MS = 30000;
let voice: Voice | null = null;
let checkedAt = -Infinity;
let checking: Promise<void> | null = null;

/** The newest ready clone, re-read at most every 30 s. */
async function readyVoice(): Promise<Voice | null> {
  if (performance.now() - checkedAt > REFRESH_MS && !checking) {
    checking = readVoices(new AbortController().signal).then((report) => {
      voice = report.kind === 'voice' && report.voice.status === 'ready' ? report.voice : null;
      checkedAt = performance.now();
      checking = null;
    });
  }
  if (checking && voice === null) await checking;
  return voice;
}
// Ask once at start, so the first message does not wait for it.
void readyVoice();

function weight(word: string): number {
  const pause = /[.?!]$/.test(word) ? 5 : /[,;:]$/.test(word) ? 3 : 0;
  return 3 + word.replace(/[^\p{L}\p{N}']/gu, '').length + pause;
}

export function speakInVoice(text: string, onWord: (index: number) => void): Speech {
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
    const v = await readyVoice();
    if (!v || cancelled) return fallback();
    try {
      const response = await fetch(`${SERVICE_URL}/voices/${encodeURIComponent(v.id)}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style: 'like-me' }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error(`speak: ${response.status}`);
      const blob = await response.blob();
      if (cancelled) return finish();
      url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio = a;
      const words = wordsOf(text);
      const weights = words.map(weight);
      const total = weights.reduce((s, w) => s + w, 0) || 1;
      let shown = -1;
      const onTime = () => {
        if (!Number.isFinite(a.duration) || a.duration <= 0) return;
        const at = (a.currentTime / a.duration) * total;
        let sum = 0, index = 0;
        for (; index < weights.length - 1; index++) { if (sum + weights[index] > at) break; sum += weights[index]; }
        if (index !== shown) { shown = index; onWord(index); }
      };
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('playing', () => { if (shown < 0) { shown = 0; onWord(0); } });
      a.addEventListener('ended', finish);
      a.addEventListener('error', () => { audio = null; fallback(); });
      await a.play();
    } catch (error) {
      if (cancelled) return finish();
      console.warn('[voice] cloned voice unavailable, using the browser voice', error);
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
