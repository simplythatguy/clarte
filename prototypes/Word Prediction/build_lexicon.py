"""Build data/lexicon.tsv.gz: every word the engine can offer, with its wordfreq prior and its tier.

Sources, all read only here (the engine reads the built file):
- the v0 union vocabulary (66,501 words: AAC/DailyDialog train words, wordfreq 20k, contractions),
- wordfreq 'en' words with Zipf frequency >= 2.0 (everyday words, inflections, names, places, modern words),
- /usr/share/dict/web2 (Webster's 1913) words that wordfreq has seen at all (rare and long words),
- /usr/share/dict/propernames (common first names),
- a curated contraction list,
- round 3: the New Oxford American Dictionary through macOS DictionaryServices (DCSCopyTextDefinition) and
  standalone-token counts in the DailyDialog training text, both used only to decide a word's tier.

Filters: lower-case [a-z'] tokens only; no roman numerals; possessives only above Zipf 3.0;
1-2 letter tokens only at Zipf >= 3.5 (a, i and the contraction list always), whatever the source; no
repeated runs of four letters (xxxxxxxxxx) anywhere, including v0's vocabulary;
3-letter tokens below Zipf 3.0 only when web2 lists them, and below Zipf 2.5 never unless web2 and
wordfreq both list them; apostrophe tokens only in the standard contraction shapes (word's, n't,
'll, 're, 've, 'd, 'm), the curated list, or at Zipf >= 3.0 (o'clock, o'brien), one apostrophe at most
(round 2: drops i'ii, doesn'twork, c'n, kd, ef ... inherited from v0's vocabulary).

Round 3: the tier column and three drops.
- dropped: a word the dictionary knows only as a contraction with an apostrophe (dont -> don't, aint,
  theyre, youre), the bare form of a curated contraction unless the dictionary lists it as a word of its
  own (cant, wont, ill, well, its, lets, shed, wed, id, hell, shell ... stay), and contractions of a
  standard shape whose stem is not an auxiliary or pronoun (arn't, your're, did't).
- tier 1 (common words, shown before everything else): the curated and valid-shape contractions; every
  word the dictionary lists as a headword, an inflection of one or a variant spelling, except affix
  entries (ur-, im-, -ive), abbreviations below Zipf 4.5 (4.0 when the dictionary marks them informal:
  idk, btw) and all-caps acronyms below Zipf 4.0 (NJ, THC, TNT); words that occur five times or more
  as standalone tokens in the DailyDialog training text (the clean conversational source; the AAC
  sentences carry dont/im/ur/goto); words of four letters or more that web2 lists (or whose inflection
  stem it lists) or that reach Zipf 3.5 without any dictionary (modern words, frequent names).
- tier 2: everything else, in practice abbreviations nobody says (gm, nj, thx), typing artefacts (ll,
  ve), rare names and foreign words (priya, boku, une), non-words (tha, tna, tmz). Still reachable by
  paging; shown after every tier-1 word unless the conversation mentioned the word.
- tier 3: single letters other than a and i (the dictionary lists every letter).
- JUNK: dictionary words that in this product are misspellings of a far more frequent word (wat).
Re-run: ../v0/.venv/bin/python build_lexicon.py   (macOS only: DictionaryServices, /usr/share/dict)
"""
import ctypes
import ctypes.util
import gzip
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
V0 = HERE.parent / "v0"
sys.path.insert(0, str(V0))
RESEARCH = Path("/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction")
DAILYDIALOG = RESEARCH / "data/raw/dailydialog/train.parquet"

