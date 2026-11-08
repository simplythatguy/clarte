/**
 * The microphone for the sound listener: one stream, shared by whoever listens (sound selection,
 * teaching a sound), opened on the first subscriber and closed after the last.
 *
 * Capture is raw: echo cancellation, noise suppression and automatic gain are all requested off,
 * because the browser's suppressor is built to keep speech and may remove a hum, and automatic
 * gain lifts the noise floor and erases the level difference between the person and someone
 * further away. What the browser actually applied is kept in `settings`. Clarté's own speech is
 * handled by the callers (selection pauses while the device speaks).
 *
 * Audio runs at 16 kHz: the context asks for it, and when a browser refuses, the samples are
 * resampled here. An AudioWorklet posts blocks of samples to this thread, which runs the front
 * end (`features.ts`) and the event cutter (`events.ts`) and hands each event to the subscribers,
 * with the last few seconds of samples so a take can be re-analysed.
 */
import { FeatureStream, RATE, type Frame } from './features.ts';
import { EventCutter, type SoundEvent } from './events.ts';

export type Heard = {
  event: SoundEvent;
  /** The samples from 0.5 s before the sound began to when it was decided (for enrolment). */
  samples: () => Float32Array;
};

export type Subscriber = {
  onEvent?: (heard: Heard) => void;
  /** Every frame's level and the noise floor, for a live meter. */
  onLevel?: (db: number, floor: number) => void;
};

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(1024); this.n = 0; } }
    return true;
  }
}
registerProcessor('clarte-tap', Tap);
`;

const HISTORY = RATE * 6;

/** For the end-to-end check: when the microphone opened, and what the browser applied. */
declare global { interface Window { clarteMic?: { startedAt: number; settings: MediaTrackSettings | null } } }

class Microphone {
  private subscribers = new Set<Subscriber>();
  private starting: Promise<void> | null = null;
  private stopFns: (() => void)[] = [];
  private features = new FeatureStream();
  private cutter = new EventCutter();
  private history = new Float32Array(HISTORY);
  private written = 0;
  private resample: ((x: Float32Array) => Float32Array) | null = null;
  settings: MediaTrackSettings | null = null;
  /** `performance.now()` when the microphone opened (the end-to-end check times its audio by it). */
  startedAt = 0;
  error: string | null = null;

  async subscribe(s: Subscriber): Promise<() => void> {
    this.subscribers.add(s);
    try {
      this.starting ??= this.start();
      await this.starting;
    } catch (e) {
      this.subscribers.delete(s);
      this.starting = null;
      throw e;
    }
    return () => {
      this.subscribers.delete(s);
      if (!this.subscribers.size) this.stop();
    };
  }

  private async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    this.startedAt = performance.now();
    const track = stream.getAudioTracks()[0];
    this.settings = track?.getSettings() ?? null;
    window.clarteMic = { startedAt: this.startedAt, settings: this.settings };
    let ctx: AudioContext;
    try { ctx = new AudioContext({ sampleRate: RATE }); } catch { ctx = new AudioContext(); }
    let source: MediaStreamAudioSourceNode;
    try { source = ctx.createMediaStreamSource(stream); } catch {
      // Firefox will not connect a microphone to a context at another rate: run at its own rate.
      void ctx.close();
      ctx = new AudioContext();
      source = ctx.createMediaStreamSource(stream);
    }
    this.resample = ctx.sampleRate === RATE ? null : linearResampler(ctx.sampleRate, RATE);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(ctx, 'clarte-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(this.resample ? this.resample(e.data) : e.data);
    source.connect(tap);
    // A browser may start audio paused until the page is used; the first click or key resumes it.
    const resume = () => { if (ctx.state === 'suspended') void ctx.resume(); };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    resume();
    this.stopFns = [
      () => { window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); },
      () => { tap.port.onmessage = null; source.disconnect(); },
      () => stream.getTracks().forEach((t) => t.stop()),
      () => void ctx.close(),
    ];
  }

  private stop(): void {
    for (const f of this.stopFns) f();
    this.stopFns = [];
    this.starting = null;
    this.features = new FeatureStream();
    this.cutter = new EventCutter();
    this.written = 0;
  }

  private push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) this.history[(this.written + i) % HISTORY] = samples[i];
    this.written += samples.length;
    const frames: Frame[] = this.features.push(samples);
    const events: SoundEvent[] = [];
    for (const f of frames) {
      this.cutter.push(f, events);
      for (const s of this.subscribers) s.onLevel?.(f.db, this.cutter.floor);
    }
    for (const event of events) {
      const end = this.written;
      const from = Math.max(end - HISTORY + 1, Math.round((event.start - 0.5) * RATE));
      const heard: Heard = { event, samples: () => this.slice(from, end) };
      for (const s of this.subscribers) s.onEvent?.(heard);
    }
  }

  /** Samples [from, to) of the stream, by absolute sample index. */
  private slice(from: number, to: number): Float32Array {
    const out = new Float32Array(Math.max(0, to - from));
    for (let i = 0; i < out.length; i++) out[i] = this.history[(from + i) % HISTORY];
    return out;
  }
}

/**
 * Linear interpolation across blocks. `t` indexes the current block; -1 is the previous block's
 * last sample, so the output runs on seamlessly. This is only the fallback for a browser that
 * refuses a 16 kHz context (Firefox); it has no anti-alias filter, so content above 8 kHz folds
 * into the band. Chrome and Safari resample the microphone themselves.
 */
function linearResampler(from: number, to: number): (x: Float32Array) => Float32Array {
  const step = from / to;
  let t = 0, last = 0;
  return (x) => {
    const out: number[] = [];
    while (t < x.length - 1) {
      const i = Math.floor(t), f = t - i;
      const a = i < 0 ? last : x[i], b = x[i + 1];
      out.push(a + (b - a) * f);
      t += step;
    }
    t -= x.length;
    last = x[x.length - 1];
    return Float32Array.from(out);
  };
}

export const microphone = new Microphone();
