/**
 * Clarté's sound system (NAT-24). Calm, gradient cues generated with the Web Audio API: no files.
 *
 * Every cue is a soft pad: sine voices with a slow attack and a long fade, a warm low-pass filter
 * and a little reverb, all in one key (F major, with an open lydian colour). Nothing starts
 * abruptly, because many people who use Clarté startle easily, and almost all energy sits below
 * 1 kHz, away from the band that carries speech, so cues never mask the spoken voice.
 *
 * The harmony explores slowly: each accepted word moves one step round a four-chord cycle, so a
 * conversation drifts through Fmaj9, Dm9, B♭maj9(♯11) and Cadd9 instead of repeating one chime.
 * Letter groups each have their own note from the F pentatonic scale, so they always fit the
 * chord that blooms when the word is accepted. Small random detuning, timing and voicing keep
 * the hundredth play from sounding mechanical.
 *
 * The rules, the cue map and the reasons are in `../SOUND.md`. Styles call `play(cue)` where the
 * moment happens; this module decides whether the cue is heard (level, volume, ducking).
 */

export type Cue =
  | 'word'
  | 'control'
  | 'delete'
  | 'listen-start'
  | 'listen-stop'
  | 'speak-start'
  | 'speak-end'
  | 'unsure'
  | 'calibration-step'
  | 'calibrated';

/** All cues, a smaller set of the important ones, or silence. */
export type SoundLevel = 'all' | 'fewer' | 'off';

export type CueOptions = {
  /** Calibration point index for `calibration-step`. */
  step?: number;
};

export type CueInfo = { cue: Cue; name: string; moment: string; fewer: boolean };

/** The cue map, in the order a session meets them. `fewer` marks the cues kept at the Fewer level. */
export const CUES: readonly CueInfo[] = [
  { cue: 'listen-start', name: 'Opening', moment: 'Clarté starts listening to the partner', fewer: true },
  { cue: 'listen-stop', name: 'Settling', moment: 'Listening stops', fewer: true },
  { cue: 'word', name: 'Bloom', moment: 'A word is accepted (the chord moves one step each time)', fewer: true },
  { cue: 'delete', name: 'Ease', moment: 'Delete or undo', fewer: false },
  { cue: 'control', name: 'Touch', moment: 'A button, menu item or setting is chosen', fewer: false },
  { cue: 'speak-start', name: 'Breath in', moment: 'Clarté starts speaking (then every cue ducks)', fewer: true },
  { cue: 'speak-end', name: 'Breath out', moment: 'Clarté finishes speaking', fewer: true },
  { cue: 'unsure', name: 'Hush', moment: 'Nothing matched; play about a second late, never as an error', fewer: false },
  { cue: 'calibration-step', name: 'Step', moment: 'A calibration point is captured (rises point by point)', fewer: false },
  { cue: 'calibrated', name: 'Arrival', moment: 'Calibration is complete', fewer: true },
];

// ── Harmony ─────────────────────────────────────────────────────────────────────────────────

const F3 = 174.614;
const hz = (semitones: number) => F3 * 2 ** (semitones / 12);

/** Four chords in semitones from F3, low to high. Each accepted word moves one step. */
const PROGRESSION: readonly (readonly number[])[] = [
  [0, 7, 11, 14, 16], // Fmaj9      F3 C4 E4 G4 A4
  [-3, 4, 7, 11, 12], // Dm9        D3 A3 C4 E4 F4
  [-7, 0, 4, 11, 18], // B♭maj9♯11  B♭2 F3 A3 E4 B4
  [-5, 2, 9, 11, 14], // Cadd9      C3 G3 D4 E4 G4
];

/** Calibration climbs the pentatonic scale, one note per point. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

const CHORD_NAMES = ['Fmaj9', 'Dm9', 'B♭maj9♯11', 'Cadd9'];

let chordIndex = 0;

/** The chord the next accepted word will bloom on. */
export function chordName(): string {
  return CHORD_NAMES[chordIndex];
}

// ── Audio graph ─────────────────────────────────────────────────────────────────────────────

