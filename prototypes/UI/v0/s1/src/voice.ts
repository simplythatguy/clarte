/**
 * Speaking with the spoken word reported as it goes, so the screen can highlight it.
 *
 * The shared `speak` resolves only at the end, so this local wrapper adds word boundaries
 * (proposed for shared in REPORT.md). Where the voice gives no boundary events, or there is no
 * speech synthesis at all, a timer paces the highlight at a natural speaking rate instead.
 */
import { canSpeak } from '../../shared/speech.ts';

const MS_PER_WORD = 380;

export type Voice = { stop(): void };

/**
 * `onEnd(ok)`: ok is true only when the voice reported that it finished. An error, a voice that
 * never starts, one that never reports its end, or no speech synthesis at all are failures, so
 * the caller keeps the message (council round 2: delivery must be true, not simulated).
 */
export function speakWords(text: string, onWord: (index: number) => void, onEnd: (ok: boolean) => void): Voice {
  const words = text.split(/\s+/).filter(Boolean);
  const starts: number[] = [];
  let offset = 0;
  for (const word of words) { const at = text.indexOf(word, offset); starts.push(at); offset = at + word.length; }

  let done = false;
  let paced: ReturnType<typeof setInterval> | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let safety: ReturnType<typeof setTimeout> | null = null;
  let sawBoundary = false;
  let startCheck: ReturnType<typeof setTimeout> | undefined;

  const finish = (ok = true) => {
    if (done) return;
    done = true;
    if (paced) clearInterval(paced);
    if (fallback) clearTimeout(fallback);
    if (safety) clearTimeout(safety);
    clearTimeout(startCheck);
    onEnd(ok);
  };
  const pace = (from: number, endWithIt: boolean) => {
    let index = from;
    onWord(index);
    paced = setInterval(() => {
      index += 1;
      if (index < words.length) onWord(index);
      else { if (paced) clearInterval(paced); paced = null; if (endWithIt) finish(); }
    }, MS_PER_WORD);
  };

  // No speech synthesis at all: nothing can be heard, so report a failure (the message stays).
  if (!canSpeak()) {
    setTimeout(() => finish(false), 0);
    return { stop: () => finish() };
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.lang = 'en-US';
  utterance.onboundary = (event) => {
    if (event.name !== 'word' || paced) return;
    sawBoundary = true;
    let index = 0;
    while (index + 1 < starts.length && starts[index + 1] <= event.charIndex) index += 1;
    onWord(index);
  };
  let started = false;
  utterance.onstart = () => {
    started = true;
    if (paced) return;
    onWord(0);
    fallback = setTimeout(() => { if (!sawBoundary && !done) pace(0, false); }, 700);
  };
  utterance.onend = () => finish(true);
  // Any error, an interruption included, means the message was not heard in full. (Stop never
  // reaches here: the app stops listening to this voice before it cancels it.)
  utterance.onerror = () => finish(false);
  // Some engines never start (no voices installed) or never report the end; the screen must not hang.
  // A voice that has not started after 2.5 s did not play: report a failure, never a success.
  startCheck = setTimeout(() => { if (!started && !done) { window.speechSynthesis.cancel(); finish(false); } }, 2500);
  safety = setTimeout(() => { if (!done) { utterance.onend = utterance.onerror = null; window.speechSynthesis.cancel(); finish(false); } }, words.length * MS_PER_WORD * 2.5 + 2500);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return {
    stop: () => { finish(); window.speechSynthesis.cancel(); },
  };
}
