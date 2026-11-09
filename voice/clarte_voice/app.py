"""Clarte's local voice service.

Run with:  .venv/bin/python -m clarte_voice   (binds 127.0.0.1:4322)

Only the Clarte voice page on this machine may call it (CORS). Recordings are
decoded, cut and scored here; only the selected speech is sent to ElevenLabs
to build the clone, and only typed text is sent to speak with it.
"""

from __future__ import annotations

import hashlib
import os

import numpy as np
import shutil
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from . import curate, speaker, store
from .audio import DecodeError, clean, decode, loudness_normalize, write_wav
from .engine import MAX_TEXT, ElevenLabsEngine, EngineError

MAX_UPLOAD_BYTES = 300 * 1024 * 1024
MAX_FILES = 40
CONSENT_STATEMENT = (
    "These recordings are of my own voice, or I am authorized to make this voice "
    "for the person speaking in them. I agree that the selected speech is sent to "
    "ElevenLabs to create the voice."
)

engine = ElevenLabsEngine()
app = FastAPI(title="Clarte voice", version="0.1.0")
origins = os.environ.get(
    "CLARTE_VOICE_ORIGINS", "http://localhost:5200,http://127.0.0.1:5200"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins if o.strip()],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Clarte-Synthesis-Ms", "X-Clarte-Cached"],
)


@app.exception_handler(EngineError)
def engine_error(_: Request, error: EngineError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


def _get(voice_id: str) -> dict:
    try:
        return store.load_profile(voice_id)
    except KeyError:
        raise HTTPException(404, "That voice no longer exists.") from None


def _own(voice_id: str) -> dict:
    """A voice this laptop may change or delete. Team voices (voice/voices) are the
    team's: changing or deleting one here would replace or delete the clone for everyone."""
    profile = _get(voice_id)
    if profile.get("shared"):
        raise HTTPException(409, "This is a team voice. Change it in the repo's voice/voices.")
    return profile


async def _analyse_uploads(voice_id: str, files: list[UploadFile], source: str, first_n: int):
    if not files:
        raise HTTPException(400, "Add at least one recording.")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Add at most {MAX_FILES} recordings at a time.")
    segments: list[curate.Segment] = []
    problems: list[dict] = []
    total = 0
    with tempfile.TemporaryDirectory(prefix="clarte-voice-") as tmp:
        for index, upload in enumerate(files):
            name = Path(upload.filename or f"recording-{index + 1}").name
            path = Path(tmp) / f"{index}{Path(name).suffix[:10]}"
            data = await upload.read()
            total += len(data)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Those files are larger than 300 MB together.")
            path.write_bytes(data)
            try:
                y = clean(decode(path))
            except DecodeError as error:
                problems.append({"file": name, "problem": f"Couldn't read audio: {error}"})
                continue
            found = curate.segment_file(name, y, source, first_n=first_n + len(segments))
            if not found:
                problems.append({"file": name, "problem": "No speech found."})
            segments.extend(found)
    # Temporary uploads are gone here; only speech segments remain.
    return segments, problems


def _rebuild(voice_id: str, profile: dict) -> dict:
    """Assemble reference.wav from the selected segments and re-clone it.

    A new ElevenLabs voice is made first and the old one deleted after, so a
    failed rebuild leaves the previous voice working."""
    folder = store.voice_dir(voice_id)
    selected = [s["n"] for s in profile["segments"] if s["selected"]]
    order = {n: i for i, n in enumerate(profile.get("order") or [])}
    selected.sort(key=lambda n: order.get(n, 10_000 + n))
    clips = [loudness_normalize(store.load_segment(voice_id, n)) for n in selected]
    reference = curate.assemble(clips)
    seconds = reference.size / 24_000
    old_remote = profile.get("remoteVoiceId")
    if seconds < curate.MIN_REFERENCE_S:
        profile["status"] = "need-more"
        profile["remoteVoiceId"] = None
        (folder / "reference.wav").unlink(missing_ok=True)
    else:
        pending = folder / "reference.next.wav"
        write_wav(pending, loudness_normalize(reference))
        try:
            new_remote = engine.create_voice(profile["name"], pending, denoise=profile["source"] == "past")
        except EngineError:
            pending.unlink(missing_ok=True)
            raise
        pending.replace(folder / "reference.wav")
        profile["remoteVoiceId"] = new_remote
        profile["status"] = "ready"
    profile["reference"] = {"seconds": round(seconds, 2), "segments": selected}
    shutil.rmtree(folder / "cache", ignore_errors=True)  # old phrases used the old voice
    if old_remote and old_remote != profile["remoteVoiceId"]:
        engine.delete_voice(old_remote)
    profile["updatedAt"] = store.now_ms()
    store.save_profile(voice_id, profile)
    return profile


def _apply_selection(profile: dict, segments: list[curate.Segment]) -> None:
    chosen = curate.auto_select(segments)
    for seg in segments:
        seg.selected = seg.n in chosen
    profile["order"] = chosen
    profile["segments"] = [s.public() for s in segments]


def _score_speakers(segments: list[curate.Segment], source: str) -> None:
    curate.mark_speakers(segments, speaker.embed)
    if source == "current":
        # Recorded in Clarte by one person: only flag clear outsiders.
        for seg in segments:
            seg.other_speaker = bool(seg.speaker_sim is not None and seg.speaker_sim < 0.5)


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": engine.name,
        "model": engine.model,
        "keyConfigured": engine.configured,
        "storage": str(store.root()),
    }


@app.post("/warmup")
def warmup():
    """Check the key with ElevenLabs and load the local speaker model."""
    engine.check()
    speaker.embed([np.zeros(24_000, dtype=np.float32)])
    return health()


