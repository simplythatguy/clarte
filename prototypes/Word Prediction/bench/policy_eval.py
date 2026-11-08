"""Replay s6 screen policies over cached engine answers (bench/policy_cache.py) and score each (round 4).

A policy decides, after k typed groups, what Q1 shows (a word, Options) and whether Q4 shows a word instead
of Delete. The person who knows their word takes the first route that produces it:
  the word in Q1 or Q4 after k groups      k + 1 looks
  Options at the full code                  n + 2 + page, or Spell from its Q4: n + 2 + letters
  Spell in Q1 (nothing matches)             n + 1 + letters
  another word in Q1: Other words           n + 4 + page, or Spell from its Q4: n + 4 + letters
(page = chooser rank // 3; letters = Spell's looks, s6 spell.ts ranking). Scores: mean looks on the usage
sample (dev conversations) and on the matrix (every kind of word), how many matrix words cost more than
spelling from scratch (n + 1 + letters), and the share of typed states where Q4 hides Delete.

  ../v0/.venv/bin/python bench/policy_eval.py CACHE_JSON LETTERS_JSON
"""
import argparse
import itertools
import json
import statistics
from collections import defaultdict

PAGE = 3


def whole(w):
    return w["complete"] and not w.get("corrected")


def decide(page, k, P):
    """(shown index or None, options?, Q4 word or None) for the first page after k typed groups."""
    words = page["words"]
    if not words:
        return None, False, None
    if k == 0:
        return 0, False, None
    shown = 0
    if not words[0]["complete"]:
        ex = next((i for i, w in enumerate(words) if whole(w)), None)
        if ex is not None and words[ex]["p"] >= P["exact"](k) * words[0]["p"]:
            shown = ex
    a = words[shown]
    q4 = None
    if page.get("branch") and len(words) > 1:
        q4 = words[1]["word"]
    elif P["q4_exact"] is not None and not whole(a):
        ex = next((i for i, w in enumerate(words) if whole(w)), None)
        if ex is not None and words[ex]["p"] >= P["q4_exact"] * a["p"]:
            q4 = words[ex]["word"]
    opts = False
    if q4 is None and whole(a) and a["p"] > 0:
        if P.get("next_whole") is None or P.get("keep_top_two"):
            if shown == 0 and len(words) > 1 and whole(words[1]) and words[1]["p"] >= P["ratio"] * a["p"]:
                opts = True
        if P.get("next_whole") is not None:
            # the next whole word below the one Q1 would show, at the loose ratio
            nxt = next((w for i, w in enumerate(words) if i > shown and whole(w)), None)
            if nxt is not None and nxt["p"] >= P["next_whole"] * a["p"]:
                opts = True
        if any(i != shown and whole(w) and w["p"] >= P["rival"] * a["p"] for i, w in enumerate(words)):
            opts = True
    if q4 is None and P["rare_options"] and a.get("rare") and k >= P["rare_from"]:
        opts = True
    if q4 is None and P.get("unsure") and whole(a) and a["p"] < P["unsure"] and k >= P.get("unsure_from", 1):
        opts = True
    return shown, opts, q4


def cost(item, letters, P):
    n, word = item["n"], item["word"]
    hidden = 0
    for k, page in enumerate(item["pages"]):
        shown, opts, q4 = decide(page, k, P)
        if q4 is not None:
            hidden += 1
        if shown is not None and not opts and page["words"][shown]["word"] == word:
            return k + 1, hidden, k
        if q4 == word:
            return k + 1, hidden, k
    r = item["chooser"].index(word) if word in item["chooser"] else None
    if not item["pages"][-1]["words"]:
        return n + 1 + letters, hidden, n
    if opts:
        return min(n + 2 + r // PAGE if r is not None else 10 ** 6, n + 2 + letters), hidden, n
    return min(n + 4 + r // PAGE if r is not None else 10 ** 6, n + 4 + letters), hidden, n


def score(cache, letters, P):
    use = [cost(it, letters[it["word"]], P) for it in cache["usage"]]
    mat = [(it, cost(it, letters[it["word"]], P)) for it in cache["matrix"]]
    dear = [(it, c) for it, c in mat if c[0] > it["n"] + 1 + letters[it["word"]]]
    states = sum(it["n"] for it in cache["usage"])
    by_bucket = defaultdict(list)
    for it, c in mat:
        by_bucket[it["bucket"]].append(c[0] > it["n"] + 1 + letters[it["word"]])
    return {
        "usage": statistics.mean(c[0] for c in use),
        "matrix": statistics.mean(c[0] for _, c in mat),
        "dearer": len(dear),
        "hidden": sum(c[1] for c in use) / max(states, 1),
        "buckets": {b: sum(v) for b, v in by_bucket.items()},
        "dear_examples": [(it["bucket"], it["context"], it["word"], c[0], it["n"] + 1 + letters[it["word"]]) for it, c in dear[:30]],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cache")
    ap.add_argument("letters")
    ap.add_argument("--show", default=None, help="print the dearer examples of this policy label")
    a = ap.parse_args()
    cache = json.load(open(a.cache))
    letters = json.load(open(a.letters))
    current = {"exact": lambda k: 0.1, "ratio": 1e-4, "rival": 0.3, "q4_exact": None, "rare_options": False, "rare_from": 1}
    variants = {"current (round 4 s6)": current}
    for short, rival, rare, rare_from in itertools.product((0.1, 0.02, 0.005, 0.0), (0.3, 0.1, 0.03), (False, True), (1, 2, 3)):
        if not rare and rare_from > 1:
            continue
        P = dict(current, exact=(lambda s: (lambda k: s if k <= 3 else 0.1))(short), rival=rival, rare_options=rare, rare_from=rare_from)
        variants[f"exact<=3 {short}, rival {rival}, rare→Options {rare}{f' from {rare_from}' if rare else ''}"] = P
    for x in (0.05, 0.1):
        variants[f"current + Q4 exact word at {x}"] = dict(current, q4_exact=x)
    rows = sorted(((label, score(cache, letters, P)) for label, P in variants.items()), key=lambda r: (r[1]["dearer"], r[1]["usage"]))
    base = score(cache, letters, current)
    print(f"{'policy':58}{'usage looks':>12}{'matrix looks':>13}{'dearer':>8}{'Q4 hides Delete':>17}")
    for label, s in [("current (round 4 s6)", base)] + rows[:25]:
        print(f"{label:58}{s['usage']:>12.4f}{s['matrix']:>13.3f}{s['dearer']:>8}{s['hidden']:>16.1%}")
    if a.show:
        s = dict(rows)[a.show] if a.show in dict(rows) else base
        print("\nbuckets:", s["buckets"])
        for e in s["dear_examples"]:
            print("  ✗", e)


if __name__ == "__main__":
    main()
