"""Unit tests for the pure parts: cost policies, pointer-cache weights, name cue, lexicon index."""
import sys
import unittest
from collections import Counter
from pathlib import Path

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1 / "bench"))
sys.path.insert(0, str(V1.parent / "v0"))

import harness  # noqa: E402
from engine.cache import context_weights, name_like  # noqa: E402
from engine.lexicon import Lexicon  # noqa: E402
from wordpred.context import code_of  # noqa: E402


class Costs(unittest.TestCase):
    def test_ui_policy(self):
        # 4-letter word; k=0 only top-1 counts, k>=1 top-2 counts
        self.assertEqual(harness.ui_cost([0, 5, 5, 5, 0], 0), 1)
        self.assertEqual(harness.ui_cost([1, 5, 5, 5, 0], 0), 5)          # top-2 at k=0 does not count
        self.assertEqual(harness.ui_cost([3, 1, 5, 5, 0], 0), 2)
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, 0], 0), 5)          # full code, first page
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, 1], 1), 5)
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, 2], 2), 6)          # second page
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, None], 19), 4 + 9 + 1)
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, None], 20), harness.fallback(4))   # 11th page: spell
        self.assertEqual(harness.ui_cost([3, 4, 4, 4, None], None), 2 * 4 + 5)

    def test_ghost_policy_matches_frozen_definition(self):
        self.assertEqual(harness.ghost_costs([0, 1, 1, 1, 0]), {"full": 4 + 1 + 0 + 1, "ghost": 2})
        self.assertEqual(harness.ghost_costs([5, 5, 5, 5, 7]), {"full": 4 + 1 + 1 + 1, "ghost": 7})
        self.assertEqual(harness.ghost_costs([None, None, None, None, None]), {"full": 13, "ghost": 13})

    def test_conv_limit(self):
        self.assertEqual(harness.conv_limit("60", "aac_dev"), 60)
        self.assertEqual(harness.conv_limit("aac_dev=120,dd_dev=30", "dd_dev"), 30)
        self.assertIsNone(harness.conv_limit(None, "dd_dev"))


