"""Round 3: word tiers. Pure rules (build_lexicon), the built file, and the engine's ordering without a rescorer.

The engine tests load v0's prior on the CPU (about 20 s) and are skipped with PREDICT_TESTS=fast.
"""
import os
import sys
import unittest
from pathlib import Path

import numpy as np

V1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1.parent / "v0"))

import build_lexicon as bl  # noqa: E402
from engine.lexicon import Lexicon  # noqa: E402
from wordpred.context import code_of  # noqa: E402

LIVE = os.environ.get("PREDICT_TESTS", "live") != "fast"

# Measured on the round-2 finalist (first chooser page or top 8 while typing, message ["i"], no history).
DEFECTS = "ll gm nj mn lg ig jj arnt ariz conv boku thc tlc tna tha vic tib tnt tmz thu psg's rpgs thx ur wat une und ve ii".split()
DROPPED = "im dont ive arn't thats didnt hows wheres youre aint theyre n't spose".split()
COMMON = ("i'm don't the in why hi ok okay yeah hey gonna wanna hello please water tired sick tea head bathroom now won't can't cant wont a i "
          "nap mug tub hmm mrs pm nah yep yup nope dunno gotta kinda lemme gimme ya um uh huh wow ouch oops ugh lol omg idk btw mr dr ms tv meds "
          "cuz brit thy li vie did mix my so an at as let met restroom toothpaste wheelchair teriyaki london sarah").split()


def common_codes(lex, n=200):
    """The n most common group codes: every prefix of the most frequent words, in frequency order."""
    out = []
    seen = set()
    for i in np.argsort(-lex.freq, kind="stable"):
        code = lex.codes[i]
        for k in range(1, len(code) + 1):
            if code[:k] not in seen:
                seen.add(code[:k])
                out.append(code[:k])
                if len(out) == n:
                    return out
    return out


