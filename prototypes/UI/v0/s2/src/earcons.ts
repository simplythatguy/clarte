/**
 * Earcons: tiny synthesised sounds, no audio files. Each is under 100 ms except the two-note
 * phase cue (140 ms). Letters are never spoken; these are the only per-selection sounds.
 */
export type Earcon = 'group' | 'control' | 'delete' | 'phase' | 'error';

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(ctx: AudioContext, at: number, from: number, to: number, ms: number, gain: number): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + ms / 1000);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  osc.connect(amp).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + ms / 1000 + 0.02);
}

export function play(earcon: Earcon): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.005;
  switch (earcon) {
    case 'group': tone(ctx, t, 1760, 1700, 28, 0.12); break;
    case 'control': tone(ctx, t, 1175, 1100, 45, 0.14); break;
    case 'delete': tone(ctx, t, 880, 560, 70, 0.12); break;
    case 'phase': tone(ctx, t, 660, 660, 60, 0.1); tone(ctx, t + 0.08, 990, 990, 60, 0.1); break;
    case 'error': tone(ctx, t, 330, 300, 90, 0.1); break;
  }
}

/** Browsers start audio only after a gesture; call this from the first key or click. */
export function unlockAudio(): void {
  audio();
}

/**
 * Creating an AudioContext costs about 90 ms. Do it while the page is idle at startup, never on
 * the frame of the first commit, where it would drop frames under the bloom.
 */
export function prepareAudio(): void {
  const create = () => { if (typeof AudioContext !== 'undefined') context ??= new AudioContext(); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(create, { timeout: 2000 });
  else setTimeout(create, 500);
}
