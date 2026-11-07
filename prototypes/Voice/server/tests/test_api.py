import io
import subprocess

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from clarte_voice.engine import EngineError, Synthesis
from tests.test_curate import silence, voiced


class FakeEngine:
    """Stands in for ElevenLabs: records calls instead of making them."""

    name = "elevenlabs"
    model = "eleven_multilingual_v2"
    configured = True

    def __init__(self):
        self.created, self.deleted, self.spoken = [], [], []
        self.fail_create = False

    def check(self):
        pass

    def create_voice(self, name, reference, denoise):
        if self.fail_create:
            raise EngineError("ElevenLabs answered 400: bad audio", 400)
        seconds = sf.info(str(reference)).duration
        self.created.append((name, round(seconds, 1), denoise))
        return f"remote{len(self.created)}"

    def delete_voice(self, voice_id):
        self.deleted.append(voice_id)

    def speak(self, text, voice_id, style="like-me"):
        self.spoken.append((text, voice_id, style))
        return Synthesis(b"ID3fake-mp3", "audio/mpeg", 12.0)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CLARTE_VOICE_DIR", str(tmp_path / "voices"))
    from clarte_voice import app as app_module
    from clarte_voice import speaker

    fake = FakeEngine()
    monkeypatch.setattr(app_module, "engine", fake)
    monkeypatch.setattr(speaker, "embed", lambda clips, sr=24_000: np.array(
        [[1.0, 0.0, 0.05 * i] for i, _ in enumerate(clips)]))
    test_client = TestClient(app_module.app)
    test_client.fake = fake
    return test_client


def wav_file(*parts):
    buffer = io.BytesIO()
    sf.write(buffer, np.concatenate(parts), 24_000, format="WAV")
    return buffer.getvalue()


def make(client, seconds_each=3.0, n=6, consent="true", source="current"):
    parts = []
    for i in range(n):
        parts += [voiced(seconds_each, f0=110 + i), silence(0.6)]
    return client.post(
        "/voices",
        data={"name": "Sam", "source": source, "consent": consent},
        files=[("files", ("today.wav", wav_file(*parts), "audio/wav"))],
    )


def test_consent_is_required(client):
    assert make(client, consent="false").status_code == 400
    assert client.fake.created == []


def test_create_speak_cache_reselect_and_delete(client, tmp_path):
    response = make(client)
    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile["status"] == "ready" and profile["remoteVoiceId"] == "remote1"
    assert "ElevenLabs" in profile["consent"]["statement"]
    # Only the selected speech goes out, as one reference file; today's
    # recordings are not sent through background-noise removal.
    (name, seconds, denoise), = client.fake.created
    assert name == "Sam" and 10 <= seconds <= 20 and denoise is False
    voice_dir = tmp_path / "voices" / profile["id"]
    # The upload itself is not stored: only segments, reference and profile.
    assert sorted(p.name for p in voice_dir.iterdir()) == ["profile.json", "reference.wav", "segments"]

    first = client.post(f"/voices/{profile['id']}/speak", json={"text": "Hello there.", "style": "clearer"})
    again = client.post(f"/voices/{profile['id']}/speak", json={"text": "Hello  there.", "style": "clearer"})
    assert first.headers["content-type"] == "audio/mpeg" and first.content == b"ID3fake-mp3"
    assert first.headers["x-clarte-cached"] == "0" and again.headers["x-clarte-cached"] == "1"
    assert client.fake.spoken == [("Hello there.", "remote1", "clearer")]  # the repeat cost nothing

    # Re-choosing pieces makes a new clone, then deletes the old one.
    keep = profile["reference"]["segments"][:4]
    updated = client.put(f"/voices/{profile['id']}", json={"selected": keep}).json()
    assert updated["remoteVoiceId"] == "remote2" and client.fake.deleted == ["remote1"]
    client.post(f"/voices/{profile['id']}/speak", json={"text": "Hello there.", "style": "clearer"})
    assert client.fake.spoken[-1][1] == "remote2"  # cache was cleared with the old voice

    # Too little speech: the voice waits for more and the clone is removed.
    updated = client.put(f"/voices/{profile['id']}", json={"selected": keep[:1]}).json()
    assert updated["status"] == "need-more" and client.fake.deleted == ["remote1", "remote2"]
    assert client.post(f"/voices/{profile['id']}/speak", json={"text": "Hi."}).status_code == 409

    assert client.delete(f"/voices/{profile['id']}").status_code == 200
    assert not voice_dir.exists()
    assert client.get("/voices").json() == []


def test_failed_rebuild_keeps_the_working_voice(client):
    profile = make(client).json()
    client.fake.fail_create = True
    keep = profile["reference"]["segments"][:4]
    response = client.put(f"/voices/{profile['id']}", json={"selected": keep})
    assert response.status_code == 400 and "bad audio" in response.json()["detail"]
    after = client.get(f"/voices/{profile['id']}").json()
    assert after["remoteVoiceId"] == "remote1" and after["status"] == "ready"
    assert client.get(f"/voices/{profile['id']}/reference.wav").status_code == 200


def test_failed_first_clone_leaves_nothing_behind(client, tmp_path):
    client.fake.fail_create = True
    assert make(client).status_code == 400
    assert client.get("/voices").json() == []


def test_deleting_a_voice_also_deletes_the_clone(client):
    profile = make(client).json()
    client.delete(f"/voices/{profile['id']}")
    assert client.fake.deleted == ["remote1"]


def test_rejects_unreadable_files_and_bad_ids(client):
    response = client.post(
        "/voices",
        data={"name": "Sam", "source": "past", "consent": "true"},
        files=[("files", ("notes.txt", b"not audio", "text/plain"))],
    )
    assert response.status_code == 422
    assert client.get("/voices/../../etc/reference.wav").status_code == 404
    assert client.get("/voices/zzzzzzzzzzzz/reference.wav").status_code == 404


def test_old_videos_are_accepted_and_denoised(client, tmp_path):
    src = tmp_path / "speech.wav"
    sf.write(src, np.concatenate([voiced(6), silence(0.5), voiced(6)]), 24_000)
    video = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=12.5",
                    "-i", str(src), "-shortest", "-c:v", "libx264", "-c:a", "aac", str(video)], check=True)
    response = client.post(
        "/voices",
        data={"name": "Old video", "source": "past", "consent": "true"},
        files=[("files", ("clip.mp4", video.read_bytes(), "video/mp4"))],
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ready"
    assert client.fake.created[0][2] is True


def test_engine_errors_reach_the_page_as_messages(client, monkeypatch):
    profile = make(client).json()

    def refuse(*_args, **_kwargs):
        raise EngineError("ElevenLabs refused the API key.", 400)

    monkeypatch.setattr(client.fake, "speak", refuse)
    response = client.post(f"/voices/{profile['id']}/speak", json={"text": "Hi."})
    assert response.status_code == 400 and response.json()["detail"] == "ElevenLabs refused the API key."
