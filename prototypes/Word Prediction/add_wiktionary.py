"""Add English Wiktionary's words to data/lexicon.tsv.gz as tier 2, so any real word can be typed (round 4).

The built lexicon (build_lexicon.py, 120,953 words) misses rare real words: polyphiloprogenitive,
levothyroxine, apricity, doomscrolling. Wiktionary covered all 71 words of the hard set where SCOWL 95
covered 57 (bench/decision.tsv `r4.lists`). Its words join as tier 2: shown after every tier-1 word of a
code, so everyday prediction is unchanged, and reachable through Options and the chooser.

Kept: lower-case [a-z'] headwords and their inflected forms whose entry is not a name, abbreviation,
symbol, character or affix, and whose senses are not all tagged misspelling, obsolete, archaic,
nonstandard, pronunciation spelling or eye dialect. Words already in the lexicon keep their row; the
bare forms of contractions round 3 dropped (dont, im, thats), the junk list and new apostrophe words stay out.

Prior: the word's wordfreq probability when wordfreq has seen it (Zipf 0-2: below the main lexicon's
floor), else a floor of 1e-12 scaled by how English its spelling looks (a letter 4-gram trained on the
tier-1 words), so a plausible rare word comes before an odd one on the same code. Sources column `k`.

Input: the kaikki.org English Wiktionary extract reduced to `word<TAB>pos<TAB>tags<TAB>forms` lines
(see README "Lexicon"). Wiktionary content is CC BY-SA 4.0; the added rows carry that licence.

  ../v0/.venv/bin/python add_wiktionary.py WIKTIONARY_TSV [--out data/lexicon.tsv.gz]
"""
import argparse
import gzip
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from wordfreq import word_frequency

from build_lexicon import JUNK

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "lexicon.tsv.gz"
WORD = re.compile(r"^[a-z][a-z']*$")
SKIP_POS = {"name", "abbrev", "symbol", "character", "prefix", "suffix", "infix", "interfix", "circumfix", "punct"}
ONLY_BAD = {"misspelling", "obsolete", "archaic", "nonstandard", "pronunciation-spelling", "eye-dialect"}
NEUTRAL = {"form-of", "alt-of", "plural"}
FLOOR = 1e-12
MAX_LEN = 45


def wiktionary_words(path):
    """Every kept word from the reduced extract."""
    keep = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            word, pos, tags, forms = (line.rstrip("\n").split("\t") + ["", "", ""])[:4]
            if pos in SKIP_POS:
                continue
            t = set(filter(None, tags.split(",")))
            if t & ONLY_BAD and not (t - ONLY_BAD - NEUTRAL):
                continue
            for w in [word] + forms.split("|"):
                w = w.strip().lower()
                if w and len(w) <= MAX_LEN and WORD.match(w) and w.count("'") <= 1 and not w.endswith("'"):
                    keep.add(w)
    return keep


class LetterModel:
    """Letter 4-gram over a word list (one count per word), for how English a spelling looks."""

    def __init__(self, words, order=4):
        self.order = order
        self.counts = defaultdict(Counter)
        for w in words:
            s = "^" * (order - 1) + w + "$"
            for i in range(order - 1, len(s)):
                for n in range(order):
                    self.counts[s[i - n:i]][s[i]] += 1

    def mean_logp(self, w):
        s = "^" * (self.order - 1) + w + "$"
        total = 0.0
        for i in range(self.order - 1, len(s)):
            p = 1 / 28
            for n in range(self.order):
                row = self.counts.get(s[i - n:i])
                if not row:
                    continue
                size = sum(row.values())
                lam = size / (size + 3 * len(row))
                p = lam * row[s[i]] / size + (1 - lam) * p
            total += math.log(p)
        return total / (len(s) - self.order + 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wiktionary")
    ap.add_argument("--base", default=str(DATA), help="the lexicon to extend (build_lexicon.py output)")
    ap.add_argument("--out", default=str(DATA))
    a = ap.parse_args()
    header, rows = [], []
    with gzip.open(a.base, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                if "wiktionary" not in line:
                    header.append(line)
                continue
            w, p, src, t = line.rstrip("\n").split("\t")
            if "k" in src:
                continue        # a previous run's rows: rebuilt below
            rows.append((w, p, src, t))
    have = {r[0] for r in rows}
    # Round 3 dropped the bare forms of contractions (dont, im, thats) and the junk list; Wiktionary must
    # not bring them back. New words with an apostrophe are left out too (the lexicon's are curated).
    bare = {w.replace("'", "") for w in have if "'" in w} | JUNK
    model = LetterModel(w for w, _, _, t in rows if t == "1" and "'" not in w)
    added = []
    for w in sorted(wiktionary_words(a.wiktionary) - have - bare):
        if "'" in w:
            continue
        seen = word_frequency(w, "en")
        p = seen if seen > 0 else FLOOR * math.exp(model.mean_logp(w) + 2.0)
        added.append((w, f"{p:.3e}", "k", "2"))
    header.insert(1, f"# round 4: +{len(added)} English Wiktionary words (tier 2, sources k; CC BY-SA 4.0), add_wiktionary.py\n")
    with gzip.open(a.out, "wt", encoding="utf-8", compresslevel=9) as f:
        f.writelines(header)
        for r in rows + added:
            f.write("\t".join(r) + "\n")
    seen = sum(1 for _, p, _, _ in added if float(p) >= 1e-9)
    print(f"{len(rows):,} words kept, {len(added):,} added from Wiktionary ({seen:,} seen in wordfreq), {len(rows) + len(added):,} in all -> {a.out}")


if __name__ == "__main__":
    main()
