/**
 * Per-frame audio features for the sound listener, at 16 kHz: 25 ms windows every 10 ms.
 *
 * Framework-free and DOM-free, so the same code runs in the browser and in the offline evaluation
 * (`scripts/listen-eval.ts`). Each frame carries what the later stages need: its level, a log-mel
 * spectrum (40 bands, 60 Hz to 6 kHz, so a low hum's fundamental is kept), cepstra for matching,
 * spectral flatness (claps and wind are flat, a hum is not) and a YIN pitch with its clarity.
 */

export const RATE = 16000;
export const HOP = 160; // 10 ms
const WIN = 400; // 25 ms
const NFFT = 512;
const MELS = 40;
export const CEPS = 13;
const PITCH_WIN = 640; // 40 ms, enough for two periods at 70 Hz
const F0_MIN = 70;
const F0_MAX = 500;

export type Frame = {
  /** Time of the frame's end, in seconds since the stream began. */
  t: number;
  /** Level in dB (full scale) over 60 Hz to 6 kHz. */
  db: number;
  /** Natural-log mel energies, 40 bands. */
  mel: Float32Array;
  /** Cepstra c0..c12 of the log-mel spectrum (c0 tracks level). */
  ceps: Float32Array;
  /** Spectral flatness over 100 Hz to 6 kHz, 0 (tonal) to 1 (white noise). */
  flatness: number;
  /** Share of the frame's energy below 1 kHz. */
  low: number;
  /** Fundamental frequency in Hz, or 0 when the frame is not voiced. */
  f0: number;
  /** YIN clarity, 0 to 1: how periodic the frame is. */
  clarity: number;
};

const hann = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));

function melOf(hz: number): number { return 2595 * Math.log10(1 + hz / 700); }
function hzOf(mel: number): number { return 700 * (10 ** (mel / 2595) - 1); }

/** Triangular mel filters over the FFT bins, as [first bin, weights]. */
const filters: { from: number; weights: Float32Array }[] = (() => {
  const lo = melOf(60), hi = melOf(6000);
  const edges = Array.from({ length: MELS + 2 }, (_, i) => (hzOf(lo + ((hi - lo) * i) / (MELS + 1)) * NFFT) / RATE);
  return Array.from({ length: MELS }, (_, m) => {
    const [a, b, c] = [edges[m], edges[m + 1], edges[m + 2]];
    const from = Math.floor(a), to = Math.ceil(c);
    const weights = new Float32Array(to - from + 1);
    for (let k = from; k <= to; k++) weights[k - from] = Math.max(0, k < b ? (k - a) / (b - a) : (c - k) / (c - b));
    return { from, weights };
  });
})();

export const MEL_BANDS = MELS;
const dct: Float32Array[] = Array.from({ length: CEPS }, (_, k) => Float32Array.from({ length: MELS }, (_, m) => Math.cos((Math.PI * k * (m + 0.5)) / MELS) * Math.sqrt((k === 0 ? 1 : 2) / MELS)));

/** Cepstra c0..c12 of a log-mel spectrum. */
export function cepstraOf(logMel: Float32Array): Float32Array {
  const ceps = new Float32Array(CEPS);
  for (let c = 0; c < CEPS; c++) { let s = 0; const row = dct[c]; for (let m = 0; m < MELS; m++) s += row[m] * logMel[m]; ceps[c] = s; }
  return ceps;
}

