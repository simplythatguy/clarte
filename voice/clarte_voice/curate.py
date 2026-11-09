"""Choose the parts of someone's recordings that should define their voice.

Two kinds of source material arrive here:

* ``past``: recordings from before speech changed (home videos, voicemails,
  talks). They often contain other people, music and room noise, so every
  segment is scored and checked against the dominant speaker.
* ``current``: guided recordings made in Clarte today. These are one speaker
  by construction; the scoring favours the steadiest, clearest phonation,
  because the cloned voice inherits whatever the reference contains.

ElevenLabs recommends one to two minutes of clean speech for Instant Voice
Cloning and warns that more than about three minutes stops helping, so the
reference aims for 90 s, best segments first, capped at 3 minutes.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Callable, Literal, Sequence

import librosa
import numpy as np

from .audio import SR

Source = Literal["past", "current"]

MIN_SEGMENT_S = 0.8
MAX_SEGMENT_S = 5.0
MERGE_GAP_S = 0.3
TARGET_REFERENCE_S = 90.0
MAX_REFERENCE_S = 180.0
MIN_REFERENCE_S = 10.0  # Below this, clones are reliably poor.
GAP_S = 0.25
OTHER_SPEAKER_FLOOR = 0.62  # Resemblyzer cosine; same speaker is usually > 0.75.
OTHER_SPEAKER_MARGIN = 0.12  # Below the typical segment by this much: someone else.


@dataclass
class Segment:
    n: int
    file: str
    start: float
    end: float
    quality: float = 0.0
    snr_db: float = 0.0
    voiced: float = 0.0
    steadiness: float = 0.0
    f0_hz: float | None = None
    clipped: float = 0.0
    speaker_sim: float | None = None
    other_speaker: bool = False
    selected: bool = False
    audio: np.ndarray | None = field(default=None, repr=False)

    @property
    def duration(self) -> float:
        return self.end - self.start

    def public(self) -> dict:
        data = asdict(self)
        data.pop("audio", None)
        data["duration"] = round(self.duration, 3)
        for key in ("start", "end", "quality", "snr_db", "voiced", "steadiness", "clipped"):
            data[key] = round(float(data[key]), 3)
        if data["f0_hz"] is not None:
            data["f0_hz"] = round(float(data["f0_hz"]), 1)
        if data["speaker_sim"] is not None:
            data["speaker_sim"] = round(float(data["speaker_sim"]), 3)
        return data


def _frame_db(y: np.ndarray, frame: int = 1024, hop: int = 256) -> np.ndarray:
    rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0]
    return 20 * np.log10(np.maximum(rms, 1e-6))


def speech_intervals(y: np.ndarray, sr: int = SR) -> list[tuple[int, int]]:
    """Energy-based speech intervals, merged across short pauses and cut into
    pieces of at most MAX_SEGMENT_S so each can be judged on its own."""
    if y.size < sr * MIN_SEGMENT_S:
        return []
    raw = librosa.effects.split(y, top_db=32, frame_length=1024, hop_length=256)
    merged: list[list[int]] = []
    for start, end in raw:
        if merged and start - merged[-1][1] < MERGE_GAP_S * sr:
            merged[-1][1] = int(end)
        else:
            merged.append([int(start), int(end)])
    out: list[tuple[int, int]] = []
    max_len = int(MAX_SEGMENT_S * sr)
    for start, end in merged:
        length = end - start
        if length < MIN_SEGMENT_S * sr:
            continue
        pieces = max(1, int(np.ceil(length / max_len)))
        step = length / pieces
        for i in range(pieces):
            a = int(start + i * step)
            b = int(start + (i + 1) * step)
            if b - a >= MIN_SEGMENT_S * sr:
                out.append((a, b))
    return out


def _sigmoid(x: float) -> float:
    return float(1 / (1 + np.exp(-x)))


def score_segment(seg: np.ndarray, noise_floor_db: float, source: Source, sr: int = SR) -> dict:
    """Signal quality of one segment, in 0..1 plus its raw measurements."""
    frame_db = _frame_db(seg)
    speech_db = float(np.percentile(frame_db, 70))
    snr = speech_db - noise_floor_db
    clipped = float(np.mean(np.abs(seg) > 0.985))

    y16 = librosa.resample(seg, orig_sr=sr, target_sr=16_000)
    f0, voiced_flag, _ = librosa.pyin(y16, fmin=60, fmax=500, sr=16_000, frame_length=1024)
    voiced = float(np.mean(voiced_flag)) if voiced_flag.size else 0.0
    f0_voiced = f0[voiced_flag] if voiced_flag.size else np.array([])
    f0_median = float(np.median(f0_voiced)) if f0_voiced.size else None

    # Frame-to-frame pitch jumps in semitones inside voiced runs: a coarse,
    # robust stand-in for jitter that also catches pitch breaks and tremor.
    steadiness = 0.0
    if f0_voiced.size > 4:
        semis = 12 * np.log2(np.where(voiced_flag, f0, np.nan) / 100.0)
        jumps = np.abs(np.diff(semis))
        jumps = jumps[np.isfinite(jumps)]
        if jumps.size:
            # Mean of clipped jumps: continuous, and one pitch break cannot
            # dominate. ~0.3 st/frame is typical of fluent read speech.
            steadiness = float(np.exp(-np.mean(np.minimum(jumps, 2.0)) / 0.6))

    flatness = float(np.mean(librosa.feature.spectral_flatness(y=seg, n_fft=1024, hop_length=256)))

    s_snr = _sigmoid((snr - 15) / 4)
    s_voiced = float(np.clip(voiced / 0.45, 0, 1))
    s_flat = float(np.clip(1 - (flatness - 0.05) / 0.25, 0, 1))
    s_dur = float(np.clip((len(seg) / sr - MIN_SEGMENT_S) / 1.2, 0, 1))
    s_clip = float(np.clip(1 - clipped * 50, 0, 1))
    if source == "current":
        # Today's recordings are clean and single-speaker; what varies is how
        # steady the voice is. Prefer the steadiest moments.
        weights = dict(snr=0.2, voiced=0.2, steady=0.35, flat=0.1, dur=0.15)
    else:
        weights = dict(snr=0.35, voiced=0.2, steady=0.15, flat=0.15, dur=0.15)
    quality = (
        weights["snr"] * s_snr
        + weights["voiced"] * s_voiced
        + weights["steady"] * steadiness
        + weights["flat"] * s_flat
        + weights["dur"] * s_dur
    ) * s_clip
    return dict(quality=quality, snr_db=snr, voiced=voiced, steadiness=steadiness,
                f0_hz=f0_median, clipped=clipped)


def segment_file(name: str, y: np.ndarray, source: Source, first_n: int = 0) -> list[Segment]:
    frame_db = _frame_db(y)
    noise_floor = float(np.percentile(frame_db, 10)) if frame_db.size else -90.0
    segments = []
    for i, (a, b) in enumerate(speech_intervals(y)):
        audio = y[a:b]
        seg = Segment(n=first_n + i, file=name, start=a / SR, end=b / SR, audio=audio)
        for key, value in score_segment(audio, noise_floor, source).items():
            setattr(seg, key, value)
        segments.append(seg)
    return segments


Embedder = Callable[[Sequence[np.ndarray]], np.ndarray]


def mark_speakers(segments: list[Segment], embed: Embedder | None) -> None:
    """Flag segments that probably belong to someone else.

    The target is assumed to be the dominant voice. The centroid starts as
    the quality-weighted mean of all segment embeddings and is refit on the
    segments closest to it, so a minority of other voices cannot pull it.
    """
    if embed is None or len(segments) < 2:
        return
    emb = np.asarray(embed([s.audio for s in segments]), dtype=np.float64)
    emb /= np.linalg.norm(emb, axis=1, keepdims=True) + 1e-9
    weights = np.array([max(s.quality, 0.05) for s in segments])
    centroid = (emb * weights[:, None]).sum(0)
    for _ in range(3):
        centroid /= np.linalg.norm(centroid) + 1e-9
        sims = emb @ centroid
        keep = sims >= np.median(sims)
        centroid = (emb[keep] * weights[keep, None]).sum(0)
    centroid /= np.linalg.norm(centroid) + 1e-9
    sims = emb @ centroid
    # Adaptive: a recording's own segments agree with each other to a degree
    # that depends on the microphone and room, so judge against the median.
    threshold = min(0.8, max(OTHER_SPEAKER_FLOOR, float(np.median(sims)) - OTHER_SPEAKER_MARGIN))
    for seg, sim in zip(segments, sims):
        seg.speaker_sim = float(sim)
        seg.other_speaker = bool(sim < threshold)


def auto_select(segments: list[Segment], min_quality: float = 0.35) -> list[int]:
    """Best segments first, up to TARGET_REFERENCE_S of speech."""
    usable = [s for s in segments if not s.other_speaker and s.quality >= min_quality]
    if sum(s.duration for s in usable) < MIN_REFERENCE_S:
        # Too little clean material: relax quality, still exclude other people.
        usable = [s for s in segments if not s.other_speaker]
    usable.sort(key=lambda s: s.quality, reverse=True)
    chosen, total = [], 0.0
    for seg in usable:
        if total >= TARGET_REFERENCE_S:
            break
        if total + seg.duration + GAP_S > MAX_REFERENCE_S and total >= MIN_REFERENCE_S:
            continue
        chosen.append(seg.n)
        total += seg.duration + GAP_S
    return chosen


def assemble(clips: Sequence[np.ndarray]) -> np.ndarray:
    """Concatenate clips (already ordered best first) with short gaps,
    trimmed to MAX_REFERENCE_S."""
    from .audio import fade

    gap = np.zeros(int(GAP_S * SR), dtype=np.float32)
    parts: list[np.ndarray] = []
    for clip in clips:
        if parts:
            parts.append(gap)
        parts.append(fade(clip.astype(np.float32)))
    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts)[: int(MAX_REFERENCE_S * SR)]
