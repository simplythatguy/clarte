/**
 * Tiny non-speech sounds made with the Web Audio API: a click on every commit (under 100 ms), a
 * lower tick for delete, and short two-note figures when the conversation state changes so the
 * partner hears it too. No audio files.
 */
let context: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean): void { enabled = on; }

/** Browsers start audio only after a gesture; call this from the first key or pointer press. */
export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch { /* no audio on this device */ }
}

function note(frequency: number, startIn: number, length: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!enabled || !context || context.state !== 'running') return;
  const at = context.currentTime + startIn;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(context.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** State figures start after the selection click so the two never overlap. */
const AFTER_CLICK = 0.07;

export const earcon = {
  /** A selection committed. 45 ms. */
  commit: () => note(1760, 0, 0.045, 0.08, 'triangle'),
  /** Something was taken back. 70 ms, lower. */
  remove: () => note(440, 0, 0.07, 0.09, 'triangle'),
  /** Listening started: rising. */
  listening: () => { note(660, AFTER_CLICK, 0.09, 0.07); note(990, AFTER_CLICK + 0.08, 0.11, 0.07); },
  /** Listening stopped: falling. */
  paused: () => { note(990, AFTER_CLICK, 0.09, 0.06); note(660, AFTER_CLICK + 0.08, 0.11, 0.06); },
  /** A reply is being composed. */
  composing: () => { note(784, AFTER_CLICK, 0.08, 0.06); note(784, AFTER_CLICK + 0.1, 0.08, 0.06); },
  /** Something failed (the voice did not play). Low and plain; played about a second late. */
  error: () => { note(330, 0, 0.12, 0.08, 'square'); note(262, 0.13, 0.16, 0.08, 'square'); },
  /** The device is about to speak. */
  speaking: () => { note(523, AFTER_CLICK, 0.1, 0.06); note(784, AFTER_CLICK + 0.09, 0.14, 0.06); },
};
