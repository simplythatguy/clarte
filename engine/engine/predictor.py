"""The v1 engine: v0 prior on a 121k-word lexicon, pointer cache, exact neural rescoring, tiers, paging."""
import re
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path

import numpy as np

V0 = Path(__file__).resolve().parents[1]   # the wordpred package (the v0 engine) lives beside engine/
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
    # round 5: names where a name is likely (data/names.tsv.gz); the rescorer measures how likely (name_mass)
    name_weight=1.0,       # share of the prior moved to the names distribution = name_weight x the name mass ...
    name_max=0.6,          # ... at most this much
    name_promote=0.15,     # from this mass names rank with the common words (tier 1) and show their written form
    name_cands=6,          # typed groups: this many of the commonest names of exactly the typed length are always rescored ...
    name_margin=2.0,       # ... and a candidate name of the typed length that the transformer scores within this many nats
                           #     of the best ordinary word of that length takes that word's prior and ranks with the common
                           #     words ("I'm" + the code of omer: Omar before she's and ones)
    name_min_len=4,        # ... from this many typed groups on: a short code fits hundreds of short names ("my name is" + the
                           #     code of ver: Yao, Tao before very); never on a message's first word, where the transformer
                           #     likes a name as an opener (dev: "need" became Jeff, "back" Adam)
    prompt_caps=0,         # 1: the rescorer reads the message's i, i'm, i'll as I, I'm, I'll (round 5 dev: short words lost
                           #     first place, can -> can't, a -> an, my -> myself; off)
)
PROFANITY = set("fuck fucking fucked fucker motherfucker shit shitty bullshit cunt bitch asshole arsehole dick cock pussy wanker "
                "bastard nigger nigga faggot retard slut whore twat".split())
# A learned word is refused when any of these is inside it ("fuckingshit"), not only when it is one of them.
PROFANITY_ROOTS = ("fuck", "shit", "cunt", "bitch", "asshole", "arsehole", "motherf", "wanker", "nigg", "fagg", "retard", "slut", "whore", "twat", "pussy", "bastard")
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

EVERYDAY = 3.16e-6         # wordfreq frequency of an everyday word (Zipf 3.5)


