import numpy as np

from clarte_voice import curate
from clarte_voice.audio import SR, loudness_normalize


def voiced(seconds: float, f0: float = 120.0, wobble: float = 0.0, seed: int = 0) -> np.ndarray:
    """A buzzy harmonic tone with syllable-rate amplitude, like a held vowel."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    pitch = f0 * (1 + wobble * np.sin(2 * np.pi * 6 * t) + wobble * rng.standard_normal(t.size).cumsum() / 4000)
    phase = 2 * np.pi * np.cumsum(pitch) / SR
    y = sum(np.sin(k * phase) / k for k in range(1, 12))
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 4 * t) ** 2
    return (0.2 * y * envelope).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=np.float32)


def test_speech_intervals_split_on_pauses_and_cap_length():
    y = np.concatenate([voiced(2.0), silence(1.0), voiced(12.0), silence(1.0), voiced(0.3)])
    intervals = curate.speech_intervals(y)
    lengths = [(b - a) / SR for a, b in intervals]
    assert all(curate.MIN_SEGMENT_S <= s <= curate.MAX_SEGMENT_S + 0.01 for s in lengths)
    # 2 s + 12 s cut into 3 pieces; the 0.3 s blip is dropped.
    assert len(intervals) == 4


def test_steady_voice_scores_higher_than_wobbly_voice_for_current_source():
    floor = -80.0
    steady = curate.score_segment(voiced(3.0), floor, "current")
    shaky = curate.score_segment(voiced(3.0, wobble=0.08, seed=1), floor, "current")
    assert steady["steadiness"] > shaky["steadiness"]
    assert steady["quality"] > shaky["quality"]


def test_clipping_is_penalised():
    clean = voiced(3.0)
    clipped = np.clip(clean * 8, -1, 1)
    assert curate.score_segment(clipped, -80, "past")["quality"] < curate.score_segment(clean, -80, "past")["quality"]


def test_mark_speakers_flags_the_minority_voice():
    segments = [curate.Segment(n=i, file="a", start=i, end=i + 2, quality=0.9, audio=np.zeros(10)) for i in range(6)]
    base = np.array([1.0, 0.2, 0.0])
    other = np.array([0.1, 1.0, 0.4])
    vectors = [base + 0.05 * i for i in range(5)] + [other]
    curate.mark_speakers(segments, lambda clips: np.array(vectors))
    assert [s.other_speaker for s in segments] == [False] * 5 + [True]


def test_auto_select_prefers_quality_and_excludes_other_speakers():
    segs = [
        curate.Segment(n=0, file="a", start=0, end=4, quality=0.5),
        curate.Segment(n=1, file="a", start=4, end=8, quality=0.95, other_speaker=True),
        curate.Segment(n=2, file="a", start=8, end=12, quality=0.9),
        curate.Segment(n=3, file="a", start=12, end=16, quality=0.8),
        curate.Segment(n=4, file="a", start=16, end=20, quality=0.7),
        curate.Segment(n=5, file="a", start=20, end=24, quality=0.1),
    ]
    chosen = curate.auto_select(segs)
    assert 1 not in chosen  # someone else
    assert 5 not in chosen  # too poor while better speech exists
    assert chosen == [2, 3, 4, 0]  # best first


def test_auto_select_relaxes_quality_when_material_is_short():
    segs = [curate.Segment(n=i, file="a", start=2 * i, end=2 * i + 2, quality=0.2) for i in range(4)]
    assert len(curate.auto_select(segs)) == 4


def test_assemble_caps_reference_length_and_loudness_lifts_quiet_speech():
    clips = [voiced(4.0)] * 50
    reference = curate.assemble(clips)
    assert reference.size == int(curate.MAX_REFERENCE_S * SR)
    quiet = voiced(3.0) * 0.02
    assert np.abs(loudness_normalize(quiet)).max() > np.abs(quiet).max() * 5


def test_auto_select_stops_near_the_target_length():
    segs = [curate.Segment(n=i, file="a", start=5 * i, end=5 * i + 5, quality=0.9) for i in range(40)]
    total = sum(s.duration + curate.GAP_S for s in segs if s.n in curate.auto_select(segs))
    assert curate.TARGET_REFERENCE_S <= total <= curate.TARGET_REFERENCE_S + 5.5
