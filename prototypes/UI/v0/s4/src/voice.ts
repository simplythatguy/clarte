/**
 * Speaking with the spoken word reported as it is said.
 *
 * `shared/speech.ts` exposes `speak(text): Promise<void>` without word boundaries, so this style
 * drives speech synthesis itself to highlight each word (proposed for shared in REPORT.md).
 * Boundary events drive the highlight when the voice sends them, an estimate of the speaking rate
 * otherwise. Only the API's end event counts as said; anything else is reported as a failure.
 */
import { canSpeak } from '../../shared/speech.ts';

export const FLOOR_HOLDER = 'One moment, I’m answering.';
const RATE = 0.95;
const MS_PER_CHAR = 62 / RATE;

export type SpeechHandle = { cancel(): void };

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function speakWords(text: string, onWord: (index: number) => void, onStart: () => void, onEnd: () => void, onFail: () => void): SpeechHandle {
  const words = wordsOf(text);
  const starts: number[] = [];
  let cursor = 0;
  for (const w of words) { const at = text.indexOf(w, cursor); starts.push(at); cursor = at + w.length; }

  let done = false;
  let boundaries = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const settle = (outcome: () => void) => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    outcome();
  };
  // Only the speech API's own end event counts as said. No synthesis, no start and the watchdog
  // are failures: the draft stays and the person sees that nothing was said.
  const fail = () => settle(onFail);

  // Estimated schedule, used for the highlight when the voice sends no word boundaries. It starts
  // when the voice starts, never before: the highlight follows audio that has begun.
  const offsets: number[] = [];
  let t = 0;
  for (const w of words) { offsets.push(t); t += (w.length + 1) * MS_PER_CHAR + (/[.,?!]$/.test(w) ? 220 : 0); }
  const estimate = t;
  const schedule = () => offsets.forEach((at, i) => timers.push(setTimeout(() => { if (!boundaries && !done) onWord(i); }, at)));

  if (!canSpeak()) {
    timers.push(setTimeout(fail, 0));
  } else {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = RATE;
    utterance.lang = 'en-US';
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      boundaries = true;
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= event.charIndex) index++;
      onWord(index);
    };
    let started = false;
    utterance.onstart = () => { started = true; onStart(); schedule(); };
    utterance.onend = () => { if (started) settle(onEnd); else fail(); };
    // Our own cancel reports 'interrupted' or 'canceled'; anything else means nothing was said.
    utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      fail();
    };
    window.speechSynthesis.speak(utterance);
    timers.push(setTimeout(() => { if (!started) fail(); }, 3000));
    timers.push(setTimeout(fail, estimate * 2 + 3000));
  }

  return {
    /** Stop without reporting an end: the caller already changed state. */
    cancel() {
      done = true;
      timers.forEach(clearTimeout);
      if (canSpeak()) window.speechSynthesis.cancel();
    },
  };
}

/** Speak a floor-holder without touching the message or the screen. */
export function sayFloorHolder(): void {
  if (!canSpeak()) return;
  const utterance = new SpeechSynthesisUtterance(FLOOR_HOLDER);
  utterance.rate = RATE;
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------------------------------------
// Live listening.
//
// `shared/speech.ts` `listen` reports the end of recognition the same way as a final result, so a
// style cannot tell that Chrome stopped after a silence, and it swallows errors. While the person
// is listening, the microphone must stay on until they stop, and a microphone that cannot be used
// must be said, never covered with invented words. This wrapper restarts recognition when it ends
// on its own, keeps what was already heard, and reports a fatal error. Proposed for shared.

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

export function recognitionAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition) && window.isSecureContext;
}

export function listenLive(onText: (transcript: string) => void, onUnavailable: () => void): { stop(): void } {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition!;
  let stopped = false;
  let heard = '';
  // Ends without a single result, back to back: recognition keeps failing (offline, a service
  // error). After three, listening is unavailable rather than silently looping.
  let barrenEnds = 0;
  let recognition: Recognition | null = null;
  const start = () => {
    const r = new Ctor();
    recognition = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let committed = '';
    r.onresult = (event) => {
      barrenEnds = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) committed += `${result[0].transcript.trim()} `;
        else interim += result[0].transcript;
      }
      onText(`${heard}${committed}${interim}`.trim());
    };
    r.onerror = (event) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(event.error)) { stopped = true; onUnavailable(); }
    };
    const began = performance.now();
    r.onend = () => {
      heard = `${heard}${committed}`;
      if (stopped) return;
      if (!committed && performance.now() - began < 2000) barrenEnds += 1; else barrenEnds = 0;
      if (barrenEnds >= 3) { stopped = true; onUnavailable(); return; }
      start(); // Chrome ends after a silence; the person has not stopped listening.
    };
    try { r.start(); } catch { stopped = true; onUnavailable(); }
  };
  start();
  return { stop() { stopped = true; recognition?.stop(); } };
}
