"""The shipped dictionary: words, group codes, prefix index, tiers and the wordfreq backoff prior."""
import gzip
from bisect import bisect_left
from pathlib import Path

import numpy as np

from wordpred.context import code_of

DATA = Path(__file__).resolve().parents[1] / "data" / "lexicon.tsv.gz"
NAMES = Path(__file__).resolve().parents[1] / "data" / "names.tsv.gz"


class Lexicon:
    def __init__(self, path=DATA, names_path=NAMES):
        words, freq, tier, names, dictionary, added = [], [], [], set(), set(), []
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    continue
                w, p, src, t = line.rstrip("\n").split("\t")
                words.append(w)
                freq.append(float(p))
                tier.append(int(t))
                if "n" in src:
                    names.add(w)
                if "d" in src:
                    dictionary.add(w)
                added.append("k" in src)
        # Round 5: the names (build_names.py). A name the lexicon lacks joins as tier 2 (sources N), so it is
        # reachable by its code anywhere and offered first only where a name is likely (predictor.prior).
        known = {w: i for i, w in enumerate(words)}
        name_prior, written = {}, {}
        if Path(names_path).is_file():
            with gzip.open(names_path, "rt", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("#"):
                        continue
                    name, prior, _kinds, _src, form = line.rstrip("\n").split("\t")
                    name_prior[name] = float(prior)
                    written[name] = form
                    if name not in known:
                        known[name] = len(words)
                        words.append(name)
                        freq.append(float(prior))
                        tier.append(2)
                        added.append(False)
        self.words = words
        self.names = names              # /usr/share/dict/propernames (1,302 first names)
        self.dictionary = dictionary    # words Webster's web2 lists: a sentence-initial capitalised word outside it reads as a name
        self.index = {w: i for i, w in enumerate(words)}
        self.added = np.array(added, dtype=bool)   # round 4: rows add_wiktionary.py added (sources k)
        self.name_prior = np.zeros(len(words), dtype=np.float64)
        for name, prior in name_prior.items():
            self.name_prior[self.index[name]] = prior
        self.is_name = self.name_prior > 0
        self.name_written = written
        self.freq = np.array(freq, dtype=np.float64)
        # 1 common word, 2 abbreviation/slang/name/rare short token or a Wiktionary word (round 4,
        # add_wiktionary.py), 3 single letter other than a and i (build_lexicon.py). The engine shows a word of tier 2 or 3 after every tier-1 word unless the
        # conversation mentioned it.
        self.tier = np.array(tier, dtype=np.int8)
        self.codes = [code_of(w) for w in words]
        self.lengths = np.array([len(c) for c in self.codes], dtype=np.int32)
        self.prefix = PrefixIndex(self.codes)
        self.empty = np.array([], dtype=np.int32)

    def __len__(self):
        return len(self.words)

    def matching(self, groups):
        """Indices of every word whose code starts with groups (all words for '')."""
        return self.prefix.get(groups, self.empty)


class PrefixIndex:
    """Word indices by code prefix. Codes are sorted once, so the words of any prefix are one slice
    (a dict of every prefix's array grew past 1 GB with Wiktionary's 750,000 words). A slice comes back
    in lexicon order, as the dict's arrays did, so equal probabilities keep breaking ties the same way."""

    def __init__(self, codes):
        self.order = np.array(sorted(range(len(codes)), key=codes.__getitem__), dtype=np.int32)
        self.sorted = [codes[i] for i in self.order]
        self.cache = {}

    def get(self, prefix, default=None):
        hit = self.cache.get(prefix)
        if hit is not None:
            return hit
        lo = bisect_left(self.sorted, prefix)
        hi = bisect_left(self.sorted, prefix + "5", lo)     # group digits are 1-4: "5" ends the block
        if lo == hi:
            return default
        ix = np.sort(self.order[lo:hi])
        if len(self.cache) > 4096:
            self.cache.clear()
        self.cache[prefix] = ix
        return ix

    def __getitem__(self, prefix):
        ix = self.get(prefix)
        if ix is None:
            raise KeyError(prefix)
        return ix

    def __contains__(self, prefix):
        return self.get(prefix) is not None

    def full_codes(self):
        """Every distinct whole-word code, with the words that are exactly that code."""
        i, n = 0, len(self.sorted)
        while i < n:
            j = i
            while j < n and self.sorted[j] == self.sorted[i]:
                j += 1
            yield self.sorted[i], np.sort(self.order[i:j])
            i = j