type Graph = { ctx: BaseAudioContext; input: GainNode; duck: GainNode; volume: GainNode };

let graph: Graph | null = null;
let level: SoundLevel = 'all';
let volume = 0.75;
let ducked = false;

/** Peak level of the whole system; the compressor below keeps chords from summing past it. */
const CEILING = 0.55;

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      // Smoothed noise makes a dark, soft room rather than a bright, metallic one.
      smooth += 0.22 * (Math.random() * 2 - 1 - smooth);
      const t = i / ctx.sampleRate;
      const fadeIn = Math.min(1, t / 0.02);
      data[i] = smooth * fadeIn * Math.exp(-t / decay);
    }
  }
  return buffer;
}

function build(make: () => BaseAudioContext = () => new AudioContext({ latencyHint: 'interactive' })): Graph | null {
  try {
    const ctx = make();
    const input = ctx.createGain();
    const duck = ctx.createGain();
    const warmth = ctx.createBiquadFilter();
    const reverb = ctx.createConvolver();
    const wet = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const out = ctx.createGain();

    warmth.type = 'lowpass';
    warmth.frequency.value = 2200;
    warmth.Q.value = 0.4;
    reverb.buffer = impulse(ctx, 3.2, 0.85);
    wet.gain.value = 0.32;
    limiter.threshold.value = -20;
    limiter.knee.value = 12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.02;
    limiter.release.value = 0.3;
    out.gain.value = gainFor(volume);

    input.connect(warmth);
    warmth.connect(duck);
    warmth.connect(reverb).connect(wet).connect(duck);
    duck.connect(limiter).connect(out).connect(ctx.destination);
    duck.gain.value = ducked ? DUCKED : 1;
    return { ctx, input, duck, volume: out };
  } catch {
    return null;
  }
}

/** Loudness is heard roughly as the square of the gain, so the setting maps through it. */
const gainFor = (v: number) => CEILING * Math.max(0, Math.min(1, v)) ** 2;

/** Cue level while Clarté speaks: present if you listen for it, never on top of the voice. */
const DUCKED = 0.22;

function running(): Graph | null {
  if (level === 'off') return null;
  graph ??= build();
  if (!graph) return null;
  const ctx = graph.ctx as AudioContext;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx.state === 'running' ? graph : null;
}

// ── Voices ──────────────────────────────────────────────────────────────────────────────────

type Shape = {
  /** Seconds to full level; never below 20 ms, so nothing clicks or startles. */
  attack: number;
  /** Seconds held at full level before the fade. */
  hold?: number;
  /** Seconds for the fade to fall about 60 dB. */
  release: number;
  gain: number;
  /** Low-pass cutoff at the start and at the peak: the gradient each note opens through. */
  from?: number;
  to?: number;
};

const jitter = (amount: number) => (Math.random() * 2 - 1) * amount;

function note(g: Graph, frequency: number, at: number, shape: Shape): void {
  const { ctx } = g;
  const attack = Math.max(0.02, shape.attack);
  const hold = shape.hold ?? 0;
  const peak = Math.max(0.0001, shape.gain * (1 + jitter(0.08)));
  const end = at + attack + hold + shape.release;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  const from = shape.from ?? 700;
  const to = shape.to ?? 1600;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.linearRampToValueAtTime(to, at + attack);
  filter.frequency.setTargetAtTime(from * 0.8, at + attack + hold, shape.release / 3);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(peak, at + attack);
  amp.gain.setValueAtTime(peak, at + attack + hold);
  // setTargetAtTime falls about 60 dB in seven time constants.
  amp.gain.setTargetAtTime(0, at + attack + hold, shape.release / 7);
  amp.connect(g.input);
  filter.connect(amp);

  const detune = jitter(4);
  const voices: readonly [OscillatorType, number, number][] = [
    ['sine', frequency, 1],
    // A breath of triangle a few cents apart gives the pad its slow shimmer.
    ['triangle', frequency * 2 ** (6 / 1200), 0.22],
  ];
  for (const [type, f, mix] of voices) {
    const osc = ctx.createOscillator();
    const blend = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    blend.gain.value = mix;
    osc.connect(blend).connect(filter);
    osc.start(at);
    osc.stop(end + 0.1);
  }
}

