/**
 * Speaking with spoken-word highlighting, and the partner source for listening.
 *
 * `shared/speech.ts` speaks without exposing word boundaries, and the brief asks for the spoken
 * word to be highlighted from synthesis boundary events when they exist and a timer otherwise.
 * This wrapper keeps the shared contract (speak text, resolve when done) and adds `onWord`.
 * REPORT.md proposes moving `onWord` into shared.
 */
import { DEMO_UTTERANCES, canListenLive, canSpeak, listen, type ListenSession } from './core/speech.ts';
import { listenLocally } from './listen/partner.ts';

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

/**
 * Where the partner's words come from: the microphone (the browser's recognition, else this computer's),
 * this computer's recognition only (`listen/partner.ts`, nothing leaves the machine), or the demo script
 * (Dev Tools only; it never stands in for a microphone that failed).
 */
export type PartnerSource = 'microphone' | 'local' | 'script';

/** What listening is using, or why it cannot listen. `browser` sends the audio to Google in Chrome; the Stop card says so (NAT-55). */
export type ListenStatus =
  | { kind: 'browser' }
  | { kind: 'local'; reason: string | null }
  | { kind: 'unavailable'; message: string };

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
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

/** A recognition that has not started by now never will (Chromium builds without Google's service stay silent). */
const START_MS = 2500;

function recognitionConstructor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Errors after which the browser's recognition will not work this session: Chromium builds and Electron have
 * no Google speech service ("network"), and a refused service or microphone does not come back by retrying.
 */
const BROKEN = new Set(['network', 'service-not-allowed', 'language-not-supported', 'not-allowed', 'audio-capture', 'bad-grammar']);
/** Set once the browser's recognition has failed, so later sessions go straight to this computer's. */
let browserFailed: string | null = null;

/**
 * Listen to the partner.
 *
 * With the microphone this drives the browser's recognition directly rather than through `shared/speech.ts`,
 * because the shared `listen` reports the end of a session the same way as a final result, so a session that
 * ends after some words (Chrome ends them on silence) could not be restarted. Listening never stops on a timer:
 * every ended session restarts until `stop()`.
 *
 * When the browser has no recognition, or it fails (a session that ends at once with nothing heard, an error
 * such as "network", or repeated failures), this computer's recognition takes over for the rest of the session
 * (NAT-49), keeping the words already heard. Only when that cannot listen either does `onStatus` report
 * `unavailable`; the demo script is never used in place of a microphone.
 */
export function listenToPartner(source: PartnerSource, onText: (transcript: string) => void, onStatus: (status: ListenStatus) => void = () => {}): { stop(): void; live: boolean } {
  let stopped = false;
  let committed = '';
  let script: ListenSession | null = null;
  let recognition: Recognition | null = null;
  let local: { stop(): void } | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const startScript = () => {
    script = listen((t) => { if (!stopped) onText(join(committed, t)); }, { script: nextScript(), wordMs: 300 });
  };

  const startLocal = (reason: string | null) => {
    recognition = null;
    if (reason) {
      browserFailed = reason;
      console.info(`[listen] the browser's speech recognition failed (${reason}); listening on this computer`);
    }
    onStatus({ kind: 'local', reason });
    const fail = (message: string) => { if (!stopped) onStatus({ kind: 'unavailable', message }); };
    listenLocally((t) => { if (!stopped) onText(t); }, committed, fail).then(
      (session) => { if (stopped) session.stop(); else local = session; },
      (error: unknown) => fail(error instanceof Error ? error.message : 'Listening is unavailable.'),
    );
  };

  let failures = 0;
  const startLive = (Ctor: new () => Recognition) => {
    const startedAt = performance.now();
    let heard = false;
    let failed = false;
    let broken: string | null = null;
    let started = false;
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
    // Silence and our own stop are normal ends; anything else is a failure, and some mean it will not work.
    r.onerror = (event) => {
      if (BROKEN.has(event.error)) broken = event.error;
      else if (event.error !== 'no-speech' && event.error !== 'aborted') failed = true;
    };
    r.onstart = () => { started = true; };
    // Some browsers accept start() and then never say anything: no start, no error, no end.
    const silent = setTimeout(() => {
      if (started || stopped || recognition !== r) return;
      r.onend = null;
      try { r.abort(); } catch { /* already gone */ }
      startLocal('it never started');
    }, START_MS);
    r.onend = () => {
      clearTimeout(silent);
      if (stopped || recognition !== r) return;
      if (broken) { startLocal(broken); return; }
      if (!heard && !committed && performance.now() - startedAt < 1500 && failures === 0) { startLocal('the session ended at once'); return; }
      if (!failed) { failures = 0; startLive(Ctor); return; }
      // Repeated failures back off (1 s, 2 s, 4 s), then this computer listens instead.
      failures += 1;
      if (failures > 3) { startLocal('it kept failing'); return; }
      retry = setTimeout(() => { if (!stopped) startLive(Ctor); }, 1000 * 2 ** (failures - 1));
    };
    try { r.start(); } catch { startLocal('it would not start'); }
  };

  const Ctor = canListenLive() ? recognitionConstructor() : null;
  if (source === 'script') startScript();
  else if (source === 'local' || browserFailed) startLocal(null);
  else if (Ctor) { onStatus({ kind: 'browser' }); startLive(Ctor); }
  else startLocal('this browser has no speech recognition');

  return {
    get live() { return recognition !== null || local !== null; },
    stop: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      recognition?.stop();
      local?.stop();
      (script as ListenSession | null)?.stop();
    },
  };
}

function join(a: string, b: string): string { return [a, b].filter(Boolean).join(' ').trim(); }