TOKEN = re.compile(r"^[a-z]+(?:'[a-z]+)*$")
CONTRACTION_SHAPE = re.compile(r"^[a-z]+(?:'(?:s|t|ll|re|ve|d|m)|n't)$")
ROMAN = re.compile(r"^[ivxlcdm]+$")
ROMAN_NUMERAL = re.compile(r"^(?=[ivxlcdm])m{0,3}(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$")
RUN = re.compile(r"(.)\1\1\1")   # xxxxxxxxxx, aaaah
CONTRACTIONS = """y'all ain't could've should've would've might've must've ma'am o'clock
i'm i've i'll i'd you're you've you'll you'd he's he'd he'll she's she'd she'll it's it'd it'll
we're we've we'll we'd they're they've they'll they'd that's that'd that'll there's there'd there'll
here's what's what'd what'll what're where's where'd who's who'd who'll who're how's how'd when's why's
let's isn't aren't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't mustn't
hasn't haven't hadn't needn't daren't shan't y'know c'mon ne'er e'er o'er 'cause ma'am""".split()
BARE_FORMS = {c.replace("'", "") for c in CONTRACTIONS if "'" in c}
AUXILIARIES = set("is are was were do does did can could will would should must might need dare ought has have had shall ai".split())
STEMS = set("i you he she it we they who what where when why how that this there here things people".split())
JUNK = {"wat"}                      # a Thai temple in the dictionary; "what" in every AAC sentence that contains it
ZIPF_LONG = 3.5                     # four letters or more with no dictionary behind them (names, modern words)
ZIPF_ABBREVIATION = 4.5             # abbreviations, symbols, acronyms: pm 4.69, dr 5.24, st 5.20, TV 5.2, PC 4.53; not gm 4.16, Mn, DJ 4.23
ZIPF_INFORMAL = 4.0                 # the dictionary's "informal" abbreviations and acronyms: idk 4.17, btw 4.06, OMG 4.05; not thx 3.15
CORPUS_COUNT = 10                   # standalone tokens in the DailyDialog training text (its typos stay below: ur 6, tha 4, im 3)
INFLECTION_SUFFIXES = ("s", "es", "ed", "d", "ing", "er", "est", "ly", "ies", "ied", "ier", "iest", "ily", "ity", "r", "rs", "st", "n",
                       "ns", "an", "ans", "ian", "ians", "ness", "ment", "ments", "ful", "less", "ish", "y", "ers", "ings", "able", "ee", "ees")
POS = ("abbreviation", "combining form", "prefix", "suffix", "contraction", "exclamation", "plural noun", "noun", "verb", "adjective",
       "adverb", "pronoun", "possessive determiner", "determiner", "conjunction", "preposition", "symbol", "trademark", "cardinal number",
       "ordinal number", "interjection", "predeterminer", "particle")
APOSTROPHES = re.compile(r"[’‘´`]")
SPLIT_CONTRACTION = re.compile(r"(\w) ?' ?(s|t|ll|ve|re|d|m)\b", re.IGNORECASE)   # "I ’ Ve been" in DailyDialog


# ---- DictionaryServices (New Oxford American Dictionary, the macOS default) ---------------------------------
class _CFRange(ctypes.Structure):
    _fields_ = [("location", ctypes.c_long), ("length", ctypes.c_long)]


def _dcs():
    cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
    cs = ctypes.CDLL("/System/Library/Frameworks/CoreServices.framework/CoreServices")
    cf.CFStringCreateWithCString.restype = ctypes.c_void_p
    cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    cf.CFStringGetLength.argtypes, cf.CFStringGetLength.restype = [ctypes.c_void_p], ctypes.c_long
    cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    cf.CFStringGetCString.restype = ctypes.c_bool
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    cs.DCSCopyTextDefinition.restype = ctypes.c_void_p
    cs.DCSCopyTextDefinition.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _CFRange]
    cs.DCSGetTermRangeInString.restype = _CFRange
    cs.DCSGetTermRangeInString.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long]
    return cf, cs


_UTF8 = 0x08000100
_libs = None


