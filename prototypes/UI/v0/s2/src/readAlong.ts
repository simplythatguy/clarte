/**
 * Speaking with a read-along highlight driven by the speech itself.
 *
 * The shared `speak()` resolves at the end but reports no word boundaries, so a highlight built on
 * it can only guess. This speaks with the same browser synthesis and follows its `boundary` and
 * `end` events. When a voice sends no boundaries the highlight falls back to an estimate, but the
 * end of speech still comes from the `end` event. When synthesis fails or never starts, the outcome
 * says so, so the app can keep the message and explain. A boundary callback and an error outcome
 * for shared/speech.ts are proposed in REPORT.md.
 */
import { canSpeak } from '../../shared/speech.ts';

export type ReadAlong = { cancel(): void };

function estimate(words: string[]): number[] {
  return words.map((w) => (180 + 62 * w.length) / 0.95);
}

/** How speech ended: spoken, or blocked with the browser's reason (for example `not-allowed`). */
export type SpeechOutcome = { ok: true } | { ok: false; reason: string };

export function speakAlong(text: string, onWord: (index: number) => void, onEnd: (outcome: SpeechOutcome) => void): ReadAlong {
  const words = text.split(/\s+/).filter(Boolean);
  const starts: number[] = [];
  let offset = 0;
  for (const w of words) { const at = text.indexOf(w, offset); starts.push(at); offset = at + w.length; }

  let done = false;
  let boundaries = false;
  const timers: number[] = [];
  const finish = (outcome: SpeechOutcome = { ok: true }) => { if (done) return; done = true; timers.forEach((t) => window.clearTimeout(t)); onEnd(outcome); };
  const runEstimate = (thenEnd: boolean) => {
    let at = 0;
    estimate(words).forEach((ms, i) => {
      timers.push(window.setTimeout(() => { if (!done && !boundaries) onWord(i); }, at));
      at += ms;
    });
    if (thenEnd) timers.push(window.setTimeout(finish, at));
  };

  onWord(0);
  if (!canSpeak()) { finish({ ok: false, reason: 'unsupported' }); return { cancel: () => { done = true; } }; }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.lang = 'en-US';
  let started = false;
  utterance.onstart = () => {
    started = true;
    // Some voices never send boundaries: estimate the highlight, but let `end` finish.
    timers.push(window.setTimeout(() => { if (!boundaries && !done) runEstimate(false); }, 350));
  };
  utterance.onboundary = (e) => {
    if (e.name !== 'word' || done) return;
    boundaries = true;
    let index = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= e.charIndex) index = i;
    onWord(index);
  };
  utterance.onend = () => finish({ ok: true });
  // An error before speech started means nothing was heard: report it, never as spoken. An error
  // after it started (cut off mid-sentence) still ends the turn as spoken.
  utterance.onerror = (e) => finish(started ? { ok: true } : { ok: false, reason: e.error || 'error' });
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  // Synthesis that never starts and never errors (no voices): blocked, not spoken.
  timers.push(window.setTimeout(() => { if (!started && !done) finish({ ok: false, reason: 'no-voice' }); }, 1500));
  return {
    cancel: () => { done = true; timers.forEach((t) => window.clearTimeout(t)); window.speechSynthesis.cancel(); },
  };
}
