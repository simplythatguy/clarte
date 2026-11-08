"""The v1 engine: v0 prior on a 121k-word lexicon, pointer cache, exact neural rescoring, tiers, paging."""
import re
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path

import numpy as np

V0 = Path(__file__).resolve().parents[2] / "v0"
if str(V0) not in sys.path:
    sys.path.insert(0, str(V0))

from wordpred import Context, Predictor, code_of, words_of  # noqa: E402
from wordpred.composer import Assignment, Composer  # noqa: E402

from .cache import context_weights, display_forms  # noqa: E402
from .lexicon import Lexicon  # noqa: E402

DEFAULTS = dict(
    extra_share=0.01,      # prior mass given to words outside the v0 vocabulary (wordfreq backoff)
    wf_share=0.0,          # wordfreq unigram mixed over the whole lexicon (0 = off)
    name_boost=2.0,        # cache weight multiplier for capitalised, uncommon, non-sentence-initial words
    name_initial=1,        # 1: a sentence-initial capitalised word gets the name cue too when it is a first name,
                           #    outside the lexicon, or not a dictionary (web2) word ("Marcus called." vs "Yesterday ...")
    cache_share=0.08,      # pointer-cache mixing weight
    cache_decay=0.7, cache_partner=1.0, cache_user=0.5, cache_message=0.15, cache_session=0.3, cache_idf=2e-4,
    cache_session_decay=0.97,   # a committed word's weight per later commit (round 3: commit learns out-of-lexicon words only)
    top_k=24,              # candidates rescored by the transformer
    prior_weight=1.0, neural_weight=1.0,   # log-linear mix: prior_weight*log p_prior + neural_weight*log p_neural (round 2: 1.0 with qwen2.5-1.5b; round 1 used 0.5 with smol135-ft)
    repeat_discount=0.1,   # next word: a word among the last three message words keeps this share of its mass ...
    repeat_lm_floor=0.3,   # ... unless the rescorer alone gives the repeat at least this probability ("very very")
    slip_prior=0.005,      # typed groups: a one-digit correction competes with slip_prior x its prior mass ...
    slip_floor=1e-3,       # ... and only while the best exact match is this improbable (no common word fits the code)
    savings=0.0,           # 0 = rank by probability; >0 favours longer completions while typing
    composer=False,        # slot 1 from v0's optimal-ghost assignment over the v1 prior (frozen-benchmark policy)
    adapter=None,          # LoRA adapter folder for the MLX rescorer (fetch_models.py / train_lora.py)
    # branch rule (response "branch": offer words[1] in Q4 instead of Delete); replayed in bench/branch_sim.py
    branch_min_k=1,        # from this many typed groups on
    branch_ratio=0.3,      # p(words[1]) / p(words[0]) at least this
    branch_complete=2,     # 0 any words, 1 words[1] must be complete, 2 both must be complete
    branch_p0_min=0.2,     # never when the best word is this unlikely (a probable slip: Q4 stays Delete)
                           # round 3 (both complete, 0.3, 0.2) on the round-2 dev records: 2.947 selections/word vs 2.969 with
                           # Q4 always Delete, Delete hidden on 1.3% of typed states; round 2's (2, 0.2, any) gave 2.774 / 25.3%
)
PROFANITY = set("fuck fucking fucked fucker motherfucker shit shitty bullshit cunt bitch asshole arsehole dick cock pussy wanker "
                "bastard nigger nigga faggot retard slut whore twat".split())
WORDLIKE = re.compile(r"^[a-z]*[aeiouy][a-z']*$")
MESSAGE_TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)*|[0-9]+(?:[.:][0-9]+)?")


class GhostComposer(Composer):
    """v0's top-64 optimal ghost assignment, bound to the v1 lexicon and prior."""
    def __init__(self, engine):
        self.engine, lex = engine, engine.lex
        self.codes, self.lengths, self.prefix = lex.codes, lex.lengths, lex.prefix
        self.word_array = np.array(lex.words, dtype=object)
        self.assignment = Assignment()
        self.top_n, self.decision_temperature, self.exclude_accepted = 64, 1.0, False
        self.key = self.probs = None

    def distribution(self, ctx):
        return self.engine.prior(ctx)[0]