def everyday(lex):
    """Common tier-1 words that are not also common names: the words a name never displaces (will, may, the)."""
    return {w for w, f, t, n in zip(lex.words, lex.freq, lex.tier, lex.name_prior) if t == 1 and f >= EVERYDAY and n <= 1e-7}


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
        # The 1e-9 floor is for words wordfreq barely saw; a Wiktionary word keeps its own smaller prior
        # (add_wiktionary.py), so 750,000 of them do not take the rare words' share.
        self.core = np.flatnonzero(~self.lex.added).astype(np.int32)
        self.name_q = self.lex.name_prior / self.lex.name_prior.sum() if self.lex.name_prior.sum() > 0 else self.lex.name_prior
        # Everyday words (tier 1, Zipf 3.5 or more): a capitalised one at the next position is not a name (Yes, The),
        # unless the names give it more than the bare given-name prior (John, Mary, Rose count; The, Will do not).
        self.common = everyday(self.lex)
        self.common_ix = np.array(sorted(self.lex.index[w] for w in self.common), dtype=np.int64)
        self.lifted = {}           # (context, groups) -> names the transformer lifted to the common words (ranked)
        self.name_slot = 0.0
        floored = ~self.is_base & ~self.lex.added
        extra[floored] = np.maximum(extra[floored], 1e-9)
        self.extra_prior = extra / extra.sum()
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
        self.lifted.clear()
        if self.ghost:
            self.ghost.key = None
        self.v0.start_conversation(conv_id)
        if self.rescorer:
            self.rescorer.reset()

    def learnable(self, word):
        """Commit teaches the engine words the lexicon does not know and names that are not everyday words
        (round 5: someone's own name, Omer, outlives the conversation that said it), never other lexicon words
        (history already covers their recency), profanity or junk tokens."""
        i = self.lex.index.get(word)
        known = i is not None and not (self.lex.is_name[i] and self.lex.freq[i] < EVERYDAY)
        return (not known and len(word) > 1 and WORDLIKE.match(word) is not None
                and not any(root in word for root in PROFANITY_ROOTS))

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
        self.lifted.clear()
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
                                  unigram=self.unigram, name_boost=P["name_boost"],
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
        # Round 5: where a name is likely (the rescorer's view of the next word), part of the prior moves to the
        # names, and from name_promote on they rank with the common words. "my name is" -> Okafor, Amal;
        # "my name is very long" still finds "very": the typed groups decide.
        self.name_slot = 0.0
        if self.rescorer is not None and hasattr(self.rescorer, "name_mass") and P["name_weight"] > 0:
            self.name_slot = self.rescorer.name_mass(self.prompt(ctx), self.common)
            lam = min(P["name_max"], P["name_weight"] * self.name_slot)
            if lam > 0:
                p = (1 - lam) * p + lam * self.name_q
                dyn = {w: (1 - lam) * v for w, v in dyn.items()}
        promoted = np.zeros(len(self.lex), dtype=bool)
        if self.name_slot >= P["name_promote"]:
            promoted |= self.lex.is_name
        for w in weights:
            i = self.lex.index.get(w)
            if i is not None and self.lex.tier[i] > 1:
                promoted[i] = True
        display = display_forms(ctx.history, known=lambda w: w in self.lex.names or w not in self.lex.dictionary)
        display.update(self.session_display)
        self._prior_key, self._prior = key, (p, dyn, promoted, display)
        return self._prior

    def prompt(self, ctx):
        message = ctx.message
        if self.params["prompt_caps"]:
            message = ["I" + w[1:] if w == "i" or w.startswith("i'") else w for w in message]
        return self.rescorer.prompt(ctx.history, message)

    def unigram(self, w):
        i = self.lex.index.get(w)
        return float(self.lex.freq[i]) if i is not None else 0.0

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
        if not groups:
            # A next word with nothing typed never needs Wiktionary's 745,000 rare words (round 4) unless the
            # conversation mentioned one; they are reachable from the first typed group on.
            idx = self.core if not promoted.any() else np.flatnonzero(~self.lex.added | promoted).astype(np.int32)
        dyn_words = [w for w in dyn if code_of(w).startswith(groups)]
        probs = p[idx]
        # Only the best top_k need an order here (they go to the rescorer); the final order is set below.
        # A full sort of a next word's 866,000 matches cost 25 ms (round 4).
        K = P["top_k"]
        if len(probs) > 4 * K:
            best = np.argpartition(-probs, K - 1)[:K]
            best = best[np.argsort(-probs[best], kind="stable")]
            rest = np.ones(len(probs), dtype=bool)
            rest[best] = False
            order = np.concatenate([best, np.flatnonzero(rest)])
        else:
            order = np.argsort(-probs, kind="stable")
        idx, probs = idx[order], probs[order]
        K = min(K, len(idx))
        injected = np.zeros(0, dtype=np.int64)
        name_pos = len(groups) >= P["name_min_len"] and P["name_cands"] > 0 and bool(ctx.message)
        if name_pos and self.rescorer is not None and len(idx) > K:
            # A name the n-gram prior has never seen after these words ("I'm" + omer) never reaches the top_k, so
            # the transformer never gets to say that "I'm Omer" makes sense where "I'm ones" does not.
            rest = np.arange(K, len(idx))
            rest = rest[self.lex.is_name[idx[rest]] & (self.lex.lengths[idx[rest]] == len(groups))]
            injected = rest[np.argsort(-self.lex.name_prior[idx[rest]], kind="stable")[:P["name_cands"]]]
            if len(injected):
                keep = np.ones(len(idx), dtype=bool)
                keep[injected] = False
                front = np.concatenate([np.arange(K), injected])
                order2 = np.concatenate([front, np.flatnonzero(keep)[K:]])
                idx, probs = idx[order2], probs[order2]
                K += len(injected)
        words = [self.lex.words[i] for i in idx[:K]] + dyn_words
        cand_p = np.concatenate([probs[:K], np.array([dyn[w] for w in dyn_words])])
        t1 = time.perf_counter()
        neural = None
        lifted = np.zeros(len(idx), dtype=bool)
        if self.rescorer is not None and len(words) > 1 and P["neural_weight"] > 0:
            prompt = self.prompt(ctx)
            neural = self.rescorer.score(prompt, words)
            if name_pos:
                # The n-gram prior says little about a name in a context it has not seen. A candidate name of the
                # typed length that the transformer scores within name_margin of the best ordinary word of that
                # length takes that word's prior and ranks with the common words: "I'm Omar" beats "I'm ones",
                # and "i need a" + the code of stop keeps stop.
                exact = self.lex.lengths[idx[:K]] == len(groups)
                name = self.lex.is_name[idx[:K]] & ~np.isin(idx[:K], self.common_ix)
                plain = exact & ~name
                if plain.any():
                    lifted[:K] = exact & name & (neural[:K] >= neural[:K][plain].max() - P["name_margin"])
                    if lifted.any():
                        cand_p[:K][lifted[:K]] = np.maximum(cand_p[:K][lifted[:K]], cand_p[:K][plain].max())
                else:
                    lifted[:K] = exact & name
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
            # The floor keeps the transformer's order among the words it lifts (round 5: a hard floor tied every
            # exact word after "I'm" + the code of omer at one value, so she's stayed ahead of Omar).
            if len(probs) > K:
                floor = probs[K:].max() * 1.001
                low = new < floor
                if low.any():
                    # Squeezed into [floor, top), below every candidate already above the floor.
                    top = min(float(new[~low].min()), floor * 1.001) if (~low).any() else floor * 1.001
                    new[low] = floor + (top - floor) * 0.999 * new[low] / new[low].max()
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
        head = words                     # the rescored candidates and the conversation's own words, as text
        tail = idx[k:]                   # every other match, as lexicon indices (866k for a next word: never as text)
        all_p = np.concatenate([cand_p, probs[k:]])
        lengths = np.concatenate([self.lex.lengths[idx[:k]], np.array([len(code_of(w)) for w in dyn_words], dtype=np.int32),
                                  self.lex.lengths[tail]])
        # A word of tier 2 or 3 never outranks a tier-1 word unless the conversation mentioned it (a partner or
        # user turn, the message, or a commit); words outside the lexicon come from the conversation by construction.
        lex_tiers = np.where(promoted[idx] | lifted, 1, self.lex.tier[idx]).astype(np.int8)
        tiers = np.concatenate([lex_tiers[:k], np.ones(len(dyn_words), dtype=np.int8), lex_tiers[k:]])
        all_p = self.demote(tiers, all_p)
        if P["savings"] > 0 and groups:
            # Favour completions that save more selections: p * (n - k + 1)^savings, ranking only.
            score = all_p * np.power(np.maximum(lengths - len(groups) + 1, 1), P["savings"])
        else:
            score = all_p
        order = np.lexsort((-score, tiers))
        ranked_words = RankedWords(order, head, tail, self.lex)
        if not groups and ctx.message and len(order) > 1 and ranked_words[0] == ctx.message[-1]:
            all_p[order[0]] = all_p[order[1]] * 0.999
            order[[0, 1]] = order[[1, 0]]
        if self.ghost is not None and len(order) > 1:
            first = self.ghost.rank(ctx, groups)
            if first and first[0] in ranked_words:
                g = ranked_words.position(first[0])
                order = np.concatenate([[g], order[order != g]])
                ranked_words = RankedWords(order, head, tail, self.lex)
        mass = float(all_p.sum())
        result = (ranked_words, all_p[order] / mass if mass > 0 else all_p[order], lengths[order], mass)
        self._ranked[key] = result
        self.lifted[key] = {self.lex.words[i] for i in idx[lifted]}
        if len(self.lifted) > 64:
            self.lifted.pop(next(iter(self.lifted)))
        if len(self._ranked) > 64:
            self._ranked.popitem(last=False)
        self.last_timing = {"prior_ms": 1000 * (t1 - t0), "neural_ms": 1000 * (t2 - t1),
                            **(self.rescorer.last_ms if self.rescorer else {})}
        return result

    def rank(self, ctx, code, n=12):
        """Benchmark contract: best-first list of matching words."""
        return self.ranked(ctx, code)[0][:n]

    # ---- API views ---------------------------------------------------------
    def display(self, word, forms, lifted=()):
        """How the UI should show the word: I and its contractions, names as the conversation wrote them,
        first names the dictionary does not list as common words (priya, not will or may)."""
        if word in forms:
            return forms[word]
        if word == "i" or word.startswith("i'"):
            return "I" + word[1:]
        if word in self.lex.names and word not in self.lex.dictionary:
            return word[0].upper() + word[1:]
        if (word in lifted or self.name_slot >= self.params["name_promote"]) and word in self.lex.name_written and word not in self.common:
            return self.lex.name_written[word]
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
        lifted = self.lifted.get(self._key(ctx) + (groups,), set())
        branch = self.branch(groups, probs, lengths)
        longer = float(probs[lengths > len(groups)].sum()) if len(words) else 0.0
        if complete:
            keep = lengths == len(groups)
            words = words.keep(keep)
            probs, lengths = probs[keep], lengths[keep]
            if len(probs):
                probs = probs / probs.sum()
        total = len(words)
        page = [{"word": w, "p": float(p), "complete": int(n) == len(groups)}
                for w, p, n in zip(words[offset:offset + limit], probs[offset:offset + limit], lengths[offset:offset + limit])]
        if groups and not complete and offset == 0 and total > limit:
            # The best two whole words always reach the first page, after it: when completions fill the page
            # ("I'm" + the code of omer: sharing, smart, ...), the screen still sees the rival of the whole word it
            # shows and opens Options (Omar, Omer) instead of hiding Omer behind Other words.
            on_page = sum(1 for item in page if item["complete"])
            if on_page < 2:
                whole = np.flatnonzero(lengths == len(groups))
                for j in whole[whole >= limit][: 2 - on_page]:
                    page.append({"word": words[int(j)], "p": float(probs[j]), "complete": True})
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
        promoted = self.prior(ctx)[2]
        for item in page:
            item["p"] = round(item["p"], 6)
            shown = self.display(item["word"], forms, lifted)
            if shown != item["word"]:
                item["display"] = shown
            # Round 4: a word of tier 2 or 3 the conversation never mentioned. When the best the engine can
            # offer is such a word, the UI may open Options (with Spell) rather than show it in Q1.
            i = self.lex.index.get(item["word"])
            if i is not None and self.lex.tier[i] > 1 and not promoted[i] and item["word"] not in lifted:
                item["rare"] = True
        return {"groups": groups, "words": page, "total": total, "longer": round(longer, 6), "branch": branch, "name": round(self.name_slot, 4)}

    def predict_v0(self, history, message, groups=""):
        """The v0 /api/predict shape for s0: likely, choose, short, ghost, candidates."""
        groups = "".join(ch for ch in str(groups) if ch in "1234")
        ctx = self.context(history, message)
        words, probs, lengths, _ = self.ranked(ctx, groups)
        likely = words[:12]
        exact = [w for w, n in zip(words[:200], lengths[:200]) if n == len(groups)]
        choose = list(dict.fromkeys(likely[:1] + exact + words[1:200]))[:12]
        lo, hi = max(len(groups), 1), max(len(groups), 1) + 2
        fit = np.flatnonzero((lengths >= lo) & (lengths <= hi))[:8]
        short = [words[int(i)] for i in fit]
        return {"likely": likely, "choose": choose, "short": short,
                "ghost": likely[0] if likely else "", "candidates": likely}

    def punctuate(self, history, message, pause=lambda: None):
        """The message written as a sentence with punctuation, for the voice (NAT-38, engine/punctuate.py). `pause` is
        called between its steps so a waiting prediction can go first (NAT-52)."""
        if getattr(self, "punctuator", None) is None:
            from .punctuate import Punctuator
            self.punctuator = Punctuator(self, self.params.get("punctuate"))
        return self.punctuator.punctuate(history, message, pause)

    def close(self):
        self.v0.close()