@app.get("/voices")
def voices():
    return store.list_profiles()


@app.post("/voices")
async def create_voice(
    name: str = Form(..., min_length=1, max_length=60),
    source: Literal["past", "current"] = Form(...),
    consent: bool = Form(...),
    files: list[UploadFile] = File(...),
):
    if not consent:
        raise HTTPException(400, "Confirm whose voice this is before making it.")
    if not engine.configured:
        raise HTTPException(503, "No ElevenLabs API key. Start the service with ELEVENLABS_API_KEY set.")
    voice_id = store.new_id()
    segments, problems = await _analyse_uploads(voice_id, files, source, first_n=0)
    if not segments:
        raise HTTPException(422, {"message": "No usable speech in those recordings.", "problems": problems})
    _score_speakers(segments, source)
    for seg in segments:
        store.save_segment(voice_id, seg.n, seg.audio)
    profile = {
        "id": voice_id,
        "name": name.strip(),
        "source": source,
        "engine": engine.name,
        "createdAt": store.now_ms(),
        "consent": {"statement": CONSENT_STATEMENT, "at": store.now_ms()},
        "files": sorted({s.file for s in segments}),
        "problems": problems,
    }
    _apply_selection(profile, segments)
    try:
        return _rebuild(voice_id, profile)
    except EngineError:
        store.delete(voice_id)  # nothing half-made is left behind
        raise


@app.get("/voices/{voice_id}")
def get_voice(voice_id: str):
    return _get(voice_id)


@app.post("/voices/{voice_id}/recordings")
async def add_recordings(voice_id: str, files: list[UploadFile] = File(...)):
    profile = _own(voice_id)
    existing = [_restore(voice_id, s) for s in profile["segments"]]
    first_n = 1 + max((s.n for s in existing), default=-1)
    added, problems = await _analyse_uploads(voice_id, files, profile["source"], first_n)
    segments = existing + added
    for seg in added:
        store.save_segment(voice_id, seg.n, seg.audio)
    for seg in existing:
        seg.audio = store.load_segment(voice_id, seg.n)
    _score_speakers(segments, profile["source"])
    profile["files"] = sorted(set(profile["files"]) | {s.file for s in added})
    profile["problems"] = profile.get("problems", []) + problems
    _apply_selection(profile, segments)
    return _rebuild(voice_id, profile)


def _restore(voice_id: str, data: dict) -> curate.Segment:
    fields = {k: data[k] for k in ("n", "file", "start", "end", "quality", "snr_db", "voiced",
                                    "steadiness", "f0_hz", "clipped", "speaker_sim",
                                    "other_speaker", "selected")}
    return curate.Segment(**fields)


class VoiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    selected: list[int] | None = Field(default=None, max_length=200)


@app.put("/voices/{voice_id}")
def update_voice(voice_id: str, body: VoiceUpdate):
    profile = _own(voice_id)
    if body.name is not None:
        profile["name"] = body.name.strip()
    if body.selected is not None:
        known = {s["n"] for s in profile["segments"]}
        chosen = [n for n in body.selected if n in known]
        for seg in profile["segments"]:
            seg["selected"] = seg["n"] in chosen
        profile["order"] = chosen
        return _rebuild(voice_id, profile)
    profile["updatedAt"] = store.now_ms()
    store.save_profile(voice_id, profile)
    return profile


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    profile = _own(voice_id)
    if profile.get("remoteVoiceId"):
        engine.delete_voice(profile["remoteVoiceId"])
    store.delete(voice_id)
    return {"deleted": voice_id}


@app.get("/voices/{voice_id}/reference.wav")
def reference(voice_id: str):
    _get(voice_id)
    path = store.voice_dir(voice_id) / "reference.wav"
    if not path.exists():
        raise HTTPException(404, "This voice needs more speech first.")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/voices/{voice_id}/segments/{n}.wav")
def segment(voice_id: str, n: int):
    _get(voice_id)
    path = store.segment_path(voice_id, n)
    if not path.exists():
        raise HTTPException(404, "No such segment.")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "no-store"})


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    style: Literal["like-me", "clearer"] = "like-me"


@app.post("/voices/{voice_id}/speak")
def speak(voice_id: str, body: SpeakRequest):
    profile = _get(voice_id)
    remote = profile.get("remoteVoiceId")
    if profile.get("status") != "ready" or not remote:
        raise HTTPException(409, "This voice needs more speech before it can talk.")
    text = " ".join(body.text.split())
    key = hashlib.sha256(f"{engine.model}\n{body.style}\n{text}".encode()).hexdigest()[:24]
    cached = store.voice_dir(voice_id) / "cache" / f"{key}.mp3"
    if cached.exists():
        # Phrases people say often come back instantly, and cost no credits.
        return FileResponse(cached, media_type="audio/mpeg",
                            headers={"Cache-Control": "no-store", "X-Clarte-Cached": "1",
                                     "X-Clarte-Synthesis-Ms": "0"})
    result = engine.speak(text, remote, style=body.style)
    cached.parent.mkdir(exist_ok=True)
    caches = sorted(cached.parent.glob("*.mp3"), key=lambda p: p.stat().st_mtime)
    for old in caches[: max(0, len(caches) - 199)]:
        old.unlink(missing_ok=True)
    cached.write_bytes(result.audio)
    return Response(
        result.audio,
        media_type=result.media_type,
        headers={
            "Cache-Control": "no-store",
            "X-Clarte-Cached": "0",
            "X-Clarte-Synthesis-Ms": f"{result.synthesis_ms:.0f}",
        },
    )
