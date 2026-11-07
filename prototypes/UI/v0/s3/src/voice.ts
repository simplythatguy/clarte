/**
 * Speaking with word highlighting, and the earcons.
 *
 * `shared/speech.ts` speaks but does not report word boundaries, which Speak needs to highlight the
 * spoken word. This wraps speech synthesis locally with boundary events and a timed fallback for
 * browsers that send none (REPORT.md proposes moving `onWord` into shared).
 */
import { canSpeak } from '../../shared/speech.ts';

export type VoiceResult = 'ended' | 'cancelled' | 'failed';
export type Voice = { cancel(): void; done: Promise<VoiceResult> };

const MS_PER_WORD = 360;

export function say(text: string, onWord: (index: number) => void = () => {}): Voice {
  const words = text.split(/\s+/).filter(Boolean);
  const starts: number[] = [];
  let cursor = 0;
  for (const w of words) { const at = text.indexOf(w, cursor); starts.push(at); cursor = at + w.length; }

  let finished = false;
  let gotBoundary = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let safety: ReturnType<typeof setTimeout> | null = null;
  let resolveDone: (result: VoiceResult) => void = () => {};
  const done = new Promise<VoiceResult>((resolve) => { resolveDone = resolve; });

  const finish = (result: VoiceResult) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (safety) clearTimeout(safety);
    resolveDone(result);
  };

  // Timed highlighting, replaced by real boundaries as soon as one arrives.
  let index = 0;
  const step = () => {
    if (gotBoundary || finished) return;
    onWord(index);
    const pause = /[.,?!;:]$/.test(words[index] ?? '') ? 260 : 0;
    index += 1;
    if (index < words.length) timer = setTimeout(step, MS_PER_WORD + pause);
    // No speech synthesis at all: nothing was spoken, which is a failure, not a completion.
    else if (!canSpeak()) timer = setTimeout(() => finish('failed'), MS_PER_WORD);
  };
  step();

  if (canSpeak() && text.trim()) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.lang = 'en-US';
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      gotBoundary = true;
      if (timer) clearTimeout(timer);
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= event.charIndex) i += 1;
      onWord(i);
    };
    utterance.onend = () => finish('ended');
    utterance.onerror = (event) => finish(event.error === 'interrupted' || event.error === 'canceled' ? 'cancelled' : 'failed');
    window.speechSynthesis.speak(utterance);
    // An engine that never reports the end (no voice installed, a stuck queue) has failed: stop it
    // and say so rather than pretend it spoke.
    safety = setTimeout(() => { window.speechSynthesis.cancel(); finish('failed'); }, words.length * (MS_PER_WORD + 300) + 4000);
  } else if (!text.trim()) {
    finish('ended');
  }

  return {
    done,
    cancel: () => {
      finish('cancelled');
      if (canSpeak()) window.speechSynthesis.cancel();
    },
  };
}

/* Earcons: tiny Web Audio sounds, no files. Distinct for commit, delete and stage change. */

let audio: AudioContext | null = null;

/** Browsers start audio only after a key or click; call this from those events. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no audio: earcons are an extra channel, never the only one */ }
}

function tone(freq: number, startIn: number, length: number, gain: number, endFreq = freq, type: OscillatorType = 'sine'): void {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime + startIn;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const earcons = {
  /** A dry 35 ms tick at every committed selection. */
  commit: () => tone(1760, 0, 0.035, 0.08, 1760, 'triangle'),
  /** A short falling blip for delete. */
  remove: () => tone(620, 0, 0.07, 0.07, 380),
  /** Two soft rising notes at a stage change, also heard by the partner. */
  stage: () => { tone(587, 0, 0.09, 0.06); tone(880, 0.08, 0.12, 0.06); },
  /** A low two-note fall, played about a second after a failure (BRIEF "Selection"). */
  error: () => { tone(330, 1.0, 0.12, 0.06); tone(247, 1.11, 0.16, 0.06); },
};
