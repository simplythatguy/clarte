/**
 * Tiny earcons generated with the Web Audio API. No audio files.
 *
 * Four sounds, each distinct and short (R-6 §3.5): a click on every commit (≤ 100 ms), a lower
 * tick for delete, and a two-note figure for phase changes that rises when the device starts
 * listening or speaking and falls when it stops. Browsers keep audio suspended until the first
 * key or click, so a pure-gaze session in a fresh tab may start silent.
 */

let context: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void { enabled = on; }

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export type Earcon = 'commit' | 'control' | 'delete' | 'rise' | 'fall';

export function play(earcon: Earcon): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  // Now, not ahead: the commit click is requested in the same task that paints the solid ring
  // (MOTION: the click plays on that frame); only the device's output latency remains.
  const t = ctx.currentTime;
  switch (earcon) {
    case 'commit': tone(ctx, 1320, t, 0.045, 0.16, 'triangle'); break;
    case 'control': tone(ctx, 990, t, 0.06, 0.16, 'triangle'); break;
    case 'delete': tone(ctx, 520, t, 0.07, 0.16, 'triangle'); break;
    case 'rise': tone(ctx, 660, t, 0.09, 0.12); tone(ctx, 880, t + 0.1, 0.12, 0.12); break;
    case 'fall': tone(ctx, 880, t, 0.09, 0.12); tone(ctx, 660, t + 0.1, 0.12, 0.12); break;
  }
}

/** Unlock audio on the first key or click; browsers refuse to start it before a gesture. */
export function unlockOnGesture(): () => void {
  const unlock = () => { audio(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
}
