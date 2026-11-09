"""Audio decoding, cleanup and writing for the local voice service.

Everything runs on this machine. Recordings are decoded with the system
ffmpeg so that old phone videos, voicemails and browser recordings all work.
"""

from __future__ import annotations

import io
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pyloudnorm
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

SR = 24_000  # Chatterbox's decoder rate; every stored clip uses it.


class DecodeError(ValueError):
    """The file is not audio or video that ffmpeg can read."""


def ffmpeg_path() -> str:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        # The imageio-ffmpeg wheel ships a static ffmpeg, so no system install is needed.
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        raise RuntimeError("ffmpeg is required. Install it with `brew install ffmpeg`.") from None


def decode(path: Path, sr: int = SR, max_seconds: float = 20 * 60) -> np.ndarray:
    """Decode any audio or video file to mono float32 at `sr`."""
    cmd = [
        ffmpeg_path(), "-nostdin", "-v", "error", "-i", str(path),
        "-t", str(max_seconds), "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0 or not result.stdout:
        message = result.stderr.decode(errors="replace").strip().splitlines()
        raise DecodeError(message[-1] if message else "No audio track found.")
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def clean(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """Remove DC offset and rumble below 70 Hz (handling noise, mains hum)."""
    if y.size < sr // 10:
        return y.astype(np.float32)
    y = y - float(np.mean(y))
    sos = butter(4, 70, btype="highpass", fs=sr, output="sos")
    return sosfiltfilt(sos, y).astype(np.float32)


def loudness_normalize(y: np.ndarray, sr: int = SR, target_lufs: float = -23.0) -> np.ndarray:
    """Normalize integrated loudness. Hypophonia (quiet speech) is common in
    Parkinson's, so quiet recordings are lifted rather than rejected."""
    if y.size < sr * 0.5:
        return y
    try:
        loudness = pyloudnorm.Meter(sr).integrated_loudness(y.astype(np.float64))
    except ValueError:
        return y
    if not math.isfinite(loudness):
        return y
    out = y * (10.0 ** ((target_lufs - loudness) / 20.0))
    peak = float(np.max(np.abs(out))) or 1.0
    if peak > 0.98:  # never clip while lifting
        out = out * (0.98 / peak)
    return out.astype(np.float32)


def fade(y: np.ndarray, sr: int = SR, ms: float = 10.0) -> np.ndarray:
    n = min(int(sr * ms / 1000), y.size // 2)
    if n <= 0:
        return y
    y = y.copy()
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    y[:n] *= ramp
    y[-n:] *= ramp[::-1]
    return y


def write_wav(path: Path, y: np.ndarray, sr: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype="PCM_16")


def read_wav(path: Path) -> np.ndarray:
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if sr != SR:
        raise ValueError(f"{path.name} is {sr} Hz; expected {SR} Hz")
    return y


def wav_bytes(y: np.ndarray, sr: int = SR) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, y, sr, format="WAV", subtype="PCM_16")
    return buffer.getvalue()