def noad_entry(word):
    """The default dictionary's first entry for `word`, or None when it has no term covering the whole word."""
    global _libs
    if _libs is None:
        _libs = _dcs()
    cf, cs = _libs
    s = cf.CFStringCreateWithCString(None, word.encode("utf-8"), _UTF8)
    try:
        r = cs.DCSGetTermRangeInString(None, s, 0)
        if r.location != 0 or r.length != len(word):
            return None
        d = cs.DCSCopyTextDefinition(None, s, _CFRange(0, len(word)))
        if not d:
            return None
        try:
            n = cf.CFStringGetLength(d)
            buf = ctypes.create_string_buffer(4 * n + 1)
            cf.CFStringGetCString(d, buf, len(buf), _UTF8)
            return buf.value.decode("utf-8", "replace")
        finally:
            cf.CFRelease(d)
    finally:
        cf.CFRelease(s)


def _norm(token):
    return re.sub(r"[·.,\-]", "", token.lower().replace("’", "'"))


def parse_entry(text):
    """Head words, part of speech and markers of a definition text such as
    "Mrs. | ˈmisiz | noun a title ...", "gm abbreviation gram(s).", "ur- | o͝or | combining form ...",
    "OK 1 | ˌōˈkā | (okay | ...) informal exclamation ..."."""
    first = text[:240]
    pos_hits = [(first.find(p), p) for p in POS if first.find(p) >= 0]
    pos_at, pos = min(pos_hits) if pos_hits else (len(first), None)
    head = first.split(" | ")[0] if " | " in first[:pos_at + 3] else first[:pos_at]
    tokens = []
    for tok in head.split():
        if tok[0].isdigit() or tok.startswith("("):
            break
        tokens.append(tok)
    heads, variants = set(), set()
    if tokens:
        heads.add(_norm(tokens[0]))
        heads.add(_norm("".join(tokens)))
    # variant spellings before the part of speech: "(also Ima, Imma)", "(okay | ...)", "(British English also rationalise)"
    for m in re.finditer(r"\((?:[A-Za-z ]*also )?([^()|]+?)(?: \||\))", first[:pos_at]):
        variants.update(_norm(v) for v in m.group(1).split(", ") if " " not in v.strip())
    heads.discard("")
    variants.discard("")
    after = first[pos_at:pos_at + 60] if pos else ""
    informal = "informal" in after or "slang" in after or "informal" in first[max(0, pos_at - 12):pos_at]
    affix = any(t.startswith("-") or t.endswith("-") for t in tokens[:1]) or pos in ("prefix", "suffix", "combining form")
    return {"heads": heads | variants, "main": _norm("".join(tokens)), "pos": pos, "affix": affix,
            "caps": bool(tokens) and tokens[0].isupper() and len(tokens[0]) > 1, "informal": informal}


def inflection_of(word, head):
    if word == head:
        return True
    if head in stems(word):
        return True
    if word.startswith(head) and word[len(head):] in INFLECTION_SUFFIXES:
        return True
    if head.startswith(word) and len(head) - len(word) <= 1:          # cytogenetic -> cytogenetics
        return True
    if head.endswith("y") and word.startswith(head[:-1]) and word[len(head) - 1:] in ("ies", "ied", "ier", "iest", "ily"):
        return True
    return False


INFLECTED_POS = {"noun", "plural noun", "verb", "adjective", None}


def dictionary_word(word, entry):
    """True when the dictionary lists `word` as a word of its own (headword, inflection or variant spelling).
    Only nouns, verbs and adjectives inflect: "hows" is not a form of the adverb "how"."""
    if entry is None or entry["affix"]:
        return False
    if word in entry["heads"]:
        return True
    return entry["pos"] in INFLECTED_POS and any(inflection_of(word, h) for h in entry["heads"])