class RankedWords:
    """The ranked words of one request, read lazily: position i is `head[j]` for the first len(head)
    candidates (the rescored ones and the conversation's words) and the lexicon word `tail[j - len(head)]`
    after them, with j = order[i]. A next-word list holds every word of the lexicon; making 866,000
    strings for a page of eight cost a second per request (round 4)."""

    def __init__(self, order, head, tail, lex):
        self.order, self.head, self.tail, self.lex = order, head, tail, lex

    def _word(self, j):
        j = int(j)
        return self.head[j] if j < len(self.head) else self.lex.words[int(self.tail[j - len(self.head)])]

    def __len__(self):
        return len(self.order)

    def __getitem__(self, i):
        if isinstance(i, slice):
            return [self._word(j) for j in self.order[i]]
        return self._word(self.order[i])

    def __iter__(self):
        return (self._word(j) for j in self.order)

    def position(self, word):
        """Index into the unordered candidates (head, then tail) of `word`, or None."""
        if word in self.head:
            return self.head.index(word)
        i = self.lex.index.get(word)
        if i is None:
            return None
        hit = np.flatnonzero(self.tail == i)
        return len(self.head) + int(hit[0]) if len(hit) else None

    def index(self, word):
        j = self.position(word)
        hit = np.flatnonzero(self.order == j) if j is not None else []
        if not len(hit):
            raise ValueError(f"{word!r} is not ranked")
        return int(hit[0])

    def __contains__(self, word):
        return self.position(word) is not None

    def keep(self, mask):
        """The words at the positions where `mask` (over this ranking) is true, in the same order."""
        return RankedWords(self.order[np.asarray(mask, dtype=bool)], self.head, self.tail, self.lex)

    def __eq__(self, other):
        return list(self) == list(other)
