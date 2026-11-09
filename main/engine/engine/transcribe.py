"""Hearing the partner on this computer (NAT-49): Whisper, for when the browser's own recognition fails.

The app listens to the partner with the browser's speech recognition where it works (Chrome sends the audio
to Google). Where it does not (Chromium builds without Google's keys, Electron, Brave, no network, a refused
service), the app cuts the partner's speech into utterances on its own microphone stream and posts each one
here as 16 kHz mono PCM. Nothing leaves the machine.

The model is loaded in a background thread once the server is listening, so prediction is never held up by
it; a transcription asked for before it is ready waits for it. On a laptop CPU, whisper-base.en takes about
200 ms for a short sentence once warm.

Whisper writes words for silence ("you", "Thank you."). The app sends only stretches its voice detector
heard as speech, and `clean` drops a lone filler that comes back from a quiet or very short clip.
"""
import threading
import time

import numpy as np

RATE = 16_000
MAX_SECONDS = 30            # Whisper's window; the app cuts utterances shorter than this
DEFAULT_MODEL = "openai/whisper-base.en"
# What Whisper writes for silence, breath and room noise. Kept only when the clip is long and loud enough
# to be real speech.
FILLERS = {"", "you", "you.", "thank you.", "thank you", "thanks for watching!", "thanks for watching.", "bye.",
           ".", "..", "...", "uh", "um", "hmm", "mm"}


def clean(text, audio):
    """The transcript to show, or "" when it is probably Whisper filling silence."""
    text = " ".join(text.split())
    if text.strip(" .!?,").lower() in {f.strip(" .!?,") for f in FILLERS}:
        loud = float(np.max(np.abs(audio))) if audio.size else 0.0
        if audio.size < RATE * 1.5 or loud < 0.05:
            return ""
    return text


class Transcriber:
    """Whisper loaded once, in the background; `transcribe` is safe from any request thread."""

    def __init__(self, name=DEFAULT_MODEL, device="cpu"):
        self.name = name
        self.device = device
        self.state = "loading"          # loading | ready | failed
        self.error = None
        self.last_ms = 0.0
        self._ready = threading.Event()
        self._lock = threading.Lock()   # one transcription at a time; prediction keeps its own lock
        self._processor = self._model = self._torch = None

    def start(self):
        threading.Thread(target=self._load, name="transcriber-load", daemon=True).start()
        return self

    def _load(self):
        t0 = time.perf_counter()
        try:
            import torch
            from transformers import WhisperForConditionalGeneration, WhisperProcessor
            self._torch = torch
            self._processor = WhisperProcessor.from_pretrained(self.name)
            self._model = WhisperForConditionalGeneration.from_pretrained(self.name).to(self.device).eval()
            self._run(np.zeros(RATE, dtype=np.float32))     # warm: the first pass is several times slower
            self.state = "ready"
            print(f"Transcriber {self.name} ready in {time.perf_counter() - t0:.1f}s", flush=True)
        except Exception as error:  # noqa: BLE001 (missing torch on the light engine, no network for the weights, ...)
            self.state, self.error = "failed", f"{type(error).__name__}: {error}"
            print(f"Transcriber unavailable: {self.error}", flush=True)
        finally:
            self._ready.set()

    def _run(self, audio):
        features = self._processor(audio, sampling_rate=RATE, return_tensors="pt").input_features.to(self.device)
        with self._torch.inference_mode():
            ids = self._model.generate(features, max_new_tokens=160)
        return self._processor.batch_decode(ids, skip_special_tokens=True)[0].strip()

    def status(self):
        return {"model": self.name, "state": self.state}

    def transcribe(self, audio, wait=60.0):
        """{available, text}; `available` is false when the model could not be loaded."""
        if not self._ready.wait(wait) or self.state != "ready":
            return {"available": False, "text": "", "state": self.state}
        audio = np.asarray(audio, dtype=np.float32)[: RATE * MAX_SECONDS]
        t0 = time.perf_counter()
        with self._lock:
            text = self._run(audio)
        self.last_ms = 1000 * (time.perf_counter() - t0)
        return {"available": True, "text": clean(text, audio)}


def pcm16(body):
    """Little-endian 16-bit mono PCM bytes as float32 samples in [-1, 1)."""
    if len(body) % 2:
        raise ValueError("audio must be 16-bit PCM (an even number of bytes)")
    if len(body) > RATE * MAX_SECONDS * 2:
        raise ValueError(f"audio must be at most {MAX_SECONDS} seconds of 16 kHz 16-bit mono PCM")
    return np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768.0