class Engine:
    def __init__(self, model="deployable", rescorer="auto", params=None, threads=4):
        self.params = {**DEFAULTS, **(params or {})}
        self.v0 = Predictor(model=model)
        self.v0.start_conversation("v1")
        self.model = self.v0.model
        self.lex = Lexicon()
        v0_index = {w: i for i, w in enumerate(self.v0.words)}
        self.base_ix = np.array([v0_index.get(w, -1) for w in self.lex.words], dtype=np.int64)
        self.is_base = self.base_ix >= 0
        extra = np.where(self.is_base, 0.0, self.lex.freq)
        extra[~self.is_base] = np.maximum(extra[~self.is_base], 1e-9)
        self.extra_prior = extra / extra.sum()
        self.unigram = dict(zip(self.lex.words, self.lex.freq))
        self.wf_prior = self.lex.freq / self.lex.freq.sum()
        self.rescorer = None
        if rescorer:
            from .neural import available, make_rescorer
            name = rescorer if rescorer != "auto" else (available() or [None])[0]
            if name:
                self.rescorer = make_rescorer(name, threads=threads, max_turns=self.params.get("max_turns", 24),
                                              max_tokens=self.params.get("max_tokens", 512), adapter=self.params["adapter"])
        self.rescorer_name = self.rescorer.name if self.rescorer else "none"
        self.session, self.session_last, self.session_display, self.commit_clock = Counter(), {}, {}, 0
        self._prior_key, self._prior = None, None
        self._ranked = OrderedDict()
        self.last_timing = {}
        self.ghost = GhostComposer(self) if self.params["composer"] else None

    # ---- state -------------------------------------------------------------
    def start_conversation(self, conv_id="ui"):
        self.session, self.session_last, self.session_display, self.commit_clock = Counter(), {}, {}, 0
        self._prior_key, self._prior = None, None
        self._ranked.clear()
        if self.ghost:
            self.ghost.key = None
        self.v0.start_conversation(conv_id)
        if self.rescorer:
            self.rescorer.reset()

    def learnable(self, word):
        """Commit teaches the engine words the lexicon does not know (new names), never lexicon words
        (history already covers their recency), profanity or junk tokens."""
        return (word not in self.lex.index and len(word) > 1 and WORDLIKE.match(word) is not None
                and word not in PROFANITY and word.rstrip("s").rstrip("ing").rstrip("er") not in PROFANITY)

    def commit(self, word, history=(), message=()):
        raw = str(word).strip()
        word = next(iter(words_of(raw)), None)
        self.commit_clock += 1
        if word and self.learnable(word):
            self.session[word] += 1
            self.session_last[word] = self.commit_clock
            if raw[:1].isupper() and raw[1:].islower():
                self.session_display[word] = raw[0] + raw[1:].lower()
        self._prior_key, self._prior = None, None
        self._ranked.clear()
        if self.ghost:
            self.ghost.key = None

    def session_weights(self):
        """Committed words, decayed per later commit (server lifetime, fading)."""
        d = self.params["cache_session_decay"]
        return Counter({w: c * d ** (self.commit_clock - self.session_last[w]) for w, c in self.session.items()})

    # ---- probabilities -----------------------------------------------------
    def context(self, history, message):
        hist = tuple(("partner" if role == "partner" else "user", str(text)) for role, text in history)
        # numbers in the message stay ("it's 3" -> pm); the benchmark tokenizer drops them, the rescorer reads them
        msg = tuple(w for part in message for w in MESSAGE_TOKEN.findall(str(part).replace("’", "'").lower()))
        return Context("v1", hist, msg)

    def _key(self, ctx):
        return (ctx.history, ctx.message, tuple(sorted(self.session.items())), self.commit_clock)

    def prior(self, ctx):
        """(p over the lexicon, {dynamic word: p}, promoted tier-2 words, display forms) before rescoring;
        the first two sum to 1 together."""
        key = self._key(ctx)
        if key == self._prior_key:
            return self._prior
        P = self.params
        base = self.v0.prior.distribution(ctx)
        p = np.where(self.is_base, base[np.maximum(self.base_ix, 0)] * (1 - P["extra_share"]),
                     P["extra_share"] * self.extra_prior)
        if P["wf_share"] > 0:
            p = (1 - P["wf_share"]) * p + P["wf_share"] * self.wf_prior
        dyn = {}
        weights = context_weights(ctx.history, ctx.message, self.session_weights(), decay=P["cache_decay"],
                                  partner=P["cache_partner"], user=P["cache_user"], in_message=P["cache_message"],
                                  session_weight=P["cache_session"], idf_floor=P["cache_idf"],
                                  unigram=lambda w: self.unigram.get(w, 0.0), name_boost=P["name_boost"],
                                  known_name=(lambda w: w in self.lex.names or w not in self.lex.dictionary) if P["name_initial"] else None)
        if weights and P["cache_share"] > 0:
            total = sum(weights.values())
            theta = P["cache_share"]
            p *= (1 - theta)
            for w, wt in weights.items():
                i = self.lex.index.get(w)
                if i is None:
                    dyn[w] = theta * wt / total
                else:
                    p[i] += theta * wt / total
        promoted = np.zeros(len(self.lex), dtype=bool)
        for w in weights:
            i = self.lex.index.get(w)
            if i is not None and self.lex.tier[i] > 1:
                promoted[i] = True
        display = display_forms(ctx.history, known=lambda w: w in self.lex.names or w not in self.lex.dictionary)
        display.update(self.session_display)
        self._prior_key, self._prior = key, (p, dyn, promoted, display)
        return self._prior

    def demote(self, tiers, p):
        """Scale p so every word of tier t sits below every word of a lower tier (tier 1 = common
        words, build_lexicon.py). Ratios inside a tier are kept, so the ranking within a tier is unchanged."""
        p = p.copy()
        for t in (2, 3):
            below, above = tiers == t, tiers < t
            if below.any() and above.any():
                cap, top = 0.5 * p[above].min(), p[below].max()
                p[below] = p[below] * (cap / top) if top > 0 else 0.0
        return p

    def ranked(self, ctx, groups):
        """Every matching word, best first: (words, probabilities normalised over the matches, lengths, mass)."""
        key = self._key(ctx) + (groups,)
        hit = self._ranked.get(key)
        if hit is not None:
            self._ranked.move_to_end(key)
            return hit
        P = self.params
        t0 = time.perf_counter()
        p, dyn, promoted, _ = self.prior(ctx)
        idx = self.lex.matching(groups)
        dyn_words = [w for w in dyn if code_of(w).startswith(groups)]
        probs = p[idx]
        order = np.argsort(-probs, kind="stable")
        idx, probs = idx[order], probs[order]
        words = [self.lex.words[i] for i in idx[:P["top_k"]]] + dyn_words
        cand_p = np.concatenate([probs[:P["top_k"]], np.array([dyn[w] for w in dyn_words])])
        t1 = time.perf_counter()
        neural = None
        if self.rescorer is not None and len(words) > 1 and P["neural_weight"] > 0:
            prompt = self.rescorer.prompt(ctx.history, ctx.message)
            neural = self.rescorer.score(prompt, words)
            if dyn_words:
                # A word learned from commit that the prompt never mentions: the transformer cannot know it,
                # so it gets the mean neural score instead of an unknown-name penalty (jev after one commit).
                low = prompt.lower()
                k0 = len(words) - len(dyn_words)
                fill = float(np.mean(neural[:k0])) if k0 else 0.0
                for j, w in enumerate(dyn_words):
                    if w not in low:
                        neural[k0 + j] = fill
            mix = P["prior_weight"] * np.log(np.maximum(cand_p, 1e-300)) + P["neural_weight"] * neural
            mix -= mix.max()
            new = np.exp(mix)
            new *= cand_p.sum() / new.sum()
            # Rescoring reorders the candidates but never drops one below the words it never looked at.
            if len(probs) > P["top_k"]:
                new = np.maximum(new, probs[P["top_k"]] * 1.001)
            cand_p = new
        t2 = time.perf_counter()
        if not groups and ctx.message:
            # Next word: the pointer cache and the n-gram prior like to echo what was just said ("hello hello").
            # A word among the last three message words is discounted unless the language model itself expects
            # the repeat ("very very", "bye bye"); the last word never comes first (below).
            recent = set(ctx.message[-3:])
            for j, w in enumerate(words):
                if w in recent and (neural is None or float(np.exp(neural[j])) < P["repeat_lm_floor"]):
                    cand_p[j] *= P["repeat_discount"]
        k = len(words) - len(dyn_words)
        all_words = words + [self.lex.words[i] for i in idx[k:]]
        all_p = np.concatenate([cand_p, probs[k:]])
        lengths = np.concatenate([self.lex.lengths[idx[:k]], np.array([len(code_of(w)) for w in dyn_words], dtype=np.int32),
                                  self.lex.lengths[idx[k:]]])
        # A word of tier 2 or 3 never outranks a tier-1 word unless the conversation mentioned it (a partner or
        # user turn, the message, or a commit); words outside the lexicon come from the conversation by construction.
        lex_tiers = np.where(promoted[idx], 1, self.lex.tier[idx]).astype(np.int8)
        tiers = np.concatenate([lex_tiers[:k], np.ones(len(dyn_words), dtype=np.int8), lex_tiers[k:]])
        all_p = self.demote(tiers, all_p)
        if P["savings"] > 0 and groups:
            # Favour completions that save more selections: p * (n - k + 1)^savings, ranking only.
            score = all_p * np.power(np.maximum(lengths - len(groups) + 1, 1), P["savings"])
        else:
            score = all_p
        order = np.lexsort((-score, tiers))
        if not groups and ctx.message and len(order) > 1 and all_words[order[0]] == ctx.message[-1]:
            all_p[order[0]] = all_p[order[1]] * 0.999
            order[[0, 1]] = order[[1, 0]]
        if self.ghost is not None and len(all_words) > 1:
            first = self.ghost.rank(ctx, groups)
            if first and first[0] in all_words:
                g = all_words.index(first[0])
                order = np.concatenate([[g], order[order != g]])
        mass = float(all_p.sum())
        result = ([all_words[i] for i in order], all_p[order] / mass if mass > 0 else all_p[order], lengths[order], mass)
        self._ranked[key] = result
        if len(self._ranked) > 64:
            self._ranked.popitem(last=False)
        self.last_timing = {"prior_ms": 1000 * (t1 - t0), "neural_ms": 1000 * (t2 - t1),
                            **(self.rescorer.last_ms if self.rescorer else {})}
        return result

    def rank(self, ctx, code, n=12):
        """Benchmark contract: best-first list of matching words."""
        return self.ranked(ctx, code)[0][:n]

    # ---- API views ---------------------------------------------------------
    def display(self, word, forms):
        """How the UI should show the word: I and its contractions, names as the conversation wrote them,
        first names the dictionary does not list as common words (priya, not will or may)."""
        if word in forms:
            return forms[word]
        if word == "i" or word.startswith("i'"):
            return "I" + word[1:]
        if word in self.lex.names and word not in self.lex.dictionary:
            return word[0].upper() + word[1:]
        return word

    def slips(self, ctx, groups, exact_best):
        """One-digit corrections whose slip-discounted prior mass beats the best exact match's prior mass:
        [(absolute mass, word, code length)], best first. Prior only, so the check costs no model pass."""
        p = self.prior(ctx)[0]
        out, seen = [], set()
        if exact_best >= self.params["slip_floor"]:
            return out
        for i, d in enumerate(groups):
            for alt in "1234".replace(d, ""):
                code = groups[:i] + alt + groups[i + 1:]
                if code in seen:
                    continue
                seen.add(code)
                idx = self.lex.matching(code)
                if not len(idx):
                    continue
                j = idx[int(np.argmax(p[idx]))]
                if self.lex.tier[j] == 1:
                    score = self.params["slip_prior"] * float(p[j])
                    if score > exact_best:
                        out.append((score, self.lex.words[j], int(self.lex.lengths[j])))
        out.sort(key=lambda t: -t[0])
        return out[:3]

    def corrected(self, ctx, groups, limit):
        """When nothing matches, offer words one slip away (one digit replaced by any other digit)."""
        seen, out = set(), []
        for i, d in enumerate(groups):
            for alt in "1234".replace(d, ""):
                code = groups[:i] + alt + groups[i + 1:]
                if code in seen:
                    continue
                seen.add(code)
                words, probs, lengths, mass = self.ranked(ctx, code)
                for w, p, n in zip(words[:limit], probs[:limit], lengths[:limit]):
                    out.append((p * mass, w, n))      # absolute mass: comparable across codes
        out.sort(key=lambda t: -t[0])
        total = sum(t[0] for t in out) or 1.0
        return [{"word": w, "p": round(float(p / total), 6), "complete": int(n) == len(groups), "corrected": True}
                for p, w, n in out[:limit]]

    def branch(self, groups, probs, lengths):
        """Should Q4 offer words[1] instead of Delete? Only when two whole words are both likely (bench/branch_sim.py)."""
        P = self.params
        k = len(groups)
        if k < max(P["branch_min_k"], 1) or len(probs) < 2 or probs[0] <= 0:
            return False
        if probs[0] < P["branch_p0_min"] or probs[1] / probs[0] < P["branch_ratio"]:
            return False
        if P["branch_complete"] >= 1 and int(lengths[1]) != k:
            return False
        if P["branch_complete"] >= 2 and int(lengths[0]) != k:
            return False
        return True

    def predict(self, history, message, groups="", limit=8, offset=0, complete=False):
        groups = "".join(ch for ch in str(groups) if ch in "1234")
        ctx = self.context(history, message)
        words, probs, lengths, mass = self.ranked(ctx, groups)
        forms = self.prior(ctx)[3]
        branch = self.branch(groups, probs, lengths)
        longer = float(probs[lengths > len(groups)].sum()) if len(words) else 0.0
        if complete:
            keep = lengths == len(groups)
            words = [w for w, k in zip(words, keep) if k]
            probs, lengths = probs[keep], lengths[keep]
            if len(probs):
                probs = probs / probs.sum()
        total = len(words)
        page = [{"word": w, "p": float(p), "complete": int(n) == len(groups)}
                for w, p, n in zip(words[offset:offset + limit], probs[offset:offset + limit], lengths[offset:offset + limit])]
        if groups and not complete and offset == 0 and total:
            # A likely gaze slip: the best exact match is far less probable, before any context, than a word one
            # digit away. The corrections join the first page by posterior, marked, and Q4 stays Delete.
            exact_prior = float(np.max(self.prior(ctx)[0][self.lex.matching(groups)])) if len(self.lex.matching(groups)) else 0.0
            slips = self.slips(ctx, groups, exact_prior)
            if slips:
                exact = [(float(p) * mass, w, int(n)) for w, p, n in zip(words[:limit], probs[:limit], lengths[:limit])]
                # the corrections are extra: every exact word of the page stays, so offset paging still covers them all
                merged = sorted([(s, w, n, True) for s, w, n in slips] + [(s, w, n, False) for s, w, n in exact], key=lambda t: -t[0])
                norm = mass + sum(s for s, _, _ in slips)
                page = [{"word": w, "p": s / norm, "complete": n == len(groups), **({"corrected": True} if c else {})}
                        for s, w, n, c in merged]
                branch = False
        if total == 0 and groups and not complete:
            page = self.corrected(ctx, groups, limit)
        elif total and not page:
            page = [{"word": words[-1], "p": float(probs[-1]), "complete": int(lengths[-1]) == len(groups)}]
        for item in page:
            item["p"] = round(item["p"], 6)
            shown = self.display(item["word"], forms)
            if shown != item["word"]:
                item["display"] = shown
        return {"groups": groups, "words": page, "total": total, "longer": round(longer, 6), "branch": branch}

    def predict_v0(self, history, message, groups=""):
        """The v0 /api/predict shape for s0: likely, choose, short, ghost, candidates."""
        groups = "".join(ch for ch in str(groups) if ch in "1234")
        ctx = self.context(history, message)
        words, probs, lengths, _ = self.ranked(ctx, groups)
        likely = words[:12]
        exact = [w for w, n in zip(words[:200], lengths[:200]) if n == len(groups)]
        choose = list(dict.fromkeys(likely[:1] + exact + words[1:200]))[:12]
        lo, hi = max(len(groups), 1), max(len(groups), 1) + 2
        short = [w for w, n in zip(words, lengths) if lo <= n <= hi][:8]
        return {"likely": likely, "choose": choose, "short": short,
                "ghost": likely[0] if likely else "", "candidates": likely}

    def close(self):
        self.v0.close()
