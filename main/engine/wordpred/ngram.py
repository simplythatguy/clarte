"""Selected AAC/DailyDialog MKN + ARPA + causal history-count prior."""
import hashlib
import pickle
from collections import Counter, defaultdict

import numpy as np

from .context import words_of
from .paths import ARPA, COUNTS_SHA256
from .arpa import Arpa

def normalized(a):
    a = np.asarray(a, dtype=np.float64)
    return a / a.sum()

def discounts(counts):
    """Chen-Goodman count-of-counts estimates, with stable sparse-data fallbacks."""
    ns = Counter(counts)
    y = ns[1] / (ns[1] + 2 * ns[2]) if ns[1] else 0.5
    ds = [0.0]
    for r in (1, 2, 3):
        d = r - (r + 1) * y * ns[r + 1] / ns[r] if ns[r] and ns[r + 1] else 0.75
        ds.append(min(r - 1e-6, max(0.01, d)))
    return ds

class KN:
    def __init__(self, domain, size, order):
        u = np.full(size, 1e-9)
        for w, c in domain["continuation_unigram"].items():
            u[w] += c
        self.base = normalized(u)
        self.tables = []
        sources = [(domain["bigram"] if order == 2 else domain["continuation_bigram"])]
        if order == 3:
            sources.append(domain["trigram"])
        self.discounts = []
        for counts in sources:
            ds = discounts(counts.values())
            self.discounts.append(ds)
            grouped = defaultdict(list)
            for key, count in counts.items():
                grouped[key[:-1]].append((key[-1], count))
            table = {}
            for ctx, rows in grouped.items():
                ix = np.array([w for w, c in rows], dtype=np.int32)
                c = np.array([c for w, c in rows], dtype=np.float64)
                d = np.array([ds[min(int(v), 3)] for v in c])
                table[ctx] = (ix, (c - d) / c.sum(), d.sum() / c.sum())
            self.tables.append(table)

    def distribution(self, context):
        p = self.base.copy()
        for n, table in enumerate(self.tables, 1):
            row = table.get(tuple(context[-n:]))
            if row:
                ix, observed, backoff = row
                p *= backoff
                p[ix] += observed
        return p

class NgramPrior:
    def __init__(self, root):
        raw = (root / "counts_aac63k.pkl").read_bytes()
        if hashlib.sha256(raw).hexdigest() != COUNTS_SHA256:
            raise ValueError(f"{root / 'counts_aac63k.pkl'} is not the trusted count model (SHA256 differs); "
                             "it was not loaded. Copy it again from a trusted source; see MODEL_RECIPE.md.")
        data = pickle.loads(raw)
        self.words = data["vocab"]
        self.ids = {w: i for i, w in enumerate(self.words)}
        self.bos = len(self.words)
        wf = normalized(data["frequency"])
        us = []
        for domain in data["domains"]:
            u = np.zeros(len(self.words))
            for i, c in domain["unigram"].items():
                u[i] = c
            us.append(normalized(u))
        aac, dd = 0.6, 0.2
        self.unigram = (1 - aac - dd) * wf + aac * us[0] + dd * us[1]
        self.lms = [KN(d, len(self.words), 3) for d in data["domains"]]
        self.lm_weight, self.lm_aac = 0.8, 0.5
        self.partner, self.user = 0.05, 0.05
        self.arpa_weight = 0.5
        self.arpa = Arpa(root / ARPA, self.words)

    def distribution(self, ctx):
        p = self.unigram.copy()
        context = [self.bos, self.bos] + [self.ids.get(w, -1) for w in ctx.message]
        if self.lms:
            lp = (self.lm_aac * self.lms[0].distribution(context) +
                  (1 - self.lm_aac) * self.lms[1].distribution(context))
            p = (1 - self.lm_weight) * p + self.lm_weight * lp
        if self.arpa:
            ap = self.arpa.distribution(ctx.message)
            p = (1 - self.arpa_weight) * p + self.arpa_weight * ap
        if self.partner or self.user:
            for speaker, weight in (("partner", self.partner), ("user", self.user)):
                if not weight:
                    continue
                history = ctx.history
                cache = Counter()
                for role, text in reversed(history):
                    if role == speaker:
                        for w in words_of(text):
                            if w in self.ids:
                                cache[self.ids[w]] += 1.0
                if cache:
                    total = sum(cache.values())
                    p *= (1 - weight)
                    for i, count in cache.items():
                        p[i] += weight * count / total
        return p

    def close(self):
        self.arpa.close()
