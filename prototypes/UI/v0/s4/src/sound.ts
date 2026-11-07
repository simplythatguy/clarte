/**
 * Earcons, synthesised with the Web Audio API. Tiny, distinct and short: a click on every
 * commit (≤ 100 ms), a two-note figure on a phase change, a low tick on delete. No error tone.
 */
export type Earcon = 'letter' | 'control' | 'delete' | 'phaseUp' | 'phaseDown';

let context: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean): void { enabled = on; }

/** Browsers start audio only after a gesture; call from the first pointer or key event. */
export function unlockAudio(): void {
  if (!context) {
    try { context = new AudioContext(); } catch { context = null; }
  }
  if (context?.state === 'suspended') void context.resume();
}

function tone(frequency: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine', glideTo?: number): void {
  if (!context) return;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function play(earcon: Earcon): void {
  if (!enabled || !context || context.state !== 'running') return;
  const t = context.currentTime + 0.005;
  switch (earcon) {
    case 'letter': tone(1760, t, 0.035, 0.12, 'triangle'); break;
    case 'control': tone(1175, t, 0.05, 0.14, 'triangle'); break;
    case 'delete': tone(520, t, 0.07, 0.14, 'triangle', 330); break;
    case 'phaseUp': tone(660, t, 0.07, 0.1); tone(990, t + 0.075, 0.08, 0.1); break;
    case 'phaseDown': tone(990, t, 0.07, 0.1); tone(660, t + 0.075, 0.08, 0.1); break;
  }
}
