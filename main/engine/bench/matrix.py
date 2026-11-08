"""The word matrix: every route the s6 screen offers, replayed against the live engine for words of every
kind, and the cheapest route compared with spelling the word from scratch (round 4).

For each word and context it walks the typed groups as s6 does (policy.ts and conflict.ts: exact length
first at 0.03, the branch, Options when the top two are whole words at 1e-4, the next whole word below the
one shown reaches 0.01 of it, or a whole rival reaches 0.3)
and takes the first route that produces the word:
  Q1 or Q4 after k groups                 k + 1 looks (k = 0: the next word, before typing)
  Options at the full code                n + 1 + page + 1, or Spell from its Q4: n + 2 + letters
  Spell in Q1 (nothing matches)           n + 1 + letters
  another word in Q1: Other words         n + 3 + page + 1, or Spell from its Q4: n + 4 + letters
`letters` is the looks Spell needs (s6 spell.ts ranking, three a page), from a JSON file the matrix's
node step writes. A word fails when no route produces it or when its cost exceeds spelling from scratch
(n + 1 + letters).

  .venv/bin/python bench/matrix.py WORDS_JSON SPELL_JSON [--port 8766] [--out bench/results/matrix.json]
"""
import argparse
import json
import statistics
import time
import urllib.request
from collections import defaultdict

CONTEXTS = {
    "first word": ([], []),
    "mid-sentence": ([], ["i", "think", "the"]),
    "reply": ([["partner", "What did you want to tell me?"]], ["i", "wanted", "to", "say"]),
}
GROUP = {**{c: "1" for c in "abcdef"}, **{c: "2" for c in "ghijklmn"}, **{c: "3" for c in "opqrs"}, **{c: "4" for c in "tuvwxyz"}}
PAGE = 3


def code(w):
    return "".join(GROUP[c] for c in w if c in GROUP)


class Engine:
    def __init__(self, port):
        self.url = f"http://127.0.0.1:{port}/api/v1/predict"
        self.ms = []

    def predict(self, history, message, groups, **extra):
        body = json.dumps({"history": history, "message": message, "groups": groups, "limit": 8, **extra}).encode()
        t = time.perf_counter()
        r = json.load(urllib.request.urlopen(urllib.request.Request(self.url, data=body, headers={"content-type": "application/json"})))
        self.ms.append(1000 * (time.perf_counter() - t))
        return r


def q1_of(d, typed):
    """(shown word or None, options?, branch second word or None), as s6 decides them."""
    words = [w for w in d["words"]]
    if not words:
        return None, False, None
    shown = 0
    if typed and not words[0]["complete"]:
        ex = next((i for i, w in enumerate(words) if w["complete"] and not w.get("corrected")), None)
        if ex is not None and words[ex]["p"] >= 0.03 * words[0]["p"]:
            shown = ex
    a = words[shown]
    branch = words[1]["word"] if typed and d.get("branch") and len(words) > 1 else None
    opts = False
    if typed and not branch and a["complete"] and not a.get("corrected") and a["p"] > 0:
        whole = lambda w: w["complete"] and not w.get("corrected")
        if shown == 0 and len(words) > 1 and whole(words[1]) and words[1]["p"] >= 1e-4 * a["p"]:
            opts = True
        below = next((w for i, w in enumerate(words) if i > shown and whole(w)), None)
        if below is not None and below["p"] >= 0.01 * a["p"]:
            opts = True
        if any(i != shown and whole(w) and w["p"] >= 0.3 * a["p"] for i, w in enumerate(words)):
            opts = True
    return a["word"], opts, branch


def chooser_rank(engine, history, message, groups, word):
    d = engine.predict(history, message, groups, complete=True, limit=64)
    ws = [w["word"] for w in d["words"]]
    if word in ws:
        return ws.index(word)
    if d["total"] > 64:
        d = engine.predict(history, message, groups, complete=True, limit=64, offset=64)
        ws = [w["word"] for w in d["words"]]
        if word in ws:
            return 64 + ws.index(word)
    return None


def cost(engine, history, message, word, letters):
    c = code(word)
    n = len(c)
    spell_from_scratch = n + 1 + letters
    for k in range(0, n + 1):
        d = engine.predict(history, message, c[:k])
        shown, opts, branch = q1_of(d, k > 0)
        if not opts and shown == word:
            return k + 1, f"Q1 after {k}", spell_from_scratch
        if branch == word:
            return k + 1, f"Q4 after {k}", spell_from_scratch
    if not d["words"]:
        return n + 1 + letters, "Spell", spell_from_scratch
    r = chooser_rank(engine, history, message, c, word)
    if opts:
        best = min(n + 2 + r // PAGE if r is not None else 10 ** 6, n + 2 + letters)
        return best, "Options" if r is not None and n + 2 + r // PAGE <= n + 2 + letters else "Options → Spell", spell_from_scratch
    best = min(n + 4 + r // PAGE if r is not None else 10 ** 6, n + 4 + letters)
    return best, "Other words" if r is not None and n + 4 + r // PAGE <= n + 4 + letters else "Other words → Spell", spell_from_scratch


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("words")
    ap.add_argument("spell")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--out", default="bench/results/matrix.json")
    a = ap.parse_args()
    buckets = json.load(open(a.words))
    spell = json.load(open(a.spell))
    engine = Engine(a.port)
    rows, summary = [], defaultdict(lambda: defaultdict(list))
    for bucket, words in buckets.items():
        for word in words:
            for ctx, (history, message) in CONTEXTS.items():
                looks, route, scratch = cost(engine, history, message, word, spell[word])
                rows.append({"bucket": bucket, "context": ctx, "word": word, "looks": looks, "route": route, "spell": scratch,
                             "fail": looks > scratch})
                summary[bucket]["looks"].append(looks)
                summary[bucket]["spell"].append(scratch)
                summary[bucket]["fail"].append(looks > scratch)
                summary[bucket]["routes"].append(route.split(" after")[0])
    print(f"{'bucket':38}{'words':>6}{'looks/word':>11}{'spell/word':>11}{'dearer than spelling':>22}  routes")
    for bucket, s in summary.items():
        routes = defaultdict(int)
        for r in s["routes"]:
            routes[r] += 1
        print(f"{bucket:38}{len(s['looks']) // len(CONTEXTS):>6}{statistics.mean(s['looks']):>11.2f}{statistics.mean(s['spell']):>11.2f}"
              f"{sum(s['fail']):>14} of {len(s['fail']):<5}  {dict(routes)}")
    fails = [r for r in rows if r["fail"]]
    ms = sorted(engine.ms)
    print(f"\n{len(rows)} word-contexts, {len(fails)} dearer than spelling; requests {len(ms)}, p50 {ms[len(ms)//2]:.0f} ms, p95 {ms[int(len(ms)*.95)]:.0f} ms, max {ms[-1]:.0f} ms")
    for r in fails[:40]:
        print(f"  ✗ [{r['bucket']} / {r['context']}] {r['word']}: {r['looks']} looks by {r['route']} > spelling {r['spell']}")
    json.dump({"rows": rows, "latency_ms": {"p50": ms[len(ms)//2], "p95": ms[int(len(ms)*.95)], "max": ms[-1], "n": len(ms)}}, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
