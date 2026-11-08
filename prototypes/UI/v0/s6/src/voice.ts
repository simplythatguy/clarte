/**
 * Speaking with spoken-word highlighting, and hearing the partner.
 *
 * `shared/speech.ts` speaks without exposing word boundaries, and the brief asks for the spoken
 * word to be highlighted from synthesis boundary events when they exist and a timer otherwise.
 * This wrapper keeps the shared contract (speak text, resolve when done) and adds `onWord`.
 * REPORT.md proposes moving `onWord` into shared.
 */
import { DEMO_UTTERANCES, canListenLive, canSpeak, listen } from '../../shared/speech.ts';

export type Speech = { done: Promise<void>; cancel(): void };

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Rough spoken length of one word at `rate`, with a real pause after punctuation. */
function wordMs(word: string, rate: number): number {
  const pause = /[.?!]$/.test(word) ? 320 : /[,;:]$/.test(word) ? 180 : 0;
  return (170 + 58 * word.replace(/[^\p{L}\p{N}']/gu, '').length + pause) / rate;
}

/**
 * Speak `text`, calling `onWord(i)` as word i starts. Uses synthesis boundary events when the
 * voice reports them, and a timer otherwise (no voices, blocked autoplay, or no boundary events).
 */
export function speakWords(text: string, onWord: (index: number) => void, options: { rate?: number } = {}): Speech {
  const rate = options.rate ?? 0.95;
  const words = wordsOf(text);
  const starts: number[] = [];
  { let at = 0; for (const w of words) { at = text.indexOf(w, at); starts.push(at); at += w.length; } }

  let finished = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let boundaryDriven = false;
  let timerRunning = false;
  let synthEnded = false;
  let timerEnded = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    resolveDone();
  };
  const maybeFinish = () => { if (synthEnded && (boundaryDriven || timerEnded || !timerRunning)) finish(); };

  const runTimer = (from: number) => {
    if (timerRunning || finished) return;
    timerRunning = true;
    let t = 0;
    for (let i = from; i < words.length; i++) {
      const index = i;
      timers.push(setTimeout(() => { if (!boundaryDriven) onWord(index); }, t));
      t += wordMs(words[i], rate);
    }
    timers.push(setTimeout(() => { timerEnded = true; if (!synthActive || synthEnded) finish(); }, t));
  };

  let synthActive = false;
  const voices = canSpeak() ? window.speechSynthesis.getVoices() : [];
  if (canSpeak() && voices.length > 0 && words.length) {
    synthActive = true;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.lang = 'en-US';
    let started = false;
    utterance.onstart = () => { started = true; runTimer(0); };
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      boundaryDriven = true;
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= event.charIndex) index++;
      onWord(index);
    };
    utterance.onend = () => { synthEnded = true; maybeFinish(); };
    utterance.onerror = () => { synthActive = false; synthEnded = true; runTimer(0); maybeFinish(); };
    window.speechSynthesis.speak(utterance);
    // Autoplay rules or a missing engine can leave the utterance silent: fall back to the timer.
    timers.push(setTimeout(() => {
      if (!started && !finished) { synthActive = false; synthEnded = true; window.speechSynthesis.cancel(); runTimer(0); }
    }, 900));
  } else {
    runTimer(0);
  }

  return {
    done,
    cancel: () => { if (synthActive && canSpeak()) window.speechSynthesis.cancel(); finish(); },
  };
}

// Load the voice list early; Chrome fills it asynchronously.
if (canSpeak()) { window.speechSynthesis.getVoices(); window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices()); }

/** Where the partner's words come from: the microphone, or scripted lines played from the Demo page. */
export type PartnerSource = 'microphone' | 'script';

let scriptIndex = 0;
/** The scripted partner plays the demo utterances in order, so a demo tells one story. */
export function nextScript(): string {
  const text = DEMO_UTTERANCES[scriptIndex % DEMO_UTTERANCES.length];
  scriptIndex += 1;
  return text;
}
export function resetScript(index = 0): void { scriptIndex = index; }

/** Words heard so far (`final` false), or a finished phrase to keep as a partner turn (`final` true). */
export type OnHeard = (text: string, final: boolean) => void;
export type PartnerSession = { stop(): void };

/** The slice of the Web Speech recognition API this file uses. */
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionConstructor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The longest wait between attempts to bring a failing microphone back. */
const RETRY_CAP_MS = 30_000;

/**
 * Hear the partner for as long as the session lives (owner, 2026-11-07: listening is always on).
 *
 * Recognition is driven directly rather than through `shared/speech.ts`, because the shared
 * `listen` reports the end of a session the same way as a final result and could not be
 * restarted. Chrome ends a continuous session on silence; every ended session restarts until
 * `stop()`. Nothing ever stops on a timer. A phrase the recogniser finalises, or words still
 * interim when a session ends (a pause), arrive as `final`. Errors (no permission, offline) back
 * off from 1 s to 30 s and keep trying quietly; there is no scripted fallback here, because a
 * partner who did not speak must never appear to. `onLive` reports whether the microphone is on.
 * A browser without recognition, or an automated one (no microphone to grant), hears nothing.
 */
export function hearPartner(onHeard: OnHeard, onLive: (live: boolean) => void): PartnerSession {
  const automated = typeof navigator !== 'undefined' && navigator.webdriver;
  const Ctor = canListenLive() && !automated ? recognitionConstructor() : null;
  if (!Ctor) { onLive(false); return { stop() {} }; }

  let stopped = false;
  let recognition: Recognition | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const start = () => {
    if (stopped) return;
    const r = new Ctor();
    recognition = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let interim = '';
    let failed = false;
    r.onresult = (event) => {
      failures = 0;
      const finals: string[] = [];
      interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) { if (text) finals.push(text); } else interim = [interim, text].filter(Boolean).join(' ');
      }
      if (stopped) return;
      if (finals.length) onHeard(finals.join(' '), true);
      onHeard(interim, false);
    };
    // Silence and our own stop are normal ends; anything else (network, not-allowed) is a failure.
    r.onerror = (event) => { if (event.error !== 'no-speech' && event.error !== 'aborted') failed = true; };
    r.onend = () => {
      recognition = null;
      if (stopped) return;
      // A pause ended the session with words still interim: they are the phrase.
      if (interim) { onHeard(interim, true); interim = ''; }
      if (!failed) { start(); return; }
      failures += 1;
      onLive(false);
      retry = setTimeout(start, Math.min(RETRY_CAP_MS, 1000 * 2 ** (failures - 1)));
    };
    try { r.start(); onLive(true); } catch { failed = true; r.onend?.(); }
  };
  start();

  return {
    stop: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      recognition?.abort();
      onLive(false);
    },
  };
}

/**
 * A scripted partner line for demos (the Demo page's "Partner speaks", and automated checks):
 * the words arrive one by one as interim text, then the whole line as a final phrase.
 */
export function playScript(text: string, onHeard: OnHeard, wordMs = 300): PartnerSession {
  // A stopped line says nothing more (the shared `listen` flushes its words as final on stop).
  let stopped = false;
  const session = listen((partial, done) => { if (!stopped) onHeard(partial, done); }, { script: text, wordMs });
  return { stop: () => { stopped = true; session.stop(); } };
}
