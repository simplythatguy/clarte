"""ElevenLabs voice cloning and speech, wrapped for Clarte.

Clarte still chooses *what* the voice learns from on this computer (see
curate.py); ElevenLabs Instant Voice Cloning then builds the voice from that
selection, and its text-to-speech speaks with it. This is the system
Bottalico et al. (J Voice 2026) evaluated: clones of disordered voices kept
the speaker's identity but were more intelligible than the originals.

The API key comes from ELEVENLABS_API_KEY, or a file named by
ELEVENLABS_API_KEY_FILE. It needs Text to Speech (access) and Voices (write).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

Style = Literal["like-me", "clearer"]
API = "https://api.elevenlabs.io"
MAX_TEXT = 600
DEFAULT_MODEL = "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_128"

# "Like my recordings" uses the settings from the paper: "default or mid-range
# settings ... a balance between natural prosody and consistency of
# articulation while maintaining high fidelity to each speaker's timbre."
# "Steadier" raises stability and drops style exaggeration, so the delivery
# follows the model's fluent prosody rather than the recordings' rhythm.
VOICE_SETTINGS: dict[Style, dict] = {
    "like-me": {"stability": 0.5, "similarity_boost": 1.0, "style": 0.5,
                "use_speaker_boost": True, "speed": 1.0},
    "clearer": {"stability": 0.8, "similarity_boost": 0.9, "style": 0.0,
                "use_speaker_boost": True, "speed": 1.0},
}


class EngineError(RuntimeError):
    """Something the person can act on: a refused key, no credits, bad audio."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def read_key() -> str | None:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    path = os.environ.get("ELEVENLABS_API_KEY_FILE")
    if path and Path(path).is_file():
        return Path(path).read_text().strip() or None
    return None


@dataclass
class Synthesis:
    audio: bytes
    media_type: str
    synthesis_ms: float


def _message(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        detail = None
    text = ""
    if isinstance(detail, dict):
        text = str(detail.get("message") or detail.get("status") or "")
    elif isinstance(detail, str):
        text = detail
    elif isinstance(detail, list) and detail:
        text = str(detail[0].get("msg", ""))
    status = response.status_code
    if status == 401:
        return "ElevenLabs refused the API key. Check it allows Text to Speech and Voices (write)."
    if status in (402, 429) or "quota" in text.lower() or "credits" in text.lower():
        return f"ElevenLabs couldn't do that: {text or 'out of credits or rate limited'}."
    return f"ElevenLabs answered {status}: {text or response.text[:200]}"


class ElevenLabsEngine:
    name = "elevenlabs"

    def __init__(self, key: str | None = None, model: str | None = None, client: httpx.Client | None = None):
        self._key = key
        self.model = model or os.environ.get("CLARTE_ELEVENLABS_MODEL", DEFAULT_MODEL)
        self._client = client

    @property
    def key(self) -> str | None:
        return self._key or read_key()

    @property
    def configured(self) -> bool:
        return bool(self.key)

    def _http(self) -> httpx.Client:
        if not self.key:
            raise EngineError(
                "No ElevenLabs API key. Start the service with ELEVENLABS_API_KEY set.", 503)
        if self._client is None:
            self._client = httpx.Client(base_url=API, timeout=httpx.Timeout(120, connect=10))
        return self._client

    def _send(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = self._http().request(method, path, headers={"xi-api-key": self.key}, **kwargs)
        except httpx.HTTPError as error:
            raise EngineError(f"Couldn't reach ElevenLabs: {error.__class__.__name__}.", 503) from None
        if response.status_code >= 400:
            raise EngineError(_message(response), 502 if response.status_code >= 500 else 400)
        return response

    def check(self) -> None:
        """A cheap call that proves the key works and may manage voices."""
        self._send("GET", "/v2/voices", params={"page_size": 1})

    def create_voice(self, name: str, reference: Path, denoise: bool) -> str:
        with reference.open("rb") as audio:
            response = self._send(
                "POST",
                "/v1/voices/add",
                data={
                    "name": f"Clarte: {name}"[:100],
                    "description": "Made by the Clarte prototype from consented recordings.",
                    "remove_background_noise": "true" if denoise else "false",
                },
                files=[("files", (reference.name, audio, "audio/wav"))],
            )
        body = response.json()
        if body.get("requires_verification"):
            self.delete_voice(body["voice_id"])
            raise EngineError("ElevenLabs wants this voice verified before use, which Clarte can't do yet.", 400)
        return body["voice_id"]

    def delete_voice(self, voice_id: str) -> None:
        try:
            self._send("DELETE", f"/v1/voices/{voice_id}")
        except EngineError as error:
            if "404" not in str(error) and "not found" not in str(error).lower():
                raise

    def speak(self, text: str, voice_id: str, style: Style = "like-me") -> Synthesis:
        text = " ".join(text.split())[:MAX_TEXT]
        if not text:
            raise EngineError("Type something to say.", 400)
        started = time.perf_counter()
        response = self._send(
            "POST",
            f"/v1/text-to-speech/{voice_id}",
            params={"output_format": OUTPUT_FORMAT},
            json={"text": text, "model_id": self.model, "voice_settings": VOICE_SETTINGS[style]},
        )
        return Synthesis(response.content, "audio/mpeg", (time.perf_counter() - started) * 1000)
