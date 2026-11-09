"""Local speaker embeddings, used to spot other people in old recordings
before anything is sent for cloning. Resemblyzer (Apache-2.0) is a small
GE2E speaker encoder; same-speaker segments usually score above 0.75."""

from __future__ import annotations

import threading
import warnings
from typing import Sequence

import librosa
import numpy as np

_encoder = None
_lock = threading.Lock()


def _load():
    global _encoder
    if _encoder is None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from resemblyzer import VoiceEncoder

            _encoder = VoiceEncoder("cpu", verbose=False)
    return _encoder


def embed(clips: Sequence[np.ndarray], sr: int = 24_000) -> np.ndarray:
    encoder = _load()
    with _lock:
        return np.stack([
            encoder.embed_utterance(librosa.resample(c.astype(np.float32), orig_sr=sr, target_sr=16_000))
            for c in clips
        ])
