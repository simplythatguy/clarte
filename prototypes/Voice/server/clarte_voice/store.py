"""Voice profiles on local disk.

Layout, under CLARTE_VOICE_DIR (default ~/.clarte/voices):

    <id>/profile.json      name, source, consent, segment scores, selection
    <id>/segments/<n>.wav  speech-only clips cut from the uploads
    <id>/reference.wav     the assembled reference the model listens to
    <id>/conds.pt          cached model conditioning for fast speaking

Uploaded files themselves are never kept: they are decoded into a temporary
directory, cut into speech segments, and deleted.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path

import numpy as np

from .audio import read_wav, write_wav

ID_RE = re.compile(r"^[a-f0-9]{12}$")


def root() -> Path:
    base = Path(os.environ.get("CLARTE_VOICE_DIR", Path.home() / ".clarte" / "voices"))
    base.mkdir(parents=True, exist_ok=True)
    return base


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def voice_dir(voice_id: str) -> Path:
    if not ID_RE.match(voice_id):
        raise KeyError(voice_id)
    return root() / voice_id


def save_profile(voice_id: str, profile: dict) -> None:
    path = voice_dir(voice_id) / "profile.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(profile, indent=2))
    tmp.replace(path)


def load_profile(voice_id: str) -> dict:
    path = voice_dir(voice_id) / "profile.json"
    if not path.exists():
        raise KeyError(voice_id)
    return json.loads(path.read_text())


def list_profiles() -> list[dict]:
    out = []
    for path in root().glob("*/profile.json"):
        try:
            out.append(json.loads(path.read_text()))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(out, key=lambda p: p.get("createdAt", 0), reverse=True)


def save_segment(voice_id: str, n: int, audio: np.ndarray) -> None:
    write_wav(voice_dir(voice_id) / "segments" / f"{n}.wav", audio)


def segment_path(voice_id: str, n: int) -> Path:
    return voice_dir(voice_id) / "segments" / f"{int(n)}.wav"


def load_segment(voice_id: str, n: int) -> np.ndarray:
    return read_wav(segment_path(voice_id, n))


def delete(voice_id: str) -> None:
    shutil.rmtree(voice_dir(voice_id), ignore_errors=False)


def now_ms() -> int:
    return int(time.time() * 1000)
