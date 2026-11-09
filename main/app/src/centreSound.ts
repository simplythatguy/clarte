/** Adapted from soundSelect.ts at 4e518b3 (origin/feat/look-and-sound).
 * Same band-limited onset approach; adds fresh-target gating and complete capture cleanup.
 * This detects onsets, not the identity or intention of the person making a sound.
 */
export class SoundOnset {
  private recent: number[] = [];
  private quiet = 0;
  private lastQuiet = 0;
  private sinceQuiet = 0;
  private loud = 0;
  private armed = true;
  private eligibleOnset = false;

  frame(db: number, eligible: boolean): boolean {
    this.recent.push(Math.max(-110, db));
    if (this.recent.length > 100) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)];
    const quiet = db < floor + 6;
    const loud = db > floor + 10 && db > -62;
    if (quiet) { this.quiet += 20; this.sinceQuiet = 0; }
    else {
      if (this.quiet) { this.lastQuiet = this.quiet; this.eligibleOnset = eligible; }
      this.quiet = 0;
      this.sinceQuiet += 20;
    }
    // A look that becomes ready during a sound cannot adopt that sound.
    if (!eligible) this.eligibleOnset = false;
    this.loud = loud ? this.loud + 20 : 0;
    if (!this.armed) {
      if (this.quiet >= 150) this.armed = true;
      return false;
    }
    if (this.recent.length >= 15 && this.loud >= 60 && this.lastQuiet >= 150 && this.sinceQuiet <= this.loud + 120) {
      this.armed = false;
      this.lastQuiet = 0;
      return this.eligibleOnset && eligible;
    }
    return false;
  }
}

export type CaptureState = 'ready' | 'suspended' | 'unavailable';

export async function captureCentreSound(signal: AbortSignal, eligible: () => boolean, confirm: () => void, status: (state: CaptureState) => void): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
  let context: AudioContext | null = null;
  let timer = 0;
  const stop = () => {
    window.clearInterval(timer);
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') void context.close();
    signal.removeEventListener('abort', stop);
  };
  const resume = () => { if (context?.state === 'suspended') void context.resume().catch(() => status('unavailable')); };
  try {
    context = new AudioContext();
    const audio = context;
    const source = audio.createMediaStreamSource(stream);
    const high = audio.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 150;
    const low = audio.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 3000;
    const analyser = audio.createAnalyser(); analyser.fftSize = 1024;
    source.connect(high).connect(low).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const onset = new SoundOnset();
    const report = () => { if (!signal.aborted) status(audio.state === 'running' ? 'ready' : audio.state === 'suspended' ? 'suspended' : 'unavailable'); };
    audio.onstatechange = report;
    for (const track of stream.getAudioTracks()) track.onended = () => { if (!signal.aborted) { status('unavailable'); stop(); } };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    signal.addEventListener('abort', stop, { once: true });
    resume(); report();
    timer = window.setInterval(() => {
      if (audio.state !== 'running') return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      if (onset.frame(10 * Math.log10(sum / samples.length + 1e-12), eligible())) confirm();
    }, 20);
  } catch (error) { stop(); throw error; }
}
