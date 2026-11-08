"""The shipped dictionary: words, group codes, prefix index, tiers and the wordfreq backoff prior."""
import gzip
from collections import defaultdict
from pathlib import Path

import numpy as np

from wordpred.context import code_of

DATA = Path(__file__).resolve().parents[1] / "data" / "lexicon.tsv.gz"


class Lexicon:
    def __init__(self, path=DATA):
        words, freq, tier, names, dictionary = [], [], [], set(), set()
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
        self.words = words
        self.names = names              # /usr/share/dict/propernames (1,302 first names)
        self.dictionary = dictionary    # words Webster's web2 lists: a sentence-initial capitalised word outside it reads as a name
        self.index = {w: i for i, w in enumerate(words)}
        self.freq = np.array(freq, dtype=np.float64)
        # 1 common word, 2 abbreviation/slang/name/rare short token, 3 single letter other than a and i
        # (build_lexicon.py). The engine shows a word of tier 2 or 3 after every tier-1 word unless the
        # conversation mentioned it.
        self.tier = np.array(tier, dtype=np.int8)
        self.codes = [code_of(w) for w in words]
        self.lengths = np.array([len(c) for c in self.codes], dtype=np.int32)
        prefix = defaultdict(list)
        for i, code in enumerate(self.codes):
            for k in range(len(code) + 1):
                prefix[code[:k]].append(i)
        self.prefix = {c: np.array(ix, dtype=np.int32) for c, ix in prefix.items()}
        self.empty = np.array([], dtype=np.int32)

    def __len__(self):
        return len(self.words)

    def matching(self, groups):
        """Indices of every word whose code starts with groups (all words for '')."""
        return self.prefix.get(groups, self.empty)