/** In-place radix-2 FFT of length NFFT. */
const bitrev = Uint16Array.from({ length: NFFT }, (_, i) => { let r = 0; for (let b = 0, x = i; b < 9; b++, x >>= 1) r = (r << 1) | (x & 1); return r; });
const cosT = Float32Array.from({ length: NFFT / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / NFFT));
const sinT = Float32Array.from({ length: NFFT / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / NFFT));
function fft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < NFFT; i++) { const j = bitrev[i]; if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step], wi = sinT[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const BIN_60 = Math.round((60 * NFFT) / RATE), BIN_100 = Math.round((100 * NFFT) / RATE);
const BIN_1K = Math.round((1000 * NFFT) / RATE), BIN_6K = Math.round((6000 * NFFT) / RATE);

/** YIN on the most recent PITCH_WIN samples (de Cheveigné & Kawahara 2002). */
function yin(x: Float32Array, start: number, diff: Float32Array): { f0: number; clarity: number } {
  const maxLag = Math.floor(RATE / F0_MIN), minLag = Math.floor(RATE / F0_MAX);
  const n = PITCH_WIN - maxLag;
  let running = 0;
  diff[0] = 1;
  let best = -1, bestValue = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let d = 0;
    for (let i = 0; i < n; i++) { const v = x[start + i] - x[start + i + lag]; d += v * v; }
    running += d;
    diff[lag] = running > 0 ? (d * lag) / running : 1;
    if (lag >= minLag && diff[lag] < bestValue) { bestValue = diff[lag]; best = lag; }
  }
  // The first dip under the absolute threshold wins over the global minimum (octave errors).
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (diff[lag] < 0.2) { while (lag + 1 <= maxLag && diff[lag + 1] < diff[lag]) lag++; best = lag; bestValue = diff[lag]; break; }
  }
  if (best < 0) return { f0: 0, clarity: 0 };
  const clarity = Math.max(0, 1 - bestValue);
  return { f0: clarity > 0.5 ? RATE / best : 0, clarity };
}

/** Turns a stream of 16 kHz samples into frames, one every 10 ms. */
export class FeatureStream {
  private buffer = new Float32Array(PITCH_WIN);
  private filled = 0;
  private hop = new Float32Array(HOP);
  private sinceHop = 0;
  private count = 0;
  private re = new Float32Array(NFFT);
  private im = new Float32Array(NFFT);
  private mel = new Float32Array(MELS);
  private diff = new Float32Array(Math.floor(RATE / F0_MIN) + 1);

  push(samples: Float32Array, out: Frame[] = []): Frame[] {
    // The buffer holds the last PITCH_WIN samples; it shifts by one hop at a time.
    for (let i = 0; i < samples.length; i++) {
      if (this.filled < PITCH_WIN) { this.buffer[this.filled++] = samples[i]; if (this.filled === PITCH_WIN) out.push(this.frame()); continue; }
      this.hop[this.sinceHop++] = samples[i];
      if (this.sinceHop === HOP) {
        this.sinceHop = 0;
        this.buffer.copyWithin(0, HOP);
        this.buffer.set(this.hop, PITCH_WIN - HOP);
        out.push(this.frame());
      }
    }
    return out;
  }

  private frame(): Frame {
    const { re, im, mel, buffer } = this;
    const off = PITCH_WIN - WIN;
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = buffer[off + i] * hann[i];
    fft(re, im);
    let total = 0, low = 0, logSum = 0, linSum = 0, bins = 0;
    for (let k = BIN_60; k <= BIN_6K; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      re[k] = p; // reuse as power
      total += p;
      if (k < BIN_1K) low += p;
      if (k >= BIN_100) { logSum += Math.log(p + 1e-12); linSum += p; bins++; }
    }
    for (let m = 0; m < MELS; m++) {
      const { from, weights } = filters[m];
      let e = 0;
      for (let k = 0; k < weights.length; k++) e += re[from + k] * weights[k];
      mel[m] = Math.log(e + 1e-10);
    }
    const ceps = cepstraOf(mel);
    const { f0, clarity } = yin(buffer, 0, this.diff);
    this.count++;
    // Power of a full-scale sine through the Hann window over NFFT bins is about (WIN/4)^2 / 2 per side.
    const ref = ((WIN / 4) ** 2) / 2;
    return {
      t: (PITCH_WIN + (this.count - 1) * HOP) / RATE,
      db: 10 * Math.log10(total / ref + 1e-12),
      mel: mel.slice(),
      ceps,
      flatness: bins ? Math.exp(logSum / bins) / (linSum / bins + 1e-12) : 1,
      low: total > 0 ? low / total : 0,
      f0,
      clarity,
    };
  }
}