class Rules(unittest.TestCase):
    """The tier function on literal dictionary entries (no DictionaryServices needed here)."""
    web2 = {"the", "cat", "slipper", "snack", "allergy", "accompany", "microwave", "brit", "xylophone"}
    ENTRIES = {
        "nap": "nap 1 | nap | verb (naps) (, napping) sleep lightly", "hmm": "hmm | (h)m | exclamation used to express reflection",
        "mrs": "Mrs. | ˈmisiz | noun a title used before a surname", "pm": "p.m. | ˌpēˈem | abbreviation after noon",
        "ok": "OK 1 | ˌōˈkā | (okay | ˈˌōˈkā |) informal exclamation used to express assent", "okay": "OK 1 | ˌōˈkā | (okay | ˈˌōˈkā |) informal exclamation",
        "gm": "gm abbreviation gram(s). ", "nj": "NJ | ˌenˈjā | abbreviation New Jersey", "thx": "thx (also tx) abbreviation informal thanks",
        "idk": "IDK abbreviation informal I don't know", "tv": "TV 1 | ˌtēˈvē | noun 1 television", "thc": "THC | ˌtē ˌāCH ˈsē | noun a crystalline compound",
        "mn": "Mn symbol the chemical element manganese", "ur": "ur- | o͝or | combining form primitive", "im": "im- | im | prefix variant spelling of in-",
        "dont": "don't | dōnt | contraction do not", "aint": "ain't | ānt | informal contraction am not", "cant": "cant 1 | kant | noun 1 hypocritical talk",
        "wont": "wont | wônt | (one's wont) noun formal one's customary behavior", "lets": "let 1 | let | verb (lets) (, letting) 1 not prevent",
        "slippers": "slipper slip·per | ˈslipər | noun a comfortable slip-on shoe", "accompanied": "accompany ac·com·pa·ny | əˈkəmp(ə)nē | verb (accompanies, accompanying, accompanied)",
        "imma": "I'ma I'·ma | ˈīmə | (also Ima, Imma) contraction US English informal I'm going to", "adoptable": "adopt a·dopt | əˈdäpt | verb [with object] 1 legally take (another's child)",
        "rattail": "rat-tail | ˈratˌtāl | noun 1 (also rat's tail) a narrow hairless tail", "at": "at- | at | prefix variant spelling of ad-",
        "let": "-let | lit | suffix forming nouns", "my": "my- | mī | combining form variant spelling of myo-", "zzzz": "Z 1 | zē | (also z) noun the twenty-sixth letter",
        "cuz": "cuz 1 | kəz | (also 'cuz) conjunction informal because", "wat": "wat | wät | noun a Buddhist monastery", "london": "London Lon·don | ˈləndən | 1 the capital of the United Kingdom",
        "meds": "med. abbreviation medium. ", "spose": "s'pose | spōz | verb informal nonstandard spelling of suppose",
    }

    def tier(self, w, zipf, corpus=0):
        text = self.ENTRIES.get(w)
        return bl.tier_of(w, zipf, bl.parse_entry(text) if text else None, self.web2, corpus)

    def test_parse_entry(self):
        e = bl.parse_entry(self.ENTRIES["mrs"])
        self.assertEqual((e["main"], e["pos"], e["caps"], e["affix"]), ("mrs", "noun", False, False))
        e = bl.parse_entry(self.ENTRIES["ok"])
        self.assertEqual((e["pos"], e["caps"], e["informal"]), ("exclamation", True, True))
        self.assertIn("okay", e["heads"])
        self.assertTrue(bl.parse_entry(self.ENTRIES["ur"])["affix"])
        self.assertTrue(bl.parse_entry(self.ENTRIES["let"])["affix"])
        self.assertEqual(bl.parse_entry(self.ENTRIES["gm"])["pos"], "abbreviation")
        self.assertIn("imma", bl.parse_entry(self.ENTRIES["imma"])["heads"])
        self.assertNotIn("another's", bl.parse_entry(self.ENTRIES["adoptable"])["heads"])
        self.assertEqual(bl.parse_entry(self.ENTRIES["rattail"])["main"], "rattail")

    def test_dictionary_words(self):
        for w in ["nap", "hmm", "mrs", "pm", "ok", "okay", "tv", "cant", "wont", "lets", "slippers", "accompanied", "imma", "adoptable", "rattail", "london"]:
            self.assertTrue(bl.dictionary_word(w, bl.parse_entry(self.ENTRIES[w])), w)
        for w in ["dont", "aint", "zzzz", "ur", "im", "at", "spose", "meds"]:      # meds is not a form of the abbreviation med.
            self.assertFalse(bl.dictionary_word(w, bl.parse_entry(self.ENTRIES[w])), w)
        self.assertFalse(bl.dictionary_word("hows", bl.parse_entry("how 1 | hou | adverb in what way")))

    def test_apostrophes(self):
        self.assertEqual(bl.apostrophe_kind("don't"), "curated")
        self.assertEqual(bl.apostrophe_kind("who've"), "contraction")
        self.assertEqual(bl.apostrophe_kind("arn't"), "misspelled")
        self.assertEqual(bl.apostrophe_kind("your're"), "misspelled")
        self.assertEqual(bl.apostrophe_kind("son's"), "possessive")
        self.assertEqual(bl.apostrophe_kind("o'brien"), "other")
        self.assertEqual(self.tier("arn't", 1.8), 0)
        self.assertEqual(self.tier("who've", 2.5), 1)
        self.assertEqual(self.tier("o'brien", 4.0), 2)
        stem_tier = {"son": 1, "psg": None}.get
        self.assertEqual(bl.tier_of("son's", 4.0, None, self.web2, stem_tier=stem_tier), 1)
        self.assertEqual(bl.tier_of("psg's", 2.2, None, self.web2, stem_tier=stem_tier), 2)

    def test_bare_contractions_and_misspellings_are_dropped(self):
        self.assertEqual(self.tier("dont", 4.7), 0)        # the dictionary knows it only as don't
        self.assertEqual(self.tier("aint", 3.3), 0)
        self.assertEqual(self.tier("spose", 2.5), 0)
        self.assertEqual(self.tier("im", 4.7), 0)          # bare form of i'm; the dictionary has only the prefix im-
        self.assertEqual(self.tier("thats", 4.5), 0)       # bare form, no entry
        self.assertEqual(self.tier("cant", 4.3), 1)        # a word of its own, as are wont and lets
        self.assertEqual(self.tier("wont", 4.1), 1)
        self.assertEqual(self.tier("lets", 4.5), 1)

    def test_single_letters_abbreviations_and_acronyms(self):
        self.assertEqual(self.tier("a", 7.0), 1)
        self.assertEqual(self.tier("i", 7.0), 1)
        for w in "bcdefghjklmnopqrstuvwxyz":
            self.assertEqual(self.tier(w, 5.5), 3, w)
        self.assertEqual(self.tier("mrs", 4.89), 1)       # a noun, whatever its frequency
        self.assertEqual(self.tier("pm", 4.69), 1)        # abbreviation above 4.5
        self.assertEqual(self.tier("gm", 4.16), 2)        # abbreviation below 4.5
        self.assertEqual(self.tier("nj", 3.0), 2)
        self.assertEqual(self.tier("thx", 3.15), 2)       # informal abbreviation below 4.0
        self.assertEqual(self.tier("idk", 4.17), 1)       # informal abbreviation above 4.0
        self.assertEqual(self.tier("tv", 5.2), 1)         # acronym noun above 4.5
        self.assertEqual(self.tier("thc", 2.0), 2)        # acronym noun below 4.5
        self.assertEqual(self.tier("mn", 3.7), 2)         # chemical symbol
        self.assertEqual(self.tier("ok", 5.14), 1)
        self.assertEqual(self.tier("ll", 4.66), 2)        # no entry, two letters
        self.assertEqual(self.tier("ii", 5.0), 2)         # roman numeral

    def test_real_words_are_tier_1_whatever_their_frequency(self):
        for w, z in [("nap", 3.8), ("hmm", 4.1), ("cuz", 3.9), ("slippers", 3.4), ("accompanied", 2.5), ("london", 5.0), ("meds", 3.59), ("okay", 5.3)]:
            self.assertEqual(self.tier(w, z), 1, w)
        self.assertEqual(self.tier("wat", 3.44), 2)       # JUNK: a temple in the dictionary, "what" in the corpus

    def test_affix_entries_are_no_evidence(self):
        self.assertEqual(self.tier("at", 6.7, corpus=500), 1)      # the first entry is "at-"; the corpus attests the word
        self.assertEqual(self.tier("my", 6.6, corpus=500), 1)
        self.assertEqual(self.tier("let", 5.5, corpus=500), 1)
        self.assertEqual(self.tier("ur", 3.9, corpus=6), 2)       # below the corpus floor, two letters
        self.assertEqual(self.tier("ariz", 3.11), 2)              # no entry, four letters, below Zipf 3.5
        self.assertEqual(self.tier("boku", 2.6), 2)
        self.assertEqual(self.tier("brit", 3.6), 1)               # web2 fallback for four letters or more
        self.assertEqual(self.tier("xylophones", 2.0), 1)         # web2 by inflection stem
        self.assertEqual(self.tier("instagram", 4.1), 1)          # no dictionary, frequent enough


class BuiltFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = Lexicon()

    def test_tiers_present(self):
        t = self.lex.tier
        self.assertEqual(set(np.unique(t)), {1, 2, 3})
        self.assertGreater(int((t == 1).sum()), 60_000)
        self.assertEqual(sorted(self.lex.words[i] for i in np.flatnonzero(t == 3)), sorted(set("bcdefghjklmnopqrstuvwxyz")))
        self.assertEqual(t[self.lex.index["a"]], 1)
        self.assertEqual(t[self.lex.index["i"]], 1)

    def test_defects_are_not_common_words(self):
        for w in DEFECTS:
            i = self.lex.index.get(w)
            self.assertTrue(i is None or self.lex.tier[i] > 1, w)
        for w in DROPPED:
            self.assertFalse(w in self.lex.index, w)
        for w in COMMON:
            self.assertEqual(self.lex.tier[self.lex.index[w]], 1, w)

    def test_wiktionary_words_are_tier_2_and_reachable(self):
        """Round 4 (add_wiktionary.py): rare real words from Wiktionary join as tier 2, never above a common word."""
        self.assertGreater(len(self.lex), 800_000)
        for w in ("polyphiloprogenitive", "levothyroxine", "atorvastatin", "apricity", "doomscrolling", "situationship",
                  "otorhinolaryngologist", "floccinaucinihilipilification", "petrichor", "vellichor"):
            i = self.lex.index.get(w)
            self.assertIsNotNone(i, w)
            self.assertEqual(int(self.lex.tier[i]), 2, w)
            self.assertTrue(self.lex.added[i], w)
            self.assertIn(i, self.lex.matching(self.lex.codes[i]))
        self.assertFalse((self.lex.added & (self.lex.tier == 1)).any())
        for w in ("im", "dont", "thats", "ive", "youre"):
            self.assertNotIn(w, self.lex.index, w)

    def test_every_word_reachable_by_tier_order(self):
        # the paged list is the whole match set in tier order; nothing is filtered
        idx = self.lex.matching("22")
        self.assertIn(self.lex.index["ll"], idx)
        self.assertIn(self.lex.index["in"], idx)


