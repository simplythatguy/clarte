/**
 * The partner's microphone, for listening. The shared `listen()` reports a cumulative transcript but
 * cannot tell a final result from the session ending, and swallows errors, so the app could neither
 * keep listening when Chrome ends a session nor say why capture failed. This session restarts on
 * end (listening never stops on its own), keeps the transcript across restarts, can pause while the
 * device itself speaks (so "One moment" is not transcribed as the partner), and reports fatal errors
 * (no permission, no device, no network). Proposed for shared/speech.ts in REPORT.md.
 */
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export type MicSession = { stop(): void; pause(): void; resume(): void };

const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

export function startMic(onText: (text: string) => void, onFail: (reason: string) => void): MicSession | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor || !window.isSecureContext) return null;
  let committed = '';
  let stopped = false;
  let paused = false;
  let fatal: string | null = null;
  let current: Recognition | null = null;
  let restarts = 0;

  const run = () => {
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) committed = `${committed} ${result[0].transcript.trim()}`.trim();
        else interim += result[0].transcript;
      }
      restarts = 0;
      onText(`${committed} ${interim}`.trim());
    };
    r.onerror = (e) => { if (FATAL.has(e.error)) fatal = e.error; };
    r.onend = () => {
      if (stopped || paused) return;
      // Only a fatal error ends listening. Silence ('no-speech') and ordinary session ends restart,
      // with a short backoff when they repeat, so a quiet partner never becomes invented speech.
      if (fatal) { stopped = true; onFail(fatal); return; }
      restarts += 1;
      window.setTimeout(() => { if (!stopped && !paused) run(); }, Math.min(1000, 100 * restarts));
    };
    current = r;
    try { r.start(); } catch { stopped = true; onFail('start-failed'); }
  };
  run();
  return {
    stop: () => { stopped = true; current?.stop(); },
    pause: () => { paused = true; current?.stop(); },
    resume: () => { if (stopped || !paused) return; paused = false; run(); },
  };
}
