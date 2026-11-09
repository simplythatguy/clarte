// Microphone capture for guided recordings.
//
// Browser voice processing (echo cancellation, noise suppression, automatic
// gain) reshapes the voice the model should learn, so it is turned off;
// the service normalizes loudness itself, which lifts quiet (hypophonic)
// speech without the pumping AGC adds.

export interface Take {
  blob: Blob;
  seconds: number;
  url: string;
}

export const RECORD_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find(isSupported);
}

export function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private analyser: AnalyserNode | null = null;
  private context: AudioContext | null = null;

  async open(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia(RECORD_CONSTRAINTS);
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(this.analyser);
  }

  /** 0..1 input level, for the meter that shows the microphone hears you. */
  level(): number {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / data.length) + 1e-9);
    return Math.min(1, Math.max(0, (db + 60) / 50));
  }

  start(): void {
    if (!this.stream) throw new Error('Microphone is not open.');
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.startedAt = performance.now();
    this.recorder.start(250);
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  stop(): Promise<Take> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Not recording.'));
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        resolve({ blob, seconds: (performance.now() - this.startedAt) / 1000, url: URL.createObjectURL(blob) });
      };
      recorder.stop();
    });
  }

  close(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.context = null;
  }
}

export function takeToFile(take: Take, promptId: string): File {
  const ext = extensionFor(take.blob.type);
  return new File([take.blob], `clarte-${promptId}.${ext}`, { type: take.blob.type });
}