def stems(w):
    """Candidate dictionary head words for an inflected form (web2 lists few inflections)."""
    yield w
    if w.endswith("ies"):
        yield w[:-3] + "y"
    if w.endswith("ied"):
        yield w[:-3] + "y"
    if w.endswith("es"):
        yield w[:-2]
    if w.endswith("s"):
        yield w[:-1]
    if w.endswith("ed"):
        yield w[:-2]
        yield w[:-1]
        if len(w) > 4 and w[-3] == w[-4]:
            yield w[:-3]
    if w.endswith("ing"):
        yield w[:-3]
        yield w[:-3] + "e"
        if len(w) > 5 and w[-4] == w[-5]:
            yield w[:-4]
    if w.endswith("er") or w.endswith("ly"):
        yield w[:-2]
        yield w[:-1]
    if w.endswith("est"):
        yield w[:-3]
        yield w[:-2]


def attested(w, dictionary):
    return any(s in dictionary for s in stems(w))


def apostrophe_kind(w):
    """curated | contraction (standard shape, known stem) | possessive | misspelled | other"""
    if w in CONTRACTIONS:
        return "curated"
    if w.endswith("n't"):
        return "contraction" if w[:-3] in AUXILIARIES else "misspelled"
    m = re.match(r"^([a-z]+)'(s|ll|re|ve|d|m)$", w)
    if not m:
        return "other"
    stem, suffix = m.groups()
    if suffix == "s":
        return "possessive"
    return "contraction" if stem in STEMS else "misspelled"


def tier_of(w, zipf, entry, web2=frozenset(), corpus_count=0, stem_tier=None):
    """1 common, 2 everything else, 3 single letters other than a/i, 0 = drop from the lexicon.
    `entry` is parse_entry(noad_entry(w)) or None; `stem_tier(stem)` gives a possessive's stem tier."""
    if "'" in w:
        kind = apostrophe_kind(w)
        if kind in ("curated", "contraction"):
            return 1
        if kind == "misspelled":
            return 0
        if kind == "possessive":
            return 1 if (stem_tier(w[:-2]) if stem_tier else None) == 1 else 2
        return 2
    if len(w) == 1:
        return 1 if w in ("a", "i") else 3
    if entry and entry["affix"]:
        entry = None                                   # the first entry is an affix (at-, -let, my-): no evidence either way
    if entry and "'" in entry["main"] and entry["main"].replace("'", "") == w:
        return 0                                       # dont -> don't, aint, theyre, youre, spose -> s'pose
    if w in BARE_FORMS and not dictionary_word(w, entry):
        return 0
    if w in JUNK:
        return 2
    if dictionary_word(w, entry):
        if entry["pos"] in ("abbreviation", "symbol") or entry["caps"]:
            if zipf >= (ZIPF_INFORMAL if entry["informal"] else ZIPF_ABBREVIATION):
                return 1
        else:
            return 1
    if corpus_count >= CORPUS_COUNT:
        return 1
    if ROMAN_NUMERAL.match(w):
        return 2                                       # ii, iv, xii: not did, mix (dictionary words return above)
    if len(w) >= 4 and (attested(w, web2) or zipf >= ZIPF_LONG):
        return 1
    return 2


def tiers(words, zipf, entries, web2, corpus):
    """{word: tier} for a candidate word list; possessives take their stem's tier."""
    plain = {w: tier_of(w, zipf(w), entries.get(w), web2, corpus.get(w, 0)) for w in words if not w.endswith("'s")}
    out = dict(plain)
    for w in words:
        if w.endswith("'s"):
            out[w] = tier_of(w, zipf(w), None, stem_tier=plain.get)
    return out


def dailydialog_counts():
    """Standalone tokens in the DailyDialog training text, with its "don ’ t" split repaired first."""
    import pyarrow.parquet as pq
    from collections import Counter
    from wordpred.context import words_of
    counts = Counter()
    for dialog in pq.read_table(DAILYDIALOG).column("dialog").to_pylist():
        for turn in dialog:
            counts.update(words_of(SPLIT_CONTRACTION.sub(r"\1'\2", APOSTROPHES.sub("'", turn))))
    return counts


