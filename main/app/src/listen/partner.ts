/**
 * Hearing the partner on this computer (NAT-49), first, so the partner's speech stays on the machine (NAT-55,
 * audit C1); the browser's recognition (Chrome sends audio to Google) is used only when the engine cannot hear.
 * The microphone stream the
 * sound listener already opens (`runtime.ts`, 16 kHz, raw) is cut into utterances here, and each one is sent
 * to the prediction engine's Whisper (`POST /api/v1/transcribe`, `main/engine/engine/transcribe.py`). Nothing
 * leaves the machine.
 *
 * While the partner talks, the utterance so far is transcribed about once a second, so their words appear as
 * they speak; when they pause, the whole utterance is transcribed once more and that text stays. Only stretches
 * the level detector heard as speech are sent: Whisper writes "you" for silence.
 */
import { microphone } from './runtime.ts';
import { RATE } from './features.ts';
import { engineOrigin } from '../prediction/prediction.ts';

/** A piece of the partner's speech to transcribe: the utterance so far (`interim`) or the whole of it (`final`). */
export type Cut = { kind: 'interim' | 'final'; utterance: number; audio: Float32Array; speechMs: number };

export type CutterOptions = {
  /** A frame counts as speech this far above the noise floor (dB). */
  marginDb: number;
  /** ... and above this absolute level (dBFS), so a silent room's floor never makes hiss into speech. */
  minDb: number;
  /** Speech this long within the last few frames starts an utterance. */
  startMs: number;
  /** Quiet this long ends it. */
  endMs: number;
  /** Audio kept from before the utterance started, so its first syllable is not clipped. */
  prerollMs: number;
  /** An utterance this long is sent and a new one begins (Whisper hears at most 30 s). */
  maxMs: number;
  /** How often the utterance so far is sent while it lasts. */
  interimMs: number;
};

export const CUTTER_DEFAULTS: CutterOptions = { marginDb: 10, minDb: -58, startMs: 60, endMs: 700, prerollMs: 300, maxMs: 15_000, interimMs: 1000 };

const FRAME = RATE / 100;   // 10 ms

/**
 * Cuts a 16 kHz stream into utterances by level: a frame is speech when it stands `marginDb` over a noise floor
 * that falls at once and rises slowly (2 dB a second), so a steady fan or hum becomes the floor.
 */
export class UtteranceCutter {
  private o: CutterOptions;
  private floor = -50;
  private pending = new Float32Array(0);
  private recent: boolean[] = [];
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] | null = null;
  private speechFrames = 0;
  private quietFrames = 0;
  private lastInterim = 0;
  private utterance = 0;

  constructor(options: Partial<CutterOptions> = {}) {
    this.o = { ...CUTTER_DEFAULTS, ...options };
  }

  /** Feed samples; returns what is ready to transcribe. */
  push(samples: Float32Array): Cut[] {
    const cuts: Cut[] = [];
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    let at = 0;
    for (; at + FRAME <= joined.length; at += FRAME) this.frame(joined.slice(at, at + FRAME), cuts);
    this.pending = joined.slice(at);
    return cuts;
  }

  /** End the utterance in progress now (listening stopped): its final cut, if it holds speech. */
  flush(): Cut | null {
    return this.frames ? this.end() : null;
  }

  private frame(frame: Float32Array, cuts: Cut[]): void {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const db = 10 * Math.log10(sum / frame.length + 1e-12);
    this.floor = db < this.floor ? db : this.floor + 0.02;
    const speech = db > this.floor + this.o.marginDb && db > this.o.minDb;
    const ms = (n: number) => n * 10;

    if (!this.frames) {
      this.preroll.push(frame);
      if (ms(this.preroll.length) > this.o.prerollMs) this.preroll.shift();
      this.recent.push(speech);
      if (this.recent.length > 10) this.recent.shift();
      const voiced = this.recent.filter(Boolean).length;
      if (ms(voiced) >= this.o.startMs) {
        this.frames = [...this.preroll];
        this.preroll = [];
        this.recent = [];
        this.speechFrames = voiced;
        this.quietFrames = 0;
        this.lastInterim = 0;
        this.utterance += 1;
      }
      return;
    }
    this.frames.push(frame);
    if (speech) { this.speechFrames += 1; this.quietFrames = 0; } else this.quietFrames += 1;
    const length = ms(this.frames.length);
    if (ms(this.quietFrames) >= this.o.endMs || length >= this.o.maxMs) {
      const cut = this.end();
      if (cut) cuts.push(cut);
    } else if (length - this.lastInterim >= this.o.interimMs) {
      this.lastInterim = length;
      cuts.push({ kind: 'interim', utterance: this.utterance, audio: concat(this.frames), speechMs: ms(this.speechFrames) });
    }
  }

  private end(): Cut | null {
    const frames = this.frames!;
    this.frames = null;
    // The trailing quiet is not sent (Whisper may fill it); a little is kept so the last word ends naturally.
    const keep = Math.max(1, frames.length - Math.max(0, this.quietFrames - 20));
    return { kind: 'final', utterance: this.utterance, audio: concat(frames.slice(0, keep)), speechMs: this.speechFrames * 10 };
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}

