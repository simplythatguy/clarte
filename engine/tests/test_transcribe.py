"""Hearing the partner (NAT-49): /api/v1/transcribe over HTTP with a fake transcriber (fast), then Whisper itself.

The live test speaks a sentence with macOS `say` and needs the Whisper weights; it is skipped elsewhere.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1 / "tests"))

from engine.http import serve  # noqa: E402
from engine.transcribe import RATE, clean, pcm16  # noqa: E402
from test_contract import LIVE, FakeEngine  # noqa: E402


class FakeTranscriber:
    def __init__(self):
        self.heard = []

    def status(self):
        return {"model": "fake", "state": "ready"}

    def transcribe(self, audio):
        self.heard.append(len(audio))
        return {"available": True, "text": f"{len(audio)} samples"}


def start(transcriber, port):
    box = {}
    done = threading.Event()

    def on_ready(server):
        box["server"] = server
        done.set()

    threading.Thread(target=serve, args=(FakeEngine(), "127.0.0.1", port), kwargs={"ready": on_ready, "transcriber": transcriber},
                     daemon=True).start()
    done.wait(5)
    return box["server"]


def post_audio(port, body):
    req = Request(f"http://127.0.0.1:{port}/api/v1/transcribe", data=body, headers={"Content-Type": "application/octet-stream"})
    try:
        with urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


class Units(unittest.TestCase):
    def test_pcm16_scales_and_rejects_odd_or_long_bodies(self):
        audio = pcm16(np.array([0, 16384, -32768], dtype="<i2").tobytes())
        self.assertEqual(audio.tolist(), [0.0, 0.5, -1.0])
        with self.assertRaises(ValueError):
            pcm16(b"\x00\x01\x02")
        with self.assertRaises(ValueError):
            pcm16(b"\x00" * (RATE * 31 * 2))

    def test_clean_drops_silence_fillers_but_keeps_real_words(self):
        quiet = np.zeros(RATE, dtype=np.float32)
        loud = np.full(RATE * 2, 0.3, dtype=np.float32)
        self.assertEqual(clean("you", quiet), "")
        self.assertEqual(clean(" Thank you. ", quiet), "")
        self.assertEqual(clean("Thank you.", loud), "Thank you.")
        self.assertEqual(clean("Are you  hungry?", quiet), "Are you hungry?")


class FakeHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 18766
        cls.transcriber = FakeTranscriber()
        cls.server = start(cls.transcriber, cls.port)
        cls.bare_port = 18767
        cls.bare = start(None, cls.bare_port)

    @classmethod
    def tearDownClass(cls):
        for server in (cls.server, cls.bare):
            server.shutdown()
            server.server_close()

    def test_transcribes_pcm(self):
        status, body = post_audio(self.port, np.zeros(RATE, dtype="<i2").tobytes())
        self.assertEqual(status, 200)
        self.assertEqual(body["text"], f"{RATE} samples")
        self.assertTrue(body["available"])
        self.assertIn("ms", body)

    def test_bad_audio_is_a_400(self):
        status, body = post_audio(self.port, b"\x00\x01\x02")
        self.assertEqual(status, 400)
        self.assertIn("16-bit", body["error"])

    def test_health_reports_the_transcriber(self):
        with urlopen(f"http://127.0.0.1:{self.port}/api/v1/health", timeout=5) as res:
            self.assertEqual(json.loads(res.read())["transcriber"], {"model": "fake", "state": "ready"})
        with urlopen(f"http://127.0.0.1:{self.bare_port}/api/v1/health", timeout=5) as res:
            self.assertEqual(json.loads(res.read())["transcriber"]["state"], "off")

    def test_without_a_transcriber_it_says_unavailable(self):
        status, body = post_audio(self.bare_port, np.zeros(RATE, dtype="<i2").tobytes())
        self.assertEqual((status, body), (200, {"available": False, "text": ""}))


@unittest.skipUnless(LIVE and shutil.which("say"), "live Whisper test: needs PREDICT_TESTS=live and macOS say")
class LiveWhisper(unittest.TestCase):
    def test_hears_a_spoken_sentence_and_nothing_in_silence(self):
        from engine.transcribe import Transcriber
        transcriber = Transcriber().start()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "partner.wav"
            subprocess.run(["say", "-o", str(path), "--data-format=LEI16@16000", "Do you want to go outside for a bit?"], check=True)
            with wave.open(str(path)) as w:
                audio = pcm16(w.readframes(w.getnframes()))
        heard = transcriber.transcribe(audio, wait=300)
        if not heard["available"]:
            self.skipTest(f"Whisper unavailable: {transcriber.error}")
        words = heard["text"].lower().replace("?", "").replace(".", "").split()
        # Synthetic speech is not a person; the content words must come through ("for a bit" sometimes reads "bid").
        self.assertEqual(words[:7], ["do", "you", "want", "to", "go", "outside", "for"], heard["text"])
        self.assertEqual(transcriber.transcribe(np.zeros(RATE, dtype=np.float32))["text"], "")


if __name__ == "__main__":
    unittest.main()
