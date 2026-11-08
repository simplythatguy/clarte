"""Selected partner-gated linear mixture on the union vocabulary."""
import numpy as np

from .ngram import NgramPrior
from .neural import NeuralScorer


class EnsemblePrior:
    def __init__(self, root):
        self.ngram = NgramPrior(root)
        self.neural = NeuralScorer(root)
        self.vocabulary = tuple(sorted(set(self.ngram.words) | set(self.neural.words)))
        ids = {w: i for i, w in enumerate(self.vocabulary)}
        self.a_index = np.array([ids[w] for w in self.ngram.words], dtype=np.int32)
        self.b_index = np.array([ids[w] for w in self.neural.words], dtype=np.int32)
        reference = np.zeros(len(ids))
        reference[self.a_index] += self.ngram.unigram
        reference[self.b_index] += self.neural.unigram
        self.reference = reference / reference.sum()
        if np.any(self.reference <= 0):
            raise ValueError("union reference must cover every vocabulary word")
        self.key = None

    def start_conversation(self, conv_id):
        self.key = None
        self.neural.start_conversation(conv_id)

    def commit(self, ctx, word):
        self.key = None

    def distribution(self, ctx):
        key = (ctx.conv_id, ctx.history, ctx.message)
        if key != self.key:
            a = np.zeros(len(self.vocabulary))
            a[self.a_index] = self.ngram.distribution(ctx)
            self.neural.rank(ctx, "")
            b = np.zeros(len(self.vocabulary))
            b[self.b_index] = self.neural.scores
            weight = 0.875 if any(role == "partner" for role, _ in ctx.history) else 0.375
            floor = 1e-8
            a = (1 - floor) * a + floor * self.reference
            b = (1 - floor) * b + floor * self.reference
            p = (1 - weight) * a + weight * b
            self.probs = p / p.sum()
            self.key = key
        return self.probs

    def close(self):
        self.ngram.close()
