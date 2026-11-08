"""The frozen top-64 optimal ghost composer and native solver binding."""
import ctypes as ct

import numpy as np

from .paths import library

I32 = np.ctypeslib.ndpointer(dtype=np.int32, ndim=1, flags="C_CONTIGUOUS")
F64 = np.ctypeslib.ndpointer(dtype=np.float64, ndim=1, flags="C_CONTIGUOUS")

class Assignment:
    def __init__(self):
        self.library = ct.CDLL(str(library("assignment")))
        self.function = self.library.ghost_assignment
        self.function.argtypes = [ct.c_int, ct.c_int, ct.c_int, ct.c_int, I32, I32, I32, F64, I32]
        self.function.restype = ct.c_double

    def solve(self, codes, probabilities, prefix=""):
        """Return prefix -> local word index and unnormalized expected cost."""
        prefixes, terminals, paths, offsets, ends = {}, {}, [], [0], []
        for code in codes:
            if not code.startswith(prefix):
                raise ValueError("all codes must extend the solve prefix")
            for k in range(len(prefix), len(code) + 1):
                p = code[:k]
                if p not in prefixes:
                    prefixes[p] = len(prefixes)
                paths.append(prefixes[p])
            offsets.append(len(paths))
            if code not in terminals:
                terminals[code] = len(terminals)
            ends.append(terminals[code])
        ghost = np.full(len(prefixes), -1, dtype=np.int32)
        total = self.function(len(codes), len(prefixes), len(terminals), len(prefix),
                              np.asarray(offsets, dtype=np.int32), np.asarray(paths, dtype=np.int32),
                              np.asarray(ends, dtype=np.int32), np.ascontiguousarray(probabilities, dtype=np.float64), ghost)
        if not np.isfinite(total):
            raise RuntimeError("assignment has no finite solution")
        return {p: int(ghost[i]) for p, i in prefixes.items() if ghost[i] >= 0}, total

class Composer:
    def _prepare(self, ctx):
        key = (ctx.conv_id, ctx.history, ctx.message)
        if key != self.key:
            self.probs = self.distribution(ctx)
            self.decision_probs = self.probs ** (1.0 / self.decision_temperature)
            self.key = key
            self.ghosts = {}
            self.ranked = np.argsort(-self.probs, kind="stable").astype(np.int32)

    def _accepted(self, code):
        return {self.ghosts[code[:k]] for k in range(len(code)) if code[:k] in self.ghosts}

    def _solve(self, code, ranked, accepted):
        # The existing plan may only have consumed words at ancestors. A new
        # omitted-mass subtree is solved locally without changing ancestor ghosts.
        active = ranked[~np.isin(ranked, list(accepted))] if accepted else ranked
        if not len(active):
            self.ghosts[code] = int(ranked[0])
            return
        chosen = active[:self.top_n]
        mapping, _ = self.assignment.solve([self.codes[i] for i in chosen], self.decision_probs[chosen], code)
        for prefix, local in mapping.items():
            self.ghosts[prefix] = int(chosen[local])
        # An unused ghost slot can occur when all remaining words end here and
        # fit in the other three first-page slots. Fill it deterministically.
        self.ghosts.setdefault(code, int(chosen[0]))

    def rank(self, ctx, code):
        self._prepare(ctx)
        ix = self.prefix.get(code)
        if ix is None or not len(ix):
            return []
        # Materialize the same ancestor decisions even when a caller queries
        # prefixes out of order. Passing a ghost is not treated as learning.
        for k in range(len(code) + 1):
            prefix = code[:k]
            if prefix not in self.ghosts:
                subset = self.prefix[prefix]
                order = self.ranked if not prefix else subset[np.argsort(-self.probs[subset], kind="stable")]
                self._solve(prefix, order, self._accepted(prefix))
        ranked = self.ranked if not code else ix[np.argsort(-self.probs[ix], kind="stable")]
        accepted = self._accepted(code)
        ghost = self.ghosts.get(code)
        if ghost is None:
            ghost = int(ranked[0])
        # Ancestor ghosts have zero remaining PRIMARY-policy probability. Keep
        # them as fillers, but do not displace a still-active exact-length word.
        others = ranked[ranked != ghost]
        blocked = np.isin(others, list(accepted)) if self.exclude_accepted else np.zeros(len(others), dtype=bool)
        active, inactive = others[~blocked], others[blocked]
        k = len(code)
        exact = self.lengths[active] == k
        old_exact = self.lengths[inactive] == k
        tail = np.concatenate((active[exact], inactive[old_exact], active[~exact], inactive[~old_exact]))
        return self.word_array[np.concatenate((np.array([ghost]), tail))[:12]].tolist()
