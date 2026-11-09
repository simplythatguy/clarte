"""Contract tests: validation and paging with a fake engine (fast), then the live engine over HTTP.

Run:  .venv/bin/python -m unittest discover -s tests -v
Set PREDICT_TESTS=fast to skip the live-engine tests (about one minute of model loading).
"""
import json
import os
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))

from engine.http import clean_request, serve  # noqa: E402
from wordpred.context import code_of  # noqa: E402

LIVE = os.environ.get("PREDICT_TESTS", "live") != "fast"


class FakeEngine:
    model, rescorer_name = "fake", "none"
    lex = ["a", "b", "c"]

    def __init__(self):
        self.commits = []

    def predict(self, history, message, groups, limit, offset, complete=False):
        words = [{"word": w, "p": 0.5, "complete": True} for w in ("out", "so")][offset:offset + limit]
        return {"groups": groups, "words": words, "total": 2, "longer": 0.0, "branch": bool(groups), "complete_flag": complete}

    def predict_v0(self, history, message, groups):
        return {"likely": ["out"], "choose": ["out"], "short": ["out"], "ghost": "out", "candidates": ["out"]}

    def commit(self, word, history, message):
        self.commits.append(word)


def start(engine, port):
    ready = threading.Event()
    holder = {}

    def on_ready(server):
        holder["server"] = server
        ready.set()
    t = threading.Thread(target=serve, args=(engine, "127.0.0.1", port, None, on_ready), daemon=True)
    t.start()
    ready.wait(5)
    return holder["server"]


