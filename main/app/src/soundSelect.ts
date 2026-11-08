/**
 * Selecting by sound (owner, 2026-11-08): the eyes point, a sound commits. In the gaze engine's
 * confirm mode a steady look closes the dwell line round a card and waits; any short vocal sound
 * (an "ah", a hum, a word) then selects it.
 *
 * Background noise. The microphone runs with the browser's noise suppression and echo
 * cancellation, and only the voice band (150 Hz to 3 kHz) is measured. The noise floor is the
 * level the room sits at most of the time (the 20th percentile of the last 2 s), so a fan, traffic
 * or a steady hum set the baseline instead of triggering, and a voice cannot drag it up. A sound counts only when it rises ONSET_DB
 * above that floor out of a quiet moment and stays there for ONSET_MS; after it, the level must
 * settle before the next one counts, so one long sound selects once.
 */

/** How far above the noise floor a sound must rise, and for how long. */
const ONSET_DB = 12;
const ONSET_MS = 60;
/** Quiet (within QUIET_DB of the floor) needed just before a sound and after one. */
const QUIET_DB = 6;
const QUIET_BEFORE_MS = 150;
const SETTLE_MS = 150;
/** Below this level nothing counts, however quiet the room. */
const MIN_DB = -62;
const FRAME_MS = 20;
/** The noise floor: this percentile of the last FLOOR_FRAMES levels. */
const FLOOR_FRAMES = 2000 / FRAME_MS;
const FLOOR_PERCENTILE = 0.2;

export type SoundSelect = { stop(): void };

/**
 * Listen for sounds and call `onSound` at each one, while `enabled()` is true. Rejects when the
 * microphone is unavailable or blocked.
 */
export async function startSoundSelect(onSound: () => void, enabled: () => boolean): Promise<SoundSelect> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 150 });
  const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3000 });
  const analyser = new AnalyserNode(ctx, { fftSize: 1024 });
  source.connect(highpass).connect(lowpass).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const recent: number[] = [];
  let quietFor = 0;
  let loudFor = 0;
  let armed = true;
  const tick = () => {
    if (ctx.state === 'suspended') void ctx.resume();
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    const db = 10 * Math.log10(sum / samples.length + 1e-12);
    if (db < -110) return; // the stream has not started
    recent.push(db);
    if (recent.length > FLOOR_FRAMES) recent.shift();
    const floor = [...recent].sort((a, b) => a - b)[Math.floor(recent.length * FLOOR_PERCENTILE)];
    const loud = db > floor + ONSET_DB && db > MIN_DB;
    const quiet = db < floor + QUIET_DB;
    loudFor = loud ? loudFor + FRAME_MS : 0;
    if (!armed) {
      quietFor = quiet ? quietFor + FRAME_MS : 0;
      if (quietFor >= SETTLE_MS) armed = true;
      return;
    }
    if (loudFor >= ONSET_MS && quietFor >= QUIET_BEFORE_MS) {
      armed = false;
      quietFor = 0;
      if (enabled()) onSound();
      return;
    }
    if (!loud) quietFor = quiet ? quietFor + FRAME_MS : 0;
  };
  const timer = window.setInterval(tick, FRAME_MS);
  return {
    stop() {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