/** Peak-normalised 16-bit PCM: the raw microphone is quiet for someone across the table. */
export function toPcm16(audio: Float32Array): ArrayBuffer {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
  const gain = peak > 0 ? Math.min(20, 0.9 / peak) : 1;
  const out = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(audio[i] * gain * 32767)));
  return out.buffer;
}

/** Utterances shorter than this in speech are a cough or a knock, not words. */
const MIN_SPEECH_MS = 250;

/** Why this computer cannot listen. `engine` is true when the engine cannot hear (not running, no transcriber),
 * so the browser's recognition may still work; false when the microphone itself is blocked. */
export class ListenUnavailable extends Error {
  readonly engine: boolean;
  constructor(message: string, engine = true) { super(message); this.engine = engine; }
}

/** Whether the engine can hear the partner now: its origin, or why not. */
async function transcriberOrigin(): Promise<string> {
  const base = engineOrigin();
  if (base === null) throw new ListenUnavailable('The speech engine is not running yet.');
  try {
    const res = await fetch(`${base}/api/v1/health`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const state = ((await res.json()) as { transcriber?: { state?: string } }).transcriber?.state;
    if (state === 'ready' || state === 'loading') return base;
    throw new ListenUnavailable(state === 'failed' ? 'Speech recognition could not start on this computer.' : 'This engine cannot hear speech.');
  } catch (error) {
    if (error instanceof ListenUnavailable) throw error;
    throw new ListenUnavailable('The speech engine is not answering.');
  }
}

/**
 * Listen to the partner with the engine's Whisper. `onText` gets the whole transcript so far, after `prefix`
 * (words already heard another way this session). Rejects with ListenUnavailable when the engine cannot hear
 * or the microphone is blocked.
 */
export async function listenLocally(onText: (transcript: string) => void, prefix = '', onFailure: (why: string) => void = () => {}): Promise<{ stop(): void }> {
  const base = await transcriberOrigin();
  const cutter = new UtteranceCutter();
  const finals = new Map<number, string>();
  let interim: { utterance: number; text: string } | null = null;
  let interimBusy = false;
  let stopped = false;

  const show = () => {
    if (stopped) return;
    const parts = [prefix, ...[...finals.keys()].sort((a, b) => a - b).map((k) => finals.get(k)!)];
    if (interim && !finals.has(interim.utterance)) parts.push(interim.text);
    onText(parts.map((p) => p.trim()).filter(Boolean).join(' '));
  };

  const send = async (cut: Cut): Promise<string | null> => {
    const res = await fetch(`${base}/api/v1/transcribe`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: toPcm16(cut.audio) });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    const body = (await res.json()) as { available?: boolean; text?: string; state?: string };
    if (body.available === false) {
      onFailure(body.state === 'loading' ? 'Speech recognition is still getting ready. Try again in a minute.' : 'Speech recognition stopped on this computer.');
      return null;
    }
    return typeof body.text === 'string' ? body.text : '';
  };

  const handle = (cut: Cut) => {
    if (cut.kind === 'interim') {
      if (interimBusy) return;
      interimBusy = true;
      void send(cut).then((text) => {
        if (text !== null && !finals.has(cut.utterance)) { interim = { utterance: cut.utterance, text }; show(); }
      }, () => {}).finally(() => { interimBusy = false; });
      return;
    }
    if (cut.speechMs < MIN_SPEECH_MS) {
      if (interim?.utterance === cut.utterance) { interim = null; show(); }
      return;
    }
    void send(cut).then((text) => {
      if (text === null) return;
      finals.set(cut.utterance, text);
      if (interim?.utterance === cut.utterance) interim = null;
      show();
    }, (error: unknown) => console.warn('[listen] transcription failed', error));
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = await microphone.subscribe({ onSamples: (samples) => { for (const cut of cutter.push(samples)) handle(cut); } });
  } catch {
    throw new ListenUnavailable('The microphone is blocked. Allow it for this page, then try again.', false);
  }
  if (prefix) show();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    },
  };
}