def post(port, path, body, raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    req = Request(f"http://127.0.0.1:{port}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class Validation(unittest.TestCase):
    def test_defaults(self):
        r = clean_request({})
        self.assertEqual((r["history"], r["message"], r["groups"], r["limit"], r["offset"], r["id"]), ([], [], "", 8, 0, None))
        self.assertFalse(r["complete"])
        self.assertTrue(clean_request({"complete": True})["complete"])
        self.assertFalse(clean_request({"complete": None})["complete"])
        for bad in ("yes", 1, [True]):
            with self.assertRaises(ValueError):
                clean_request({"complete": bad})

    def test_rejects(self):
        for bad in ([], {"history": "x"}, {"history": [["bob", "hi"]]}, {"message": "hi"}, {"groups": "5"},
                    {"groups": "1" * 129}, {"limit": 0}, {"limit": 65}, {"limit": "8"}, {"offset": -1}, {"id": 1.5}):
            with self.assertRaises(ValueError, msg=repr(bad)):
                clean_request(bad)

    def test_nulls_are_defaults(self):
        r = clean_request({"history": None, "message": None, "groups": None, "id": "abc"})
        self.assertEqual((r["history"], r["message"], r["groups"], r["id"]), ([], [], "", "abc"))


class FakeHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = FakeEngine()
        cls.port = 18765
        cls.server = start(cls.engine, cls.port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_predict_echoes_id_and_pages(self):
        status, body = post(self.port, "/api/v1/predict", {"id": 17, "groups": "34", "limit": 1, "offset": 1})
        self.assertEqual(status, 200)
        self.assertEqual(body["id"], 17)
        self.assertEqual([w["word"] for w in body["words"]], ["so"])
        self.assertIn("ms", body)
        self.assertIs(body["branch"], True)
        status, body = post(self.port, "/api/v1/predict", {"groups": "34", "complete": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["complete_flag"])
        self.assertEqual(post(self.port, "/api/v1/predict", {"groups": "34", "complete": "yes"})[0], 400)

    def test_bad_json_and_bad_fields(self):
        self.assertEqual(post(self.port, "/api/v1/predict", None, raw=b"{nope")[0], 400)
        self.assertEqual(post(self.port, "/api/v1/predict", {"groups": "9"})[0], 400)
        self.assertEqual(post(self.port, "/api/v1/predict", None, raw=b"\xff\xfe")[0], 400)

    def test_commit(self):
        status, body = post(self.port, "/api/v1/commit", {"word": "priya", "history": [], "message": []})
        self.assertEqual((status, body["ok"]), (200, True))
        self.assertEqual(self.engine.commits, ["priya"])
        self.assertEqual(post(self.port, "/api/v1/commit", {"word": ""})[0], 400)

    def test_v0_shape_and_health(self):
        status, body = post(self.port, "/api/predict", {"groups": "3"})
        self.assertEqual(status, 200)
        self.assertEqual(set(body) - {"ms"}, {"likely", "choose", "short", "ghost", "candidates"})
        with urlopen(f"http://127.0.0.1:{self.port}/api/v1/health") as r:
            self.assertEqual(json.loads(r.read())["ok"], True)
        with urlopen(f"http://127.0.0.1:{self.port}/") as r:
            self.assertEqual(r.status, 200)


@unittest.skipUnless(LIVE, "PREDICT_TESTS=fast")
class LiveEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(V1))
        from server import load
        cls.engine = load()
        cls.port = 18766
        cls.server = start(cls.engine, cls.port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.engine.close()

    def predict(self, **body):
        status, out = post(self.port, "/api/v1/predict", body)
        self.assertEqual(status, 200, out)
        return out

    def test_prefix_rule_no_duplicates_and_complete_flag(self):
        for groups in ("", "3", "34", "1324", "4423"):
            out = self.predict(groups=groups, limit=64, history=[["partner", "Did you sleep at all?"]], message=["i"])
            words = [w["word"] for w in out["words"]]
            self.assertEqual(len(words), len(set(words)))
            for w in out["words"]:
                self.assertTrue(code_of(w["word"]).startswith(groups), (groups, w))
                self.assertEqual(w["complete"], len(code_of(w["word"])) == len(groups))
                self.assertEqual(w["word"], w["word"].lower())
            self.assertGreater(out["total"], 0)
            self.assertTrue(0 <= out["longer"] <= 1.0001)

    def test_paging_reaches_every_match_and_probabilities_sum_to_one(self):
        first = self.predict(groups="4423", limit=64)
        seen, total_p, offset = [], 0.0, 0
        while offset < first["total"]:
            page = self.predict(groups="4423", limit=64, offset=offset)
            # round 3: the first page may carry extra `corrected` words (a probable slip); p is renormalised with them
            seen += [w["word"] for w in page["words"] if not w.get("corrected")]
            total_p += sum(w["p"] for w in page["words"])
            offset += 64
        self.assertEqual(len(seen), first["total"])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertAlmostEqual(total_p, 1.0, places=2)
        self.assertIn("xylophone", seen)

    def test_offset_past_end_still_returns_a_word(self):
        out = self.predict(groups="4423", offset=10_000_000)
        self.assertGreater(out["total"], 0)
        self.assertEqual(len(out["words"]), 1)

    def test_complete_lists_only_whole_words_and_pages_them_all(self):
        full = self.predict(groups="4423", limit=64)
        comp = self.predict(groups="4423", limit=64, complete=True)
        self.assertLess(comp["total"], full["total"])
        seen, total_p, offset = [], 0.0, 0
        while offset < comp["total"]:
            page = self.predict(groups="4423", limit=64, offset=offset, complete=True)
            for w in page["words"]:
                self.assertTrue(w["complete"], w)
                self.assertEqual(code_of(w["word"]), "4423")
            seen += [w["word"] for w in page["words"]]
            total_p += sum(w["p"] for w in page["words"])
            offset += 64
        self.assertEqual(len(seen), comp["total"])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertAlmostEqual(total_p, 1.0, places=2)
        self.assertEqual(full["longer"], comp["longer"])          # longer is about the whole match set

    def test_branch_is_a_bool_and_never_set_for_next_word(self):
        self.assertIs(self.predict(groups="")["branch"], False)
        self.assertIn(self.predict(groups="34")["branch"], (True, False))

    def test_no_match_is_empty_or_corrected(self):
        out = self.predict(groups="1" * 128)
        self.assertEqual(out["total"], 0)
        for w in out["words"]:
            self.assertTrue(w.get("corrected"))

    def test_context_name_and_commit_learning(self):
        out = self.predict(history=[["partner", "I was talking to Okonkwo yesterday."]], message=["i", "like"], groups=code_of("okonkwo"))
        self.assertEqual(out["words"][0]["word"], "okonkwo")
        status, _ = post(self.port, "/api/v1/commit", {"word": "Zorvella", "history": [], "message": []})
        self.assertEqual(status, 200)
        out = self.predict(groups=code_of("zorvella"))
        self.assertIn("zorvella", [w["word"] for w in out["words"][:2]])

    def test_long_and_odd_input(self):
        history = [["partner", "Hello THERE, how are you?!"], ["user", "fine ’ thanks"]] * 50
        out = self.predict(history=history, message=["word"] * 60, groups="21")
        self.assertGreater(out["total"], 0)
        out = self.predict(history=[["partner", "😀 ¿Qué? 123 ---"]], message=["", "  ", "don’t"], groups="")
        self.assertGreater(len(out["words"]), 0)

    def test_concurrent_requests(self):
        bodies = [{"id": i, "groups": g, "history": [["partner", f"Topic {i} is dinner"]], "message": ["i"]}
                  for i, g in enumerate(["", "3", "31", "4", "12", "2", "34", "1"] * 3)]
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda b: post(self.port, "/api/v1/predict", b), bodies))
        for b, (status, out) in zip(bodies, results):
            self.assertEqual(status, 200)
            self.assertEqual(out["id"], b["id"])
            self.assertEqual(out["groups"], b["groups"])
            self.assertTrue(all(code_of(w["word"]).startswith(b["groups"]) for w in out["words"]))

    def test_tiers_over_http_with_the_live_rescorer(self):
        # Round 3: the measured demo defects (message ["i"], no history) must not come back, with the real rescorer
        lex = self.engine.lex
        tier = lambda w: int(lex.tier[lex.index[w]]) if w in lex.index else 1
        for code, junk in (("22", {"ll", "im", "gm", "nj", "mn", "lg", "ig", "jj"}), ("1324", {"dont", "arn't", "arnt", "ariz", "conv", "boku"}),
                           ("421", {"thc", "tlc", "tna", "tha", "vic", "tib", "und"}), ("424", {"thx", "tnt", "tmz", "thu"}),
                           ("2", set("ghjklmn")), ("3323", {"psg's", "rpgs"})):
            for complete in (False, True):
                out = self.predict(groups=code, limit=8, message=["i"], complete=complete)
                words = [w["word"] for w in out["words"] if not w.get("corrected")]
                tiers = [tier(w) for w in words]
                self.assertEqual(tiers, sorted(tiers), (code, complete, words))
                idx = lex.matching(code)
                if complete:
                    idx = idx[lex.lengths[idx] == len(code)]
                available = int((lex.tier[idx] == 1).sum())
                # junk only once the tier-1 words of the code are exhausted (424 has four complete tier-1 words)
                self.assertEqual(sum(t == 1 for t in tiers), min(8, available), (code, complete, words))
                self.assertFalse(set(words[:min(8, available)]) & junk, (code, complete, words))
        for w, message in (("i'm", []), ("don't", ["i"]), ("the", ["i", "want"]), ("in", ["i", "am"]), ("why", ["i", "wonder"])):
            page = [x["word"] for x in self.predict(groups=code_of(w), limit=4, message=message, complete=True)["words"]]
            self.assertIn(w, page, (w, page))
        # real short words in context (the review's acceptance list): typed top 3 with the live rescorer
        for message, w in ((["i", "need", "a"], "nap"), (["it's", "3"], "pm")):
            top = [x["word"] for x in self.predict(groups=code_of(w), limit=8, message=message)["words"]]
            self.assertIn(w, top[:3], (message, w, top))
        # "i'd like a" + 242: the model prefers hug, huge, lunch, juice (all real words); mug is a tier-1 word on the chooser
        page = [x["word"] for x in self.predict(groups=code_of("mug"), limit=8, message=["i'd", "like", "a"], complete=True)["words"]]
        self.assertIn("mug", page, page)
        top = [x["word"] for x in self.predict(groups=code_of("hmm"), limit=8, history=[["partner", "Shall we go out later?"]], message=[])["words"]]
        self.assertIn("hmm", top, top)

    def test_review_behaviour_with_the_live_rescorer(self):
        # repeats: accepting Q1 five times after "Hello" must not give "hello hello hello hello hello"
        message = []
        for _ in range(5):
            out = self.predict(history=[["partner", "Hello"]], message=message, groups="")
            message.append(out["words"][0]["word"])
        self.assertLess(max(message.count(w) for w in set(message)), 3, message)
        for message in (["i", "i"], ["no", "no"], ["the", "the"]):
            top = self.predict(history=[["partner", "Did you take your tablets?"]], message=message, groups="")["words"][0]["word"]
            self.assertNotEqual(top, message[-1], (message, top))
        # commit learns new words only
        post(self.port, "/api/v1/commit", {"word": "fucking", "history": [], "message": []})
        top = [x["word"] for x in self.predict(history=[["partner", "How are you?"]], message=["i", "am"], groups="14")["words"]]
        self.assertNotIn("fucking", top[:6], top)
        # slip: "please" typed with one wrong group is offered, marked
        slipped = "322131"
        out = self.predict(history=[["partner", "How are you feeling this morning?"]], message=[], groups=slipped)
        self.assertIn("please", [w["word"] for w in out["words"] if w.get("corrected")], out["words"])
        self.assertIs(out["branch"], False)
        # display case
        out = self.predict(history=[["partner", "Your sister Priya is coming at four."]], message=["is"], groups=code_of("priya"))
        self.assertEqual(out["words"][0]["display"], "Priya")
        self.assertIs(out["branch"], False)

    def test_v0_compatible_endpoint(self):
        status, out = post(self.port, "/api/predict", {"history": [["partner", "Do you want to go outside?"]],
                                                       "message": ["i", "would", "love", "to", "go"], "groups": "3443"})
        self.assertEqual(status, 200)
        self.assertEqual(out["likely"][0], "outside")
        self.assertEqual(out["ghost"], "outside")


if __name__ == "__main__":
    unittest.main()
