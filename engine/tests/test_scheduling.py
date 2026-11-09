"""Predictions never wait behind punctuation (NAT-52): the engine lock (fast), then the live engine.

The live tests load the engine (about a minute) and need the torch rescorer; PREDICT_TESTS=fast skips them.
"""
import json
import sys
import threading
import time
import unittest
from pathlib import Path

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1 / "tests"))

from urllib.request import Request, urlopen  # noqa: E402

from engine.http import EngineLock, Superseded, serve  # noqa: E402
from test_contract import LIVE, FakeEngine  # noqa: E402

STEP = 0.05


class Lock(unittest.TestCase):
    def background_job(self, lock, steps, log):
        with lock.background() as pause:
            for i in range(steps):
                pause()
                log.append(("punct", i, time.perf_counter()))
                time.sleep(STEP)

    def test_a_prediction_waits_at_most_one_step(self):
        lock, log = EngineLock(), []
        job = threading.Thread(target=self.background_job, args=(lock, 10, log))
        job.start()
        time.sleep(STEP * 2.5)                   # punctuation is mid-way through its third step
        asked = time.perf_counter()
        with lock.urgent():
            waited = time.perf_counter() - asked
            log.append(("predict", None, time.perf_counter()))
        job.join()
        self.assertLess(waited, STEP * 1.6, f"waited {waited * 1000:.0f} ms")
        order = [kind for kind, _, _ in log]
        self.assertEqual(order.count("punct"), 10, "punctuation still finishes every step")
        self.assertLess(order.index("predict"), 5, "the prediction ran before punctuation went on")

    def test_punctuation_waits_for_queued_predictions(self):
        lock, log, started = EngineLock(), [], threading.Event()

        def predict(name, hold):
            with lock.urgent():
                started.set()
                log.append(name)
                time.sleep(hold)

        first = threading.Thread(target=predict, args=("predict-1", STEP * 2))
        first.start()
        started.wait()
        second = threading.Thread(target=predict, args=("predict-2", STEP))
        second.start()
        time.sleep(STEP / 5)
        punct = threading.Thread(target=lambda: self.background_job(lock, 1, log))
        punct.start()
        for t in (first, second, punct):
            t.join()
        self.assertEqual([x if isinstance(x, str) else x[0] for x in log], ["predict-1", "predict-2", "punct"])

    def test_urgent_requests_still_run_one_at_a_time(self):
        lock, inside, most = EngineLock(), [0], [0]

        def predict():
            with lock.urgent():
                inside[0] += 1
                most[0] = max(most[0], inside[0])
                time.sleep(0.01)
                inside[0] -= 1

        threads = [threading.Thread(target=predict) for _ in range(12)]
        bg = threading.Thread(target=self.background_job, args=(lock, 4, []))
        bg.start()
        for t in threads:
            t.start()
        for t in threads + [bg]:
            t.join()
        self.assertEqual(most[0], 1)

    def test_a_newer_background_request_stops_the_older_one_at_its_next_step(self):
        lock, log, outcome = EngineLock(), [], {}

        def job(name, steps):
            try:
                self.background_job(lock, steps, log)
                outcome[name] = "done"
            except Superseded:
                outcome[name] = "superseded"

        old = threading.Thread(target=job, args=("old", 20))
        old.start()
        time.sleep(STEP * 2.5)
        asked = time.perf_counter()
        new = threading.Thread(target=job, args=("new", 2))
        new.start()
        new.join()
        old.join()
        self.assertEqual(outcome, {"old": "superseded", "new": "done"})
        self.assertLess(time.perf_counter() - asked, STEP * 4, "the new request waited one step of the old, then ran its own two")
        self.assertLess(len(log), 8, "the old request stopped instead of finishing its 20 steps")

    def test_a_request_still_waiting_gives_up_when_a_newer_one_arrives(self):
        lock, outcome, holding = EngineLock(), {}, threading.Event()

        def predict():
            with lock.urgent():
                holding.set()
                time.sleep(STEP * 3)

        def job(name):
            try:
                with lock.background():
                    outcome[name] = "ran"
            except Superseded:
                outcome[name] = "superseded"

        busy = threading.Thread(target=predict)
        busy.start()
        holding.wait()
        older = threading.Thread(target=job, args=("older",))
        older.start()
        time.sleep(STEP / 2)
        newer = threading.Thread(target=job, args=("newer",))
        newer.start()
        for t in (busy, older, newer):
            t.join()
        self.assertEqual(outcome, {"older": "superseded", "newer": "ran"})


class SlowPunctuation(FakeEngine):
    def punctuate(self, history, message, pause=lambda: None):
        for _ in range(10):
            pause()
            time.sleep(STEP)
        return {"available": True, "text": " ".join(message).capitalize() + "?", "end": "?"}


class Http(unittest.TestCase):
    def test_the_newest_punctuation_request_wins_over_http(self):
        box, ready = {}, threading.Event()
        threading.Thread(target=serve, args=(SlowPunctuation(), "127.0.0.1", 18768),
                         kwargs={"ready": lambda server: (box.setdefault("server", server), ready.set())}, daemon=True).start()
        ready.wait(5)
        answers = {}

        def ask(name, words):
            req = Request("http://127.0.0.1:18768/api/v1/punctuate", data=json.dumps({"id": name, "message": words}).encode(),
                          headers={"Content-Type": "application/json"})
            t0 = time.perf_counter()
            with urlopen(req, timeout=10) as res:
                answers[name] = (json.loads(res.read()), time.perf_counter() - t0)

        old = threading.Thread(target=ask, args=("old", ["hello", "what", "is", "your"]))
        old.start()
        time.sleep(STEP * 3)
        new = threading.Thread(target=ask, args=("new", ["hello", "what", "is", "your", "name"]))
        new.start()
        old.join()
        new.join()
        box["server"].shutdown()
        box["server"].server_close()
        self.assertEqual(answers["old"][0], {"id": "old", "available": False, "superseded": True, "text": "", "end": "", "ms": answers["old"][0]["ms"]})
        self.assertEqual(answers["new"][0]["text"], "Hello what is your name?")
        self.assertLess(answers["new"][1], STEP * 10 + 0.25, "the new message did not wait for the old one to finish")


@unittest.skipUnless(LIVE, "live engine: PREDICT_TESTS=live")
class LiveEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from server import load
        cls.engine = load()
        if not cls.engine.punctuate([], ["are", "you", "okay"])["available"]:
            raise unittest.SkipTest("punctuation needs the torch rescorer")

    def test_predictions_between_steps_do_not_change_the_punctuation(self):
        history = [["partner", "Do you want to go outside for a bit? It is sunny."]]
        message = ["yes", "but", "can", "we", "wait", "until", "after", "lunch", "is", "that", "okay"]
        alone = self.engine.punctuate(history, message)["text"]
        other = [["partner", "What would you like for dinner tonight?"], ["user", "something warm"]]
        calls = []

        def pause():
            # A prediction for another conversation re-runs the rescorer's shared prompt cache.
            calls.append(self.engine.predict(other, ["i", "would", "like"], "3"[: len(calls) % 2]))

        interrupted = self.engine.punctuate(history, message, pause)["text"]
        # Since audit L4 only the gaps where a mark is plausible are scored, so there are fewer steps to pause at.
        self.assertGreater(len(calls), 2)
        self.assertEqual(interrupted, alone)


if __name__ == "__main__":
    unittest.main()
