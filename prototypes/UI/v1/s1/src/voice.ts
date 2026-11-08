/**
 * Speaking with spoken-word highlighting, and the partner source for listening.
 *
 * `shared/speech.ts` speaks without exposing word boundaries, and the brief asks for the spoken
 * word to be highlighted from synthesis boundary events when they exist and a timer otherwise.
 * This wrapper keeps the shared contract (speak text, resolve when done) and adds `onWord`.
 * REPORT.md proposes moving `onWord` into shared.
 */
import { DEMO_UTTERANCES, canListenLive, canSpeak, listen, type ListenSession } from '../../../v0/shared/speech.ts';

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

export type PartnerSource = 'microphone' | 'script';

let scriptIndex = 0;
/** The scripted partner plays the demo utterances in order, so a demo tells one story. */
export function nextScript(): string {
  const text = DEMO_UTTERANCES[scriptIndex % DEMO_UTTERANCES.length];
  scriptIndex += 1;
  return text;
}
export function resetScript(index = 0): void { scriptIndex = index; }

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
};

function recognitionConstructor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Listen to the partner.
 *
 * With the microphone this drives recognition directly rather than through `shared/speech.ts`,
 * because the shared `listen` reports the end of a session the same way as a final result, so
 * a session that ends after some words (Chrome ends them on silence) could not be restarted.
 * Listening never stops on a timer: every ended session restarts until `stop()`. A session that
 * fails within 1.5 s with nothing heard (no permission, offline, an embedded browser) hands
 * over to the scripted partner. REPORT.md proposes an `onEnd` for the shared `listen`.
 */
export function listenToPartner(source: PartnerSource, onText: (transcript: string) => void): { stop(): void; live: boolean } {
  let stopped = false;
  let committed = '';
  let script: ListenSession | null = null;
  let recognition: Recognition | null = null;

  const startScript = () => {
    script = listen((t) => { if (!stopped) onText(join(committed, t)); }, { script: nextScript(), wordMs: 300 });
  };

  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const startLive = (Ctor: new () => Recognition) => {
    const startedAt = performance.now();
    let heard = false;
    let failed = false;
    const r = new Ctor();
    recognition = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) committed = join(committed, result[0].transcript.trim());
        else interim += result[0].transcript;
      }
      heard = true;
      if (!stopped) onText(join(committed, interim.trim()));
    };
    // Silence and our own stop are normal ends; anything else (network, not-allowed) is a failure.
    r.onerror = (event) => { if (event.error !== 'no-speech' && event.error !== 'aborted') failed = true; };
    r.onend = () => {
      if (stopped) return;
      if (!heard && !committed && performance.now() - startedAt < 1500 && failures === 0) { recognition = null; startScript(); return; }
      if (!failed) { failures = 0; startLive(Ctor); return; }
      // Repeated failures back off (1 s, 2 s, 4 s) and then hand over to the scripted partner,
      // instead of restarting hundreds of times a second while the pill still says Listening.
      failures += 1;
      if (failures > 3) { recognition = null; console.warn('[listen] recognition keeps failing; using the scripted partner'); startScript(); return; }
      retry = setTimeout(() => { if (!stopped) startLive(Ctor); }, 1000 * 2 ** (failures - 1));
    };
    r.start();
  };

  // An automated browser (layout checks, headless probes) has no microphone to grant.
  const automated = typeof navigator !== 'undefined' && navigator.webdriver;
  const Ctor = source === 'microphone' && canListenLive() && !automated ? recognitionConstructor() : null;
  if (Ctor) startLive(Ctor);
  else startScript();

  return {
    get live() { return recognition !== null; },
    stop: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      recognition?.stop();
      (script as ListenSession | null)?.stop();
    },
  };
}

function join(a: string, b: string): string { return [a, b].filter(Boolean).join(' ').trim(); }