def main():
    from wordfreq import top_n_list, word_frequency, zipf_frequency
    from wordpred.predictor import Predictor  # noqa: F401  (import check only; the words come from the files)
    counts = V0 / "models" / "counts_aac63k.pkl"
    neural = json.loads((V0 / "models" / "vocabulary.json").read_text())["words"]
    import hashlib
    import pickle
    from wordpred.paths import COUNTS_SHA256
    raw = counts.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == COUNTS_SHA256, "untrusted count model"
    base = set(pickle.loads(raw)["vocab"]) | {r["word"] for r in neural}
    web2 = {l.strip() for l in open("/usr/share/dict/web2", encoding="utf-8", errors="ignore")
            if l.strip().islower() and TOKEN.match(l.strip())}
    names = {l.strip().lower() for l in open("/usr/share/dict/propernames", encoding="utf-8", errors="ignore")
             if TOKEN.match(l.strip().lower())}
    wf = {w: zipf_frequency(w, "en") for w in top_n_list("en", 400000) if TOKEN.match(w)}
    chosen = set(base) | names | set(CONTRACTIONS)
    for w, z in wf.items():
        if z >= 2.0 or (w in web2 and z >= 1.0):
            chosen.add(w)
    kept = []
    for w in sorted(chosen):
        if not TOKEN.match(w):
            continue
        z = wf.get(w, 0.0)
        core = w.replace("'", "")
        if RUN.search(core):
            continue
        if w in CONTRACTIONS:
            kept.append(w)
            continue
        if "'" in w and (w.count("'") > 1 or (not CONTRACTION_SHAPE.match(w) and z < 3.0)):
            continue
        if len(core) <= 2 and z < 3.5 and w not in ("a", "i"):
            continue
        if len(core) == 3 and z < 2.5 and not (w in web2 and w in wf):
            continue
        if w in base or w in names:
            kept.append(w)
            continue
        if ROMAN.match(core) and len(core) > 1:
            continue
        if w.endswith("'s") and z < 3.0:
            continue
        if len(core) <= 2 and z < 3.5:
            continue
        if len(core) == 3 and z < 3.0 and w not in web2:
            continue
        kept.append(w)
    entries = {}
    for w in kept:
        if not w.endswith("'s"):
            text = noad_entry(w)
            if text:
                entries[w] = parse_entry(text)
    corpus = dailydialog_counts()
    tier = tiers(kept, lambda w: wf.get(w, 0.0), entries, web2, corpus)
    dropped = sorted(w for w in kept if tier[w] == 0)
    kept = [w for w in kept if tier[w] > 0]
    out = HERE / "data" / "lexicon.tsv.gz"
    out.parent.mkdir(exist_ok=True)
    with gzip.open(out, "wt", encoding="utf-8") as f:
        f.write("# word\twordfreq_probability\tsources\ttier\n")
        for w in kept:
            src = "".join(c for c, ok in (("b", w in base), ("w", w in wf), ("d", w in web2), ("n", w in names),
                                           ("o", dictionary_word(w, entries.get(w))), ("c", corpus.get(w, 0) >= CORPUS_COUNT)) if ok)
            f.write(f"{w}\t{word_frequency(w, 'en'):.3e}\t{src}\t{tier[w]}\n")
    sizes = {t: sum(1 for w in kept if tier[w] == t) for t in (1, 2, 3)}
    print(f"{len(kept)} words -> {out}; tiers {sizes}; dictionary entries {len(entries)}; dropped {len(dropped)}: {' '.join(dropped)}")
    for probe in ["xylophone", "quixotic", "antidisestablishmentarianism", "running", "children", "y'all", "don't",
                  "priya", "okonkwo", "instagram", "covid", "wheelchair", "physio", "melissa", "london", "tuesday",
                  "ll", "gm", "tha", "cuz", "ur", "u", "ariz", "cant", "wont", "dont", "im", "arn't",
                  "nap", "mug", "tub", "hmm", "mrs", "pm", "ok", "yeah", "nah", "gonna", "wanna", "meds", "wat"]:
        print(probe, tier.get(probe, "absent"), end="; ")
    print()


if __name__ == "__main__":
    main()
