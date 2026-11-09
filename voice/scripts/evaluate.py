"""Measure a cloned voice against its reference.

For each output clip this reports:

* speaker similarity: cosine between Resemblyzer embeddings of the clip and
  the reference (> 0.75 is usually the same speaker, < 0.6 a different one);
* speaking rate: words per second of the intended text;
* word error rate from Whisper (with --asr), a stand-in for intelligibility.
  It is not a listener study: Bottalico et al. 2026 used the HINT in noise.

Usage:
  .venv/bin/python scripts/evaluate.py --reference ref.wav --text "..." out1.wav out2.wav [--asr]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import librosa
import numpy as np


def embedding(path: Path) -> np.ndarray:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from clarte_voice import speaker

    wav, _ = librosa.load(str(path), sr=24_000)
    return speaker.embed([wav])[0]


def words(text: str) -> list[str]:
    return re.findall(r"[a-z']+", text.lower())


def wer(reference: str, hypothesis: str) -> float:
    r, h = words(reference), words(hypothesis)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    d[:, 0] = range(len(r) + 1)
    d[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1,
                          d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r), len(h)] / max(1, len(r))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path, action="append")
    parser.add_argument("--text", required=True)
    parser.add_argument("--asr", action="store_true", help="also transcribe with whisper-base.en")
    parser.add_argument("clips", nargs="+", type=Path)
    args = parser.parse_args()

    refs = {p.name: embedding(p) for p in args.reference}
    asr = None
    if args.asr:
        from transformers import pipeline  # pip install transformers for --asr

        asr = pipeline("automatic-speech-recognition", model="openai/whisper-base.en")
    rows = []
    for clip in args.clips:
        emb = embedding(clip)
        seconds = librosa.get_duration(path=str(clip))
        row = {
            "clip": clip.name,
            "seconds": round(seconds, 2),
            "words_per_s": round(len(words(args.text)) / seconds, 2),
            **{f"sim_{name}": round(float(emb @ ref), 3) for name, ref in refs.items()},
        }
        if asr is not None:
            wav, _ = librosa.load(str(clip), sr=16_000)
            heard = asr(wav)["text"].strip()
            row["heard"] = heard
            row["wer"] = round(wer(args.text, heard), 3)
        rows.append(row)
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