@unittest.skipUnless(LIVE, "PREDICT_TESTS=fast")
class EngineOrder(unittest.TestCase):
    """The v1 prior and pointer cache without a rescorer: the tier rule is independent of the model."""
    @classmethod
    def setUpClass(cls):
        from engine import Engine
        cls.engine = Engine(rescorer=None)
        cls.lex = cls.engine.lex

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def tiers_of(self, words):
        return [int(self.lex.tier[self.lex.index[w]]) if w in self.lex.index else 1 for w in words]

    def test_demote_keeps_order_inside_a_tier_and_separates_tiers(self):
        p = np.array([0.5, 0.3, 0.1, 0.05, 0.05])
        tiers = np.array([2, 1, 3, 1, 2], dtype=np.int8)
        q = self.engine.demote(tiers, p)
        self.assertLess(q[tiers == 2].max(), q[tiers == 1].min())
        self.assertLess(q[tiers == 3].max(), q[tiers == 2].min())
        self.assertAlmostEqual(q[0] / q[4], p[0] / p[4])
        self.assertTrue((q[tiers == 1] == p[tiers == 1]).all())

    def check_page(self, code, shown, limit, complete):
        """No tier-2 word on the page unless the tier-1 words of that code are exhausted, and tier order on the page."""
        idx = self.lex.matching(code)
        if complete:
            idx = idx[self.lex.lengths[idx] == len(code)]
        tier1_available = int((self.lex.tier[idx] == 1).sum())
        tiers = self.tiers_of(shown)
        self.assertEqual(tiers, sorted(tiers), (code, shown))
        self.assertEqual(sum(t == 1 for t in tiers), min(limit, tier1_available), (code, shown))

    def test_common_codes_show_no_tier2_without_context(self):
        self.engine.start_conversation("tiers")
        codes = common_codes(self.lex, 200)
        self.assertEqual(len(codes), 200)
        for code in codes:
            page = [w["word"] for w in self.engine.predict([], [], code, limit=4, complete=True)["words"]]
            self.check_page(code, page, 4, complete=True)
            top = [w["word"] for w in self.engine.predict([], ["i"], code, limit=8)["words"] if not w.get("corrected")]
            self.check_page(code, top, 8, complete=False)

    def test_whole_list_is_in_tier_order_for_the_defect_codes(self):
        self.engine.start_conversation("tiers")
        for code in ("22", "1324", "421", "424", "2", "3323", "4423", ""):
            words, probs, lengths, _ = self.engine.ranked(self.engine.context([], ["i"]), code)
            tiers = self.tiers_of(words)
            self.assertEqual(tiers, sorted(tiers), code)
            self.assertTrue((np.diff(probs) <= 1e-12).all(), code)       # p is monotone with the order
            # every match is still listed; a next word (no groups) lists the core words only (round 4: Wiktionary's
            # rare words wait for the first typed group)
            expected = len(self.lex.matching(code)) if code else int((~self.lex.added).sum())
            self.assertEqual(len(words), expected, code)

    def test_common_words_reach_the_first_chooser_page(self):
        self.engine.start_conversation("tiers")
        for w in ["i'm", "don't", "the", "in", "why"]:
            page = [x["word"] for x in self.engine.predict([], ["i"] if w != "i'm" else [], code_of(w), limit=4, complete=True)["words"]]
            self.assertIn(w, page, (w, page))
        for code, junk in (("22", {"ll", "gm", "nj", "mn", "lg", "ig", "jj", "im"}), ("421", {"thc", "tlc", "tna", "tha", "vic", "tib", "une", "und"}),
                           ("1324", {"dont", "arn't", "arnt", "ariz", "conv", "boku"}), ("2", set("ghjklmn")), ("424", {"thx", "tnt", "tmz", "thu"})):
            page = [x["word"] for x in self.engine.predict([], ["i"], code, limit=12)["words"]]
            self.assertFalse(set(page) & junk, (code, page))

    def test_real_short_words_are_predictable_in_context(self):
        # the review's acceptance list; with the prior alone they must be on the first typed page, the live
        # rescorer test (tests/test_contract.py) asks for the top 3
        self.engine.start_conversation("tiers")
        for message, w in ((["i", "need", "a"], "nap"), (["i'd", "like", "a"], "mug"), (["it's", "3"], "pm"), (["a", "hot"], "tub")):
            page = [x["word"] for x in self.engine.predict([], message, code_of(w), limit=8, complete=True)["words"]]
            self.assertIn(w, page, (message, w, page))
        page = [x["word"] for x in self.engine.predict([["partner", "Shall we go out later?"]], [], code_of("hmm"), limit=8, complete=True)["words"]]
        self.assertIn("hmm", page, page)
        for w in ["mrs", "ok", "yeah", "nah", "gonna", "wanna", "y'all"]:
            page = [x["word"] for x in self.engine.predict([], [], code_of(w), limit=8, complete=True)["words"]]
            self.assertIn(w, page, (w, page))

    def test_context_promotes_a_tier2_word(self):
        self.engine.start_conversation("tiers")
        self.assertEqual(int(self.lex.tier[self.lex.index["priya"]]), 2)
        without = [x["word"] for x in self.engine.predict([], ["i", "like"], code_of("priya"), limit=8)["words"]]
        with_ = [x["word"] for x in self.engine.predict([["partner", "I was talking to Priya yesterday."]], ["i", "like"], code_of("priya"), limit=8)["words"]]
        self.assertNotIn("priya", without[:2])
        self.assertEqual(with_[0], "priya")
        # a letter the partner said comes back for that conversation; the other letters do not
        words = [x["word"] for x in self.engine.predict([["partner", "Take the vitamin K now."]], [], "2", limit=12)["words"]]
        self.assertIn("k", words)
        self.assertFalse({"g", "h", "j", "l", "m", "n"} & set(words), words)
        # a commit of a lexicon word (any tier) teaches nothing
        self.engine.commit("k")
        self.assertEqual(dict(self.engine.session), {})


if __name__ == "__main__":
    unittest.main()