/** An unpitched, dry breath: soft noise through a low band, about a quarter of a second long. */
function breath(g: Graph, at: number): void {
  const { ctx } = g;
  const seconds = 0.4;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 420 * (1 + jitter(0.08));
  band.Q.value = 0.8;
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.setValueAtTime(700, at);
  soften.frequency.linearRampToValueAtTime(350, at + seconds);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(0.11, at + 0.07);
  amp.gain.setTargetAtTime(0, at + 0.07, 0.05);
  // Straight to the output, past the reverb: no tail to linger on.
  const under = ctx.createBiquadFilter();
  under.type = 'lowpass';
  under.frequency.value = 600;
  source.connect(band).connect(soften).connect(under).connect(amp).connect(g.duck);
  source.start(at);
  source.stop(at + seconds);
}

/** Play notes one after another, `spread` seconds apart with a little human unevenness. */
function strum(g: Graph, semitones: readonly number[], at: number, spread: number, shape: Shape): void {
  semitones.forEach((s, i) => note(g, hz(s), at + i * spread + Math.abs(jitter(spread * 0.3)), shape));
}

/** A chord voicing that differs slightly each time: sometimes one inner tone rests. */
function voicing(chord: readonly number[]): number[] {
  if (Math.random() < 0.5) return [...chord];
  const drop = 1 + Math.floor(Math.random() * (chord.length - 2));
  return chord.filter((_, i) => i !== drop);
}

// ── Cues ────────────────────────────────────────────────────────────────────────────────────

/** Play a cue now. Silent when sound is off, the level leaves it out, or audio is still locked. */
export function play(cue: Cue, options: CueOptions = {}): void {
  if (level === 'fewer' && !CUES.find((c) => c.cue === cue)?.fewer) return;
  const g = running();
  if (g) perform(g, cue, options, g.ctx.currentTime + 0.005);
}

function perform(g: Graph, cue: Cue, options: CueOptions, t: number): void {
  const chord = PROGRESSION[chordIndex];

  switch (cue) {
    case 'word': {
      strum(g, voicing(chord), t, 0.035, { attack: 0.06, release: 1.8, gain: 0.075, from: 500, to: 1500 });
      chordIndex = (chordIndex + 1) % PROGRESSION.length;
      break;
    }
    case 'control':
      // Owner, 2026-11-07: not distracting. One low, muffled note from the current chord; no
      // melody, no shimmer, gone in a third of a second.
      note(g, hz(chord[1]), t, { attack: 0.05, release: 0.35, gain: 0.05, from: 400, to: 650 });
      break;
    case 'delete':
      // Owner, 2026-11-07: a note was still distracting. No pitch at all now: a short, quiet
      // breath of filtered noise with no room, like a soft exhale.
      breath(g, t);
      break;
    case 'listen-start':
      // Owner, 2026-11-07: calmer. An open fifth that swells in slowly as the filter opens a
      // little; the notes arrive together, so there is no melody to follow.
      strum(g, [0, 7], t, 0.03, { attack: 0.4, release: 1.5, gain: 0.045, from: 300, to: 800 });
      break;
    case 'listen-stop':
      // The same fifth, quieter, with the filter closing as it fades.
      strum(g, [7, 0], t, 0.03, { attack: 0.35, release: 1.4, gain: 0.04, from: 700, to: 400 });
      break;
    case 'speak-start':
      // A short breath in, already fading by the time the voice begins.
      for (const s of [chord[0] + 12, chord[2], chord[3]]) {
        note(g, hz(s), t, { attack: 0.22, release: 0.5, gain: 0.05, from: 300, to: 1200 });
      }
      break;
    case 'speak-end':
      // Home: the lowest, simplest voicing of F, with a long, soft tail.
      strum(g, [-12, 0, 7, 16], t, 0.05, { attack: 0.14, release: 2.2, gain: 0.07, from: 400, to: 1200 });
      chordIndex = 0;
      break;
    case 'unsure':
      // A suspended pair that neither rises nor falls: "not yet", never "wrong".
      note(g, hz(7), t, { attack: 0.08, release: 0.9, gain: 0.05, from: 500, to: 900 });
      note(g, hz(14), t + 0.06, { attack: 0.08, release: 0.9, gain: 0.04, from: 500, to: 900 });
      break;
    case 'calibration-step': {
      const step = Math.max(0, options.step ?? 0) % PENTATONIC.length;
      note(g, hz(PENTATONIC[step]), t, { attack: 0.03, release: 0.8, gain: 0.11, from: 800, to: 1400 });
      break;
    }
    case 'calibrated':
      strum(g, [-12, 0, 7, 11, 14, 16, 24], t, 0.07, { attack: 0.15, release: 2.6, gain: 0.06, from: 400, to: 1700 });
      chordIndex = 0;
      break;
  }
}

