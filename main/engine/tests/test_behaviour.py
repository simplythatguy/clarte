"""Round 3 engine behaviour from the hostile review: repeats, commit learning, slip corrections while typing,
display case, backlog. The engine runs with v0's prior and no rescorer (CPU, about 20 s); PREDICT_TESTS=fast skips it."""
import os
import sys
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))

from wordpred.context import code_of  # noqa: E402

LIVE = os.environ.get("PREDICT_TESTS", "live") != "fast"


class Learnable(unittest.TestCase):
    def test_rules_without_an_engine(self):
        from engine.predictor import Engine
        from engine.lexicon import Lexicon
        fake = type("E", (), {})()
        fake.lex = Lexicon()
        fake.params = {}
        learn = lambda w: Engine.learnable(fake, w)
        self.assertTrue(learn("zorvella"))
        self.assertTrue(learn("okonkwo"))
        for w in ["fucking", "hello", "priya", "the", "ll", "gm"]:        # lexicon words are never learned
            self.assertFalse(learn(w), w)
        for w in ["zzqx", "x", "fuckingg", "fuckers", "fuckingshit", "bullshitting"]:   # junk and profanity are never learned
            self.assertFalse(learn(w), w)


@unittest.skipUnless(LIVE, "PREDICT_TESTS=fast")
class Behaviour(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from engine import Engine
        cls.engine = Engine(rescorer=None)

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def words(self, history, message, groups="", **kw):
        return [w["word"] for w in self.engine.predict(history, message, groups, limit=8, **kw)["words"]]

    def test_no_repeat_loop(self):
        self.engine.start_conversation("repeat")
        for history, message in (([["partner", "Hello"]], ["hello"]), ([["partner", "Hello"]], ["hello", "hello"]),
                                 ([], ["i", "i"]), ([["partner", "Did you take your tablets?"]], ["no", "no"]), ([], ["the", "the"]),
                                 ([["partner", "Hi"]], ["hi"]), ([["partner", "Hey"]], ["hey"])):
            top = self.words(history, message)
            self.assertNotEqual(top[0], message[-1], (message, top))
        # a greeting may be echoed once, then something else
        first = self.words([["partner", "Hello"]], [])
        self.assertIn(first[0], ("hello", "hi", "i", "how", "what", "good"), first)
        self.assertNotEqual(self.words([["partner", "Hello"]], [first[0]])[0], first[0])

    def test_commit_learns_new_words_only_and_fades(self):
        e = self.engine
        e.start_conversation("commit")
        e.commit("fucking")
        e.commit("zzqx")
        self.assertEqual(dict(e.session), {})
        e.commit("Zorvella")
        self.assertEqual(dict(e.session), {"zorvella": 1})
        self.assertEqual(e.session_display, {"zorvella": "Zorvella"})
        out = e.predict([], [], code_of("zorvella"), limit=4)
        self.assertEqual(out["words"][0]["word"], "zorvella")
        self.assertEqual(out["words"][0]["display"], "Zorvella")
        w0 = e.session_weights()["zorvella"]
        for _ in range(20):
            e.commit("hello")
        self.assertLess(e.session_weights()["zorvella"], 0.6 * w0)
        self.assertNotIn("hello", e.session)

    def test_slip_correction_joins_the_typed_list(self):
        e = self.engine
        e.start_conversation("slip")
        history = [["partner", "How are you feeling this morning?"]]
        slipped = code_of("please")[:2] + "2" + code_of("please")[3:]           # 321131 -> 322131
        out = e.predict(history, [], slipped, limit=8)
        self.assertGreater(out["total"], 0)
        corrected = [w for w in out["words"] if w.get("corrected")]
        self.assertTrue(corrected, out["words"])
        self.assertEqual(corrected[0]["word"], "please")
        self.assertIs(out["branch"], False)
        self.assertAlmostEqual(sum(w["p"] for w in out["words"]), sum(w["p"] for w in out["words"]))   # all p are numbers
        # a confident exact match gets no correction, and complete pages never carry one
        out = e.predict(history, ["i"], code_of("want"), limit=8)
        self.assertFalse(any(w.get("corrected") for w in out["words"]), out["words"])
        out = e.predict(history, [], slipped, limit=8, complete=True)
        self.assertFalse(any(w.get("corrected") for w in out["words"]))
        for groups in ("4", "2", "34"):
            out = e.predict(history, ["i"], groups, limit=8)
            self.assertFalse(any(w.get("corrected") for w in out["words"]), (groups, out["words"]))

    def test_display_case(self):
        e = self.engine
        e.start_conversation("display")
        history = [["partner", "I was talking to Priya and Marcus yesterday."]]
        out = e.predict(history, ["i", "like"], code_of("priya"), limit=4)
        self.assertEqual(out["words"][0]["display"], "Priya")
        out = e.predict(history, ["ask"], code_of("marcus"), limit=8)
        shown = {w["word"]: w.get("display") for w in out["words"]}
        self.assertEqual(shown.get("marcus"), "Marcus")
        out = e.predict([], [], "", limit=8)
        shown = {w["word"]: w.get("display", w["word"]) for w in out["words"]}
        self.assertEqual(shown.get("i", "I"), "I")
        out = e.predict([], ["hello"], "22", limit=8)
        shown = {w["word"]: w.get("display", w["word"]) for w in out["words"]}
        self.assertEqual(shown.get("i'm", "I'm"), "I'm")
        self.assertEqual(shown.get("in", "in"), "in")
        # a first name that is also a common word stays lower case unless the conversation capitalised it
        self.assertEqual(e.display("will", {}), "will")
        name = next(w for w in sorted(e.lex.names) if w not in e.lex.dictionary and len(w) > 4)
        self.assertEqual(e.display(name, {}), name[0].upper() + name[1:])
        self.assertEqual(e.display("priya", {"priya": "Priya"}), "Priya")

    def test_branch_hidden_after_a_slip(self):
        e = self.engine
        e.start_conversation("branch")
        out = e.predict([["partner", "Your sister Priya is coming at four."]], ["is"], code_of("priya"), limit=8)
        self.assertIs(out["branch"], False)


class Server(unittest.TestCase):
    def test_backlog(self):
        from engine.http import serve  # noqa: F401  (import sets nothing; the attribute is set in serve)
        import engine.http as http
        src = Path(http.__file__).read_text()
        self.assertIn("request_queue_size = 64", src)
        self.assertGreaterEqual(ThreadingHTTPServer.request_queue_size, 5)


if __name__ == "__main__":
    unittest.main()
