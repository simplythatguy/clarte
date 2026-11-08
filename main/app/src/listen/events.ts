/**
 * Cuts the frame stream into sound events: something that rises clearly out of what came just
 * before it. The noise floor follows minimum statistics (Martin 2001): the quietest smoothed level
 * of the last 1.5 s, so traffic, a fan or distant babble become the floor instead of events. An
 * event must rise RISE_DB above both the floor and the level of the 300 ms before it, so a word in
 * the middle of someone's running speech is not a fresh event, but a sound made close to the
 * microphone over distant chatter is.
 *
 * Each event is offered for a decision once, either when it ends or when it has lasted DECIDE_MS,
 * whichever comes first, so a long hum selects without waiting for the breath to run out.
 */
import { HOP, MEL_BANDS, RATE, type Frame } from './features.ts';

const FRAME_MS = (HOP / RATE) * 1000;
const FLOOR_FRAMES = 150; // 1.5 s
const BEFORE_FRAMES = 30; // 300 ms
const RISE_DB = 9;
const ONSET_FRAMES = 3;
const END_DROP_DB = 15;
const END_FRAMES = 8;
export const DECIDE_MS = 600;
const MAX_MS = 3000;

export type SoundEvent = {
  /** Start and decision time in seconds. */
  start: number;
  at: number;
  /** Whether the sound had ended when it was decided. */
  ended: boolean;
  frames: Frame[];
  /** The level just before the sound began, and the noise floor then. */
  before: number;
  /** Mean mel power of the 300 ms before the sound: the noise it sits on. */
  noise: Float32Array;
  floor: number;
  stats: EventStats;
};

export type EventStats = {
  durationMs: number;
  peakDb: number;
  /** Peak above the level just before the sound (dB). */
  riseDb: number;
  /** Milliseconds from onset to within 3 dB of the peak. */
  attackMs: number;
  flatness: number;
  low: number;
  voiced: number;
  clarity: number;
  /** Median pitch of the voiced frames in Hz, 0 when none. */
  f0: number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function statsOf(frames: Frame[], before: number): EventStats {
  const peak = Math.max(...frames.map((f) => f.db));
  const onset = frames.findIndex((f) => f.db > before + RISE_DB / 2);
  const top = frames.findIndex((f) => f.db > peak - 3);
  // Spectral shape is judged where the sound is, not in its quiet tails.
  const body = frames.filter((f) => f.db > peak - 12);
  const voiced = body.filter((f) => f.f0 > 0);
  return {
    durationMs: frames.length * FRAME_MS,
    peakDb: peak,
    riseDb: peak - before,
    attackMs: Math.max(0, top - Math.max(0, onset)) * FRAME_MS,
    flatness: median(body.map((f) => f.flatness)),
    low: median(body.map((f) => f.low)),
    voiced: body.length ? voiced.length / body.length : 0,
    clarity: median(body.map((f) => f.clarity)),
    f0: median(voiced.map((f) => f.f0)),
  };
}

export class EventCutter {
  private smooth = -120;
  private levels: number[] = [];
  private recent: Frame[] = [];
  private current: { frames: Frame[]; before: number; noise: Float32Array; floor: number; peak: number; quiet: number; decided: boolean } | null = null;
  private above = 0;

  /** The current noise floor in dB. */
  floor = -120;

  push(frame: Frame, out: SoundEvent[] = []): SoundEvent[] {
    this.smooth = this.smooth < -100 ? frame.db : 0.6 * this.smooth + 0.4 * frame.db;
    const before = this.beforeLevel();
    const cur = this.current;
    if (!cur) {
      this.above = frame.db > Math.max(this.floor, before) + RISE_DB ? this.above + 1 : 0;
      if (this.above >= ONSET_FRAMES) {
        const lead = this.recent.slice(-(ONSET_FRAMES + 2));
        this.current = { frames: [...lead, frame], before, noise: this.noiseSpectrum(), floor: this.floor, peak: Math.max(...lead.map((f) => f.db), frame.db), quiet: 0, decided: false };
        this.above = 0;
        this.risen = 0;
      }
    } else if (cur.decided && this.rising(frame, before)) {
      // A fresh sound on top of a long one that was already decided (an engine, a long laugh)
      // starts its own event; a decided sound must not hide the next one.
      this.risen = 0;
      const lead = this.recent.slice(-(ONSET_FRAMES + 2));
      this.current = { frames: [...lead, frame], before, noise: this.noiseSpectrum(), floor: this.floor, peak: Math.max(...lead.map((f) => f.db), frame.db), quiet: 0, decided: false };
    } else {
      cur.frames.push(frame);
      cur.peak = Math.max(cur.peak, frame.db);
      cur.quiet = frame.db < Math.max(cur.peak - END_DROP_DB, cur.before + 4) ? cur.quiet + 1 : 0;
      const ms = cur.frames.length * FRAME_MS;
      const ended = cur.quiet >= END_FRAMES || ms >= MAX_MS;
      if (!cur.decided && (ended || ms >= DECIDE_MS)) {
        cur.decided = true;
        const frames = ended ? cur.frames.slice(0, cur.frames.length - cur.quiet) : cur.frames.slice();
        out.push({ start: cur.frames[0].t, at: frame.t, ended, frames, before: cur.before, noise: cur.noise, floor: cur.floor, stats: statsOf(frames, cur.before) });
      }
      if (ended) this.current = null;
    }
    // The floor and the "before" level learn only from frames outside events.
    if (!this.current) {
      this.levels.push(this.smooth);
      if (this.levels.length > FLOOR_FRAMES) this.levels.shift();
      this.floor = Math.min(...this.levels) + 1.5;
    }
    this.recent.push(frame);
    if (this.recent.length > BEFORE_FRAMES + 10) this.recent.shift();
    return out;
  }

  /** ONSET_FRAMES frames in a row RISE_DB above the level just before them. */
  private risen = 0;
  private rising(frame: Frame, before: number): boolean {
    this.risen = frame.db > before + RISE_DB ? this.risen + 1 : 0;
    return this.risen >= ONSET_FRAMES;
  }

  /** Mean mel power over the 300 ms before the onset frames. */
  private noiseSpectrum(): Float32Array {
    const window = this.recent.slice(-(BEFORE_FRAMES + ONSET_FRAMES + 2), -(ONSET_FRAMES + 2));
    const n = new Float32Array(MEL_BANDS);
    for (const f of window) for (let m = 0; m < MEL_BANDS; m++) n[m] += Math.exp(f.mel[m]) / window.length;
    return n;
  }

  /** Median level of the 300 ms before the latest frames (the onset frames excluded). */
  private beforeLevel(): number {
    const window = this.recent.slice(-(BEFORE_FRAMES + ONSET_FRAMES), -ONSET_FRAMES);
    return window.length ? median(window.map((f) => f.db)) : -120;
  }
}