/**
 * A dwell swell (experimental, not used by the styles yet): a faint chord that opens like a
 * gradient while a dwell fills. `cancel` drains it in 150 ms, matching the ring; `complete`
 * lets it fade under the commit cue.
 */
export function swell(durationMs: number): { cancel(): void; complete(): void } {
  const none = { cancel() {}, complete() {} };
  if (level !== 'all') return none;
  const g = running();
  if (!g) return none;
  const { ctx } = g;
  const t = ctx.currentTime;
  const seconds = Math.max(0.15, durationMs / 1000);
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(220, t);
  filter.frequency.exponentialRampToValueAtTime(1300, t + seconds);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.05, t + seconds);
  filter.connect(amp).connect(g.input);
  const chord = PROGRESSION[chordIndex];
  const oscs = [chord[0], chord[1], chord[3]].map((s) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz(s);
    osc.detune.value = jitter(5);
    osc.connect(filter);
    osc.start(t);
    return osc;
  });
  let done = false;
  const fade = (seconds: number) => {
    if (done) return;
    done = true;
    const now = ctx.currentTime;
    amp.gain.cancelScheduledValues(now);
    amp.gain.setValueAtTime(amp.gain.value, now);
    amp.gain.linearRampToValueAtTime(0, now + seconds);
    oscs.forEach((o) => o.stop(now + seconds + 0.05));
  };
  return { cancel: () => fade(0.15), complete: () => fade(0.6) };
}

/**
 * Render a cue to a buffer at the current volume, without playing it: for the listening page's
 * waveforms and for checks. The chord cycle is left where it was.
 */
export async function render(cue: Cue, options: CueOptions = {}, seconds = 4): Promise<AudioBuffer> {
  const rate = 48000;
  const g = build(() => new OfflineAudioContext(2, Math.ceil(rate * seconds), rate));
  if (!g) throw new Error('Web Audio is unavailable');
  const keep = chordIndex;
  perform(g, cue, options, 0);
  chordIndex = keep;
  return (g.ctx as OfflineAudioContext).startRendering();
}

// ── Settings and lifecycle ──────────────────────────────────────────────────────────────────

/** Apply the person's sound settings. `volume` runs from 0 to 1. */
export function configureSound(settings: { level?: SoundLevel; volume?: number }): void {
  if (settings.level) level = settings.level;
  if (settings.volume !== undefined) volume = Math.max(0, Math.min(1, settings.volume));
  if (graph) graph.volume.gain.setTargetAtTime(gainFor(volume), graph.ctx.currentTime, 0.05);
}

/** Lower every cue while Clarté speaks, and bring them back gently after. */
export function duck(on: boolean): void {
  ducked = on;
  if (graph) graph.duck.gain.setTargetAtTime(on ? DUCKED : 1, graph.ctx.currentTime, on ? 0.06 : 0.4);
}

/** Start again from the first chord (a new conversation). */
export function resetHarmony(): void {
  chordIndex = 0;
}

/** Unlock audio on the first key or click; browsers refuse to start it before a gesture. */
export function unlockOnGesture(): () => void {
  const unlock = () => {
    graph ??= build();
    const ctx = graph?.ctx as AudioContext | undefined;
    if (ctx?.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
}
