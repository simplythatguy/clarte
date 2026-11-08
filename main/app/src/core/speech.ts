/**
 * Listening and speaking for the prototypes.
 *
 * `listen` streams the conversation partner's words. In Chrome it uses the Web Speech API
 * (network recognition, needs a microphone and an online connection); elsewhere, or when
 * `script` is given, it plays a scripted utterance word by word so demos work offline.
 * `speak` reads the composed message aloud with the browser's speech synthesis.
 *
 * The product will replace both with its own recognition and voice. Keep the signatures.
 */

export type ListenSession = { stop(): void; live: boolean };

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

export function canListenLive(): boolean {
  return typeof window !== 'undefined' && recognitionConstructor() !== null && window.isSecureContext;
}

export const DEMO_UTTERANCES = [
  'Hey, how are you feeling this morning?',
  'Do you want to go outside for a bit? It is sunny.',
  'The nurse said your appointment is at three. Should I come with you?',
  'Are you hungry? I can make lunch now or later.',
];

export type ListenOptions = {
  /** Play this text instead of the microphone, word by word. */
  script?: string;
  /** Milliseconds between scripted words. */
  wordMs?: number;
  lang?: string;
};

/**
 * Start listening. `onText` receives the full transcript so far and whether it is final.
 * The returned session's `live` tells whether the microphone is in use.
 */
export function listen(onText: (transcript: string, final: boolean) => void, options: ListenOptions = {}): ListenSession {
  const Ctor = options.script ? null : recognitionConstructor();
  if (Ctor && window.isSecureContext) {
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.lang ?? 'en-US';
    let committed = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) committed += `${result[0].transcript.trim()} `;
        else interim += result[0].transcript;
      }
      onText(`${committed}${interim}`.trim(), interim === '');
    };
    recognition.onerror = () => { /* the partner can simply try again; no modal */ };
    recognition.onend = () => onText(committed.trim(), true);
    recognition.start();
    return { live: true, stop: () => recognition.stop() };
  }

  const words = (options.script ?? DEMO_UTTERANCES[Math.floor(Math.random() * DEMO_UTTERANCES.length)]).split(/\s+/);
  const wordMs = options.wordMs ?? 320;
  let index = 0;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    index += 1;
    const done = index >= words.length;
    onText(words.slice(0, index).join(' '), done);
    if (done && timer) { clearInterval(timer); timer = null; }
  }, wordMs);
  return {
    live: false,
    stop: () => { if (timer) { clearInterval(timer); timer = null; onText(words.slice(0, index).join(' '), true); } },
  };
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speak text aloud. Resolves when speech ends, or at once when synthesis is unavailable. */
export function speak(text: string, options: { rate?: number; pitch?: number; lang?: string } = {}): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1;
    utterance.lang = options.lang ?? 'en-US';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