class Cache(unittest.TestCase):
    def test_possessive_stem_and_recency(self):
        w = context_weights([("partner", "That's Nkechi's coat."), ("user", "ok")], [], Counter(), decay=0.5)
        self.assertIn("nkechi", w)
        self.assertIn("nkechi's", w)
        self.assertGreater(w["nkechi"], 0)
        # the older partner turn decays
        older = context_weights([("partner", "coat"), ("partner", "hat")], [], Counter(), decay=0.5)
        self.assertAlmostEqual(older["coat"], 0.5 * older["hat"])

    def test_idf_damping_and_session(self):
        uni = {"the": 0.05, "restaurant": 2e-5}.get
        w = context_weights([("partner", "the restaurant")], [], Counter({"priya": 2}), unigram=lambda x: uni(x, 0.0),
                            idf_floor=2e-4, session_weight=0.3, name_boost=1.0)
        self.assertLess(w["the"], w["restaurant"])
        self.assertAlmostEqual(w["priya"], 0.6)

    def test_name_cue(self):
        self.assertEqual(name_like("I met Jev at the shop. Priya called."), {"jev"})     # Priya starts a sentence
        self.assertEqual(name_like("OKONKWO is here"), set())                            # all caps is not the cue
        self.assertEqual(name_like("Would you like tea or coffee?"), set())
        w1 = context_weights([("partner", "I met jev today")], [], Counter(), name_boost=2.0)
        w2 = context_weights([("partner", "I met Jev today")], [], Counter(), name_boost=2.0)
        self.assertAlmostEqual(w2["jev"], 2 * w1["jev"])

    def test_sentence_initial_name_needs_a_known_name(self):
        text = "Marcus and Priya both called. Yesterday was fine."
        self.assertEqual(name_like(text), {"priya"})
        known = lambda w: w in {"marcus", "priya"}
        self.assertEqual(name_like(text, known=known), {"marcus", "priya"})      # "Yesterday" is not a name

    def test_branch_rule(self):
        from types import SimpleNamespace
        from engine.predictor import Engine
        import numpy as np
        rule = SimpleNamespace(params={"branch_min_k": 2, "branch_ratio": 0.3, "branch_complete": 1, "branch_p0_min": 0.0})
        br = lambda groups, p, n: Engine.branch(rule, groups, np.array(p), np.array(n))
        self.assertFalse(br("", [0.5, 0.4], [2, 2]))                 # never for the next word
        self.assertFalse(br("3", [0.5, 0.4], [1, 1]))                # below min_k
        self.assertTrue(br("34", [0.5, 0.2], [3, 2]))                # ratio 0.4 >= 0.3, words[1] complete
        self.assertFalse(br("34", [0.5, 0.1], [3, 2]))               # ratio 0.2 < 0.3
        self.assertFalse(br("34", [0.5, 0.4], [2, 3]))               # words[1] not complete
        rule.params["branch_complete"] = 2
        self.assertFalse(br("34", [0.5, 0.4], [3, 2]))               # both must be complete
        rule.params["branch_complete"] = 0
        self.assertTrue(br("34", [0.5, 0.4], [3, 5]))
        self.assertFalse(br("34", [0.5], [2]))                       # one candidate only
        rule.params["branch_p0_min"] = 0.6
        self.assertFalse(br("34", [0.5, 0.4], [3, 5]))               # best word too unlikely: a probable slip

    def test_shipped_branch_rule_wants_two_whole_likely_words(self):
        from types import SimpleNamespace
        from engine.predictor import DEFAULTS, Engine
        import numpy as np
        rule = SimpleNamespace(params=DEFAULTS)
        br = lambda groups, p, n: Engine.branch(rule, groups, np.array(p), np.array(n))
        self.assertFalse(br("3321", [0.76, 0.15], [9, 4]))           # Somewhere (incomplete) / Something: round 2 branched here
        self.assertFalse(br("3324", [1.0, 0.001], [4, 7]))           # Priya / Private after a slip
        self.assertTrue(br("22", [0.5, 0.3], [2, 2]))                # in / hi: both whole words, both likely
        self.assertFalse(br("22", [0.15, 0.1], [2, 2]))              # best word unlikely

    def test_display_forms(self):
        from engine.cache import display_forms
        forms = display_forms([("partner", "I met Jev at the shop. Priya called. Yesterday was fine.")], known=lambda w: w in {"priya"})
        self.assertEqual(forms, {"jev": "Jev", "priya": "Priya"})
        self.assertEqual(display_forms([("partner", "Hello there")]), {})

    def test_unicode_apostrophe(self):
        w = context_weights([("partner", "I don’t think you’ve met Jev’s brother.")], [], Counter())
        self.assertIn("don't", w)
        self.assertIn("jev", w)


class Lex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = Lexicon()

    def test_size_and_probes(self):
        self.assertGreater(len(self.lex), 100_000)
        for w in ["xylophone", "quixotic", "antidisestablishmentarianism", "running", "children", "was", "don't",
                  "i'm", "you're", "can't", "y'all", "priya", "london", "tuesday", "wheelchair", "instagram"]:
            self.assertIn(w, self.lex.index, w)
        for junk in ["xxxxxxxxxx", "xxiv"]:
            self.assertFalse(junk in self.lex.index, junk)

    def test_prefix_index(self):
        idx = self.lex.matching(code_of("xylophone"))
        self.assertIn(self.lex.index["xylophone"], idx)
        for i in self.lex.matching("3134")[:200]:
            self.assertTrue(self.lex.codes[i].startswith("3134"))
        self.assertEqual(len(self.lex.matching("")), len(self.lex))
        self.assertEqual(len(self.lex.matching("1" * 40)), 0)


if __name__ == "__main__":
    unittest.main()
