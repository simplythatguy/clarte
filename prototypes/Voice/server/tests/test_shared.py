"""Team voices (prototypes/Voice/voices): a name and an ElevenLabs id, seeded onto every laptop."""
import json

from clarte_voice import store
from tests.test_api import client  # noqa: F401  (fixture)


def team_voice(folder, vid="abcdef123456", name="Omer's Voice", remote="team1"):
    (folder / "omer").mkdir(parents=True, exist_ok=True)
    (folder / "omer" / "profile.json").write_text(json.dumps({
        "id": vid, "name": name, "source": "current", "engine": "elevenlabs", "status": "ready",
        "remoteVoiceId": remote, "createdAt": 1, "updatedAt": 1, "reference": {"seconds": 40, "segments": []},
        "segments": [], "files": [], "problems": []}))


def test_team_voices_are_seeded_and_speak(client, tmp_path, monkeypatch):
    monkeypatch.setenv("CLARTE_SHARED_VOICES", str(tmp_path / "team"))
    team_voice(tmp_path / "team")
    assert store.seed_shared() == ["abcdef123456"]
    voices = client.get("/voices").json()
    assert [(v["name"], v["shared"]) for v in voices] == [("Omer's Voice", True)]
    assert client.post("/voices/abcdef123456/speak", json={"text": "Hello."}).status_code == 200
    assert client.fake.spoken[-1][1] == "team1"


def test_a_team_voice_cannot_be_changed_or_deleted_here(client, tmp_path, monkeypatch):
    monkeypatch.setenv("CLARTE_SHARED_VOICES", str(tmp_path / "team"))
    team_voice(tmp_path / "team")
    store.seed_shared()
    assert client.delete("/voices/abcdef123456").status_code == 409
    assert client.put("/voices/abcdef123456", json={"name": "Mine"}).status_code == 409
    assert client.fake.deleted == []
    assert client.get("/voices/abcdef123456").json()["name"] == "Omer's Voice"


def test_a_rename_in_the_repo_reaches_the_laptop_and_own_voices_are_untouched(client, tmp_path, monkeypatch):
    monkeypatch.setenv("CLARTE_SHARED_VOICES", str(tmp_path / "team"))
    own = {"id": "0123456789ab", "name": "Sam", "status": "ready", "remoteVoiceId": "mine", "createdAt": 2}
    (store.voice_dir(own["id"])).mkdir(parents=True)
    store.save_profile(own["id"], own)
    team_voice(tmp_path / "team")
    store.seed_shared()
    team_voice(tmp_path / "team", name="Omer")
    team_voice(tmp_path / "team2", vid=own["id"], name="Taken over")
    store.seed_shared()
    monkeypatch.setenv("CLARTE_SHARED_VOICES", str(tmp_path / "team2"))
    store.seed_shared()
    names = {v["id"]: v["name"] for v in client.get("/voices").json()}
    assert names == {"abcdef123456": "Omer", own["id"]: "Sam"}


def test_voices_without_a_clone_are_skipped(tmp_path, monkeypatch):
    monkeypatch.setenv("CLARTE_VOICE_DIR", str(tmp_path / "voices"))
    monkeypatch.setenv("CLARTE_SHARED_VOICES", str(tmp_path / "team"))
    team_voice(tmp_path / "team", remote="")
    assert store.seed_shared() == []
