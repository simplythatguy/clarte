import json

import httpx
import pytest

from clarte_voice.engine import VOICE_SETTINGS, ElevenLabsEngine, EngineError


def engine_with(handler):
    client = httpx.Client(base_url="https://api.elevenlabs.io", transport=httpx.MockTransport(handler))
    return ElevenLabsEngine(key="sk_test", client=client)


def test_create_voice_sends_one_reference_with_the_key(tmp_path):
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["key"] = request.headers["xi-api-key"]
        seen["body"] = request.read()
        return httpx.Response(200, json={"voice_id": "abc", "requires_verification": False})

    reference = tmp_path / "reference.wav"
    reference.write_bytes(b"RIFF....WAVE")
    assert engine_with(handler).create_voice("Dad", reference, denoise=True) == "abc"
    assert seen["path"] == "/v1/voices/add" and seen["key"] == "sk_test"
    assert b'name="name"\r\n\r\nClarte: Dad' in seen["body"]
    assert b'name="remove_background_noise"\r\n\r\ntrue' in seen["body"]


def test_speak_uses_the_style_settings_and_model():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["json"] = json.loads(request.read())
        return httpx.Response(200, content=b"ID3", headers={"content-type": "audio/mpeg"})

    result = engine_with(handler).speak("  Hello   there ", "abc", "clearer")
    assert result.audio == b"ID3" and result.media_type == "audio/mpeg"
    assert "/v1/text-to-speech/abc" in seen["url"] and "output_format=mp3_44100_128" in seen["url"]
    assert seen["json"] == {"text": "Hello there", "model_id": "eleven_multilingual_v2",
                            "voice_settings": VOICE_SETTINGS["clearer"]}


def test_paper_settings_are_the_default_style():
    assert VOICE_SETTINGS["like-me"] == {"stability": 0.5, "similarity_boost": 1.0, "style": 0.5,
                                         "use_speaker_boost": True, "speed": 1.0}


@pytest.mark.parametrize("status,body,expected", [
    (401, {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}, "refused the API key"),
    (401, {"detail": {"status": "missing_permissions", "message": "needs voices_write"}}, "refused the API key"),
    (402, {"detail": {"message": "You have run out of credits"}}, "out of credits"),
    (422, {"detail": [{"msg": "Field required"}]}, "Field required"),
])
def test_errors_become_plain_messages(status, body, expected):
    engine = engine_with(lambda request: httpx.Response(status, json=body))
    with pytest.raises(EngineError, match=expected):
        engine.speak("Hi", "abc")


def test_missing_key_and_already_deleted_voices(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_API_KEY_FILE", raising=False)
    unkeyed = ElevenLabsEngine()
    assert not unkeyed.configured
    with pytest.raises(EngineError, match="No ElevenLabs API key"):
        unkeyed.speak("Hi", "abc")
    gone = engine_with(lambda request: httpx.Response(404, json={"detail": {"message": "voice not found"}}))
    gone.delete_voice("abc")  # already gone: nothing to do, no error


def test_key_can_come_from_a_file(tmp_path, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    key_file = tmp_path / "key"
    key_file.write_text("sk_from_file\n")
    monkeypatch.setenv("ELEVENLABS_API_KEY_FILE", str(key_file))
    assert ElevenLabsEngine().key == "sk_from_file"
