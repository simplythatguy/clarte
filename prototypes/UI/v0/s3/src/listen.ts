/**
 * Live listening that keeps listening.
 *
 * `shared/speech.ts`'s `listen` starts one continuous recognition session. Chrome ends such a
 * session by itself after a stretch of silence, which would stop listening on a timer while the
 * band still says Listening. This wrapper restarts the session until `stop()` and keeps everything
 * heard. It reports `onRefused` only when recognition cannot run at all (no permission, no
 * service, no microphone, offline), so the caller can switch to the scripted partner.
 * REPORT.md proposes folding the restart into shared.
 */
type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

const REFUSALS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

export function listenLive(onText: (text: string) => void, onRefused: () => void): { stop(): void } {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) { onRefused(); return { stop: () => {} }; }

  let stopped = false;
  let committed = '';
  let quickEnds = 0;
  let current: Recognition | null = null;

  const start = () => {
    const recognition = new Ctor();
    current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    const startedAt = performance.now();
    let sessionFinal = '';
    recognition.onresult = (event) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finals += `${r[0].transcript.trim()} `;
        else interim += r[0].transcript;
      }
      sessionFinal = finals.trim();
      onText([committed, `${sessionFinal} ${interim}`.trim()].filter(Boolean).join(' '));
    };
    recognition.onerror = (event) => {
      if (REFUSALS.has(event.error)) { stopped = true; onRefused(); }
    };
    recognition.onend = () => {
      committed = [committed, sessionFinal].filter(Boolean).join(' ');
      if (stopped) return;
      // A session that ends at once with nothing heard, three times running, means no service.
      quickEnds = performance.now() - startedAt < 1000 && !sessionFinal ? quickEnds + 1 : 0;
      if (quickEnds >= 3) { stopped = true; onRefused(); return; }
      start();
    };
    try { recognition.start(); } catch { stopped = true; onRefused(); }
  };
  start();

  return {
    stop: () => {
      stopped = true;
      try { current?.stop(); } catch { /* already stopped */ }
    },
  };
}
