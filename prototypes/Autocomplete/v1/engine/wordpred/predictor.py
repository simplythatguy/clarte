"""Public predictor API and the existing stateless /api/predict view."""
from collections import defaultdict

import numpy as np

from .composer import Assignment, Composer
from .context import Context, code_of, words_of
from .ngram import NgramPrior
from .paths import require_models


class Predictor(Composer):
    def __init__(self, model="deployable"):
        if model not in {"deployable", "light"}:
            raise ValueError("model must be 'deployable' or 'light'")
        root = require_models(model)
        self.model = model
        if model == "deployable":
            from .ensemble import EnsemblePrior
            self.prior = EnsemblePrior(root)
            self.words = self.prior.vocabulary
        else:
            self.prior = NgramPrior(root)
            self.words = self.prior.words
        self.vocabulary = tuple(self.words)
        self.word_array = np.array(self.words, dtype=object)
        self.codes = [code_of(w) for w in self.words]
        self.lengths = np.array([len(c) for c in self.codes])
        prefix = defaultdict(list)
        for i, code in enumerate(self.codes):
            for k in range(len(code) + 1):
                prefix[code[:k]].append(i)
        self.prefix = {c: np.array(ix, dtype=np.int32) for c, ix in prefix.items()}
        self.top_n, self.decision_temperature, self.exclude_accepted = 64, 1.0, False
        self.assignment = Assignment()
        self.key = self.probs = None

    def distribution(self, ctx):
        return self.prior.distribution(ctx)

    def start_conversation(self, conv_id):
        self.key = None
        if self.model == "deployable":
            self.prior.start_conversation(conv_id)

    def commit(self, ctx, word):
        self.key = None
        if self.model == "deployable":
            self.prior.commit(ctx, word)

    def context(self, history, message):
        return Context("ui", tuple(("partner" if role == "partner" else "user", str(text))
                                   for role, text in history),
                       tuple(w for part in message for w in words_of(str(part))))

    def matching_probabilities(self, ctx, groups):
        """P(word | context), renormalized over the entire matching vocabulary."""
        self._prepare(ctx)
        idx = self.prefix.get(groups, np.array([], dtype=np.int32))
        order = idx[np.argsort(-self.probs[idx], kind="stable")]
        mass = self.probs[idx].sum()
        return [(self.words[i], float(self.probs[i] / mass)) for i in order] if mass else []

    def predict(self, history, message, groups):
        groups = "".join(ch for ch in str(groups) if ch in "1234")
        ctx = self.context(history, message)
        ranked = self.rank(ctx, groups)[:12]
        idx = np.flatnonzero(np.array([c.startswith(groups) for c in self.codes])) if groups else np.arange(len(self.codes))
        order = idx[np.argsort(-self.probs[idx], kind="stable")]
        likely = self.word_array[order[:12]].tolist()
        head, tail = order[:1], order[1:200]
        exact = tail[self.lengths[tail] == len(groups)] if groups else tail[:0]
        rest = tail[self.lengths[tail] != len(groups)] if groups else tail
        choose = self.word_array[np.concatenate((head, exact, rest))[:12]].tolist()
        b = max(len(groups), 1) + 2
        ok = (self.lengths <= b) & (self.lengths >= max(len(groups), 1))
        if groups:
            ok &= np.array([c.startswith(groups) for c in self.codes])
        short_idx = np.flatnonzero(ok)
        short = self.word_array[short_idx[np.argsort(-self.probs[short_idx], kind="stable")][:8]].tolist()
        return {"likely": likely, "choose": choose, "short": short,
                "ghost": ranked[0] if ranked else "", "candidates": ranked}

    def close(self):
        self.prior.close()
