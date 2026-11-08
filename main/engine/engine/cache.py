"""Pointer cache over the conversation: words that were said are likely to be said again.

Continuous-cache idea (Grave et al. 2016; Merity et al. 2016 pointer sentinel): a distribution
over the words seen in context, weighted by recency, mixed with the model. Here the weights are
per turn (decay per turn of age), per speaker, and damped for very frequent words so "the" in the
partner's turn does not get the same boost as "restaurant".
"""
import re
from collections import Counter

from wordpred.context import words_of

RAW = re.compile(r"[A-Za-z][A-Za-z']*")


def name_like(text, unigram=None, common=5e-5, known=None):
    """Capitalised, uncommon tokens that do not start a sentence: a proper-noun cue. A sentence-initial
    token counts only when `known` says it is a first name or outside the lexicon ("Marcus called.")."""
    out = set()
    for m in RAW.finditer(text):
        tok = m.group()
        if not (tok[0].isupper() and tok[1:].islower() and len(tok) > 1):
            continue
        w = tok.lower().replace("\u2019", "'")
        before = text[:m.start()].rstrip()
        if not before or before[-1] in ".!?":
            if known is None or not known(w):
                continue
        if unigram is None or unigram(w) < common:
            out.add(w)
    return out


def display_forms(history, known=None):
    """{lower word: Capitalised form} for words the conversation wrote with a capital that are names by the
    name_like rule (mid-sentence capitals, or sentence-initial ones `known` as names). Later turns win."""
    out = {}
    for _, text in history:
        text = text.replace("’", "'")
        names = name_like(text, known=known)
        for m in RAW.finditer(text):
            tok = m.group()
            if tok[0].isupper() and tok[1:].islower() and tok.lower() in names:
                out[tok.lower()] = tok
    return out


def context_weights(history, message, session, *, decay=0.7, partner=1.0, user=0.5,
                    in_message=0.15, session_weight=0.3, idf_floor=2e-4, unigram=None, name_boost=2.0, known_name=None):
    """Return {word: weight}. `session` is a Counter of words accepted with commit this session."""
    weights = Counter()
    for age, (role, text) in enumerate(reversed(history)):
        base = (partner if role == "partner" else user) * (decay ** age)
        if base < 1e-3:
            break
        seen = Counter(words_of(text))
        for w, c in list(seen.items()):
            if w.endswith("'s") and len(w) > 3:        # Nkechi's coat -> nkechi too
                seen[w[:-2]] += c
        names = name_like(text.replace("\u2019", "'"), unigram, known=known_name) if name_boost != 1.0 else set()
        for w, c in seen.items():
            stem = w[:-2] if w.endswith("'s") else w
            weights[w] += base * min(c, 3) * (name_boost if (w in names or stem in names) else 1.0)
    for w in set(message):
        weights[w] += in_message
    for w, c in session.items():
        weights[w] += session_weight * min(c, 5)
    if unigram is not None and idf_floor:
        for w in list(weights):
            f = unigram(w)
            if f > idf_floor:
                weights[w] *= idf_floor / f
    return weights
