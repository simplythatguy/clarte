"""Coverage over every word in the shipped lexicon.

(a) reachability: full group code, no context -> rank of the word in the paged list
    (one prior distribution, so this is exact and fast for all words).
(b) context: the partner's last turn mentions the word; the full code is typed; is it top 2?
    Runs through the real engine (rescorer included). `--templates N` chooses how many of the
    templates run over every word; `--sample K` runs on a deterministic K-word sample instead.
(c) names not in the lexicon, mentioned by the partner, must be top 2 at full code.
(d) a committed word is learned for the session.

  .venv/bin/python coverage.py [--sample 5000] [--templates 1] [--rescorer auto] --out coverage.json
"""
import argparse
import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

V1 = Path(__file__).resolve().parent
sys.path.insert(0, str(V1))
from engine import Engine  # noqa: E402
from wordpred.context import Context, code_of  # noqa: E402

TEMPLATES = ["Did you say {w}?", "I was talking to {w} yesterday.", "{w} is the word."]
NAMES = ["Priya", "Jev", "Okonkwo", "Zorvella", "Xandrel", "Thandiwe", "Bartholomew", "Siobhan", "Nkechi", "Yusuf"]


def reachability(engine, exact=False):
    """Rank of every word at its full code with no context. `exact` walks each distinct code through
    engine.ranked (rescoring included); otherwise the prior order is used (identical beyond the top 24)."""
    ctx = engine.context([], [])
    engine.start_conversation("reach")
    p = engine.prior(ctx)[0]
    lex = engine.lex
    ranks = np.zeros(len(lex), dtype=np.int32)
    ranks_complete = np.zeros(len(lex), dtype=np.int32)     # rank among complete words only (the "Other words" chooser)
    codes = tier_violations = 0
    for code, full in lex.prefix.full_codes():          # every distinct whole-word code and its words
        idx = lex.matching(code)
        codes += 1
        if exact:
            words, _, lengths, _ = engine.ranked(ctx, code)
            pos = {w: r for r, w in enumerate(words)}
            posc = {w: r for r, w in enumerate(w for w, n in zip(words, lengths) if n == len(code))}
            tiers = lex.tier[[lex.index[w] for w in words]]
            for i in full:
                ranks[i] = pos[lex.words[i]]
                ranks_complete[i] = posc[lex.words[i]]
        else:
            order = idx[np.lexsort((-engine.demote(lex.tier[idx], p[idx]), lex.tier[idx]))]
            pos = {int(i): r for r, i in enumerate(order)}
            posc = {int(i): r for r, i in enumerate(j for j in order if lex.lengths[j] == len(code))}
            tiers = lex.tier[order]
            for i in full:
                ranks[i] = pos[int(i)]
                ranks_complete[i] = posc[int(i)]
        # without context the list must be sorted by tier: no tier-2 word before a tier-1 word
        tier_violations += int((np.diff(tiers) < 0).any())
    hist, histc = Counter(), Counter()
    for r in ranks:
        hist["top1" if r == 0 else "top2" if r == 1 else "page2-5 (rank 2-9)" if r < 10 else "rank 10-49" if r < 50 else "rank 50+"] += 1
    for r in ranks_complete:
        histc["page1 (rank 0-2)" if r < 3 else "page2" if r < 6 else "pages 3-5" if r < 15 else "pages 6-13" if r < 39 else "page 14+"] += 1
    worst = sorted(((int(r), lex.words[i]) for i, r in enumerate(ranks)), reverse=True)[:10]
    tier1 = lex.tier == 1
    by_tier = {f"tier{t}": {"words": int((lex.tier == t).sum()),
                            "chooser_page1": int(((lex.tier == t) & (ranks_complete < 3)).sum()),
                            "chooser_mean_rank": float(ranks_complete[lex.tier == t].mean()) if (lex.tier == t).any() else None}
               for t in (1, 2, 3)}
    return {"words": len(lex), "codes": codes, "exact": exact, "distribution": dict(hist), "beyond_top2": int((ranks >= 2).sum()),
            "mean_rank": float(ranks.mean()), "p95_rank": float(np.percentile(ranks, 95)), "worst": worst,
            "reachable": int(len(lex)), "tier_order_violations": tier_violations, "by_tier": by_tier,
            "complete_only": {"distribution": dict(histc), "mean_rank": float(ranks_complete.mean()),
                              "p95_rank": float(np.percentile(ranks_complete, 95)), "beyond_page1": int((ranks_complete >= 4).sum()),
                              "tier1_beyond_page1": int((tier1 & (ranks_complete >= 4)).sum())}}


def context_test(engine, words, templates):
    fails, hits, n, t0 = [], Counter(), 0, time.perf_counter()
    for w in words:
        code = code_of(w)
        for t in templates:
            engine.start_conversation("coverage")
            text = t.format(w=w[0].upper() + w[1:]) if t.startswith("{w}") else t.format(w=w)
            ctx = engine.context([["partner", text]], [])
            ranked = engine.ranked(ctx, code)[0]
            r = ranked.index(w) if w in ranked[:50] else None
            n += 1
            if r == 0:
                hits["top1"] += 1
            elif r == 1:
                hits["top2"] += 1
            else:
                fails.append({"word": w, "template": t, "rank": r, "top": ranked[:3]})
    return {"checks": n, "top1": hits["top1"], "top2": hits["top1"] + hits["top2"], "fail": len(fails),
            "top2_rate": (hits["top1"] + hits["top2"]) / max(n, 1), "failures": fails, "seconds": time.perf_counter() - t0}


def names_test(engine):
    rows = []
    for name in NAMES:
        w = name.lower()
        for t in TEMPLATES:
            engine.start_conversation("names")
            ctx = engine.context([["partner", t.format(w=name)]], ["i", "like"])
            ranked = engine.ranked(ctx, code_of(w))[0]
            rows.append({"name": name, "in_lexicon": w in engine.lex.index, "template": t,
                         "rank": ranked.index(w) if w in ranked[:50] else None, "top": ranked[:2]})
    return {"checks": len(rows), "top2": sum(r["rank"] in (0, 1) for r in rows), "rows": rows}


def commit_test(engine):
    rows = []
    for name in NAMES:
        engine.start_conversation("commit")
        w = name.lower()
        engine.commit(w)
        ranked = engine.ranked(engine.context([], []), code_of(w))[0]
        rows.append({"word": w, "rank": ranked.index(w) if w in ranked[:50] else None})
    return {"checks": len(rows), "top2": sum(r["rank"] in (0, 1) for r in rows), "rows": rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", type=int, default=0, help="0 = every word")
    ap.add_argument("--templates", type=int, default=1)
    ap.add_argument("--rescorer", default="auto")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--out", default=str(V1 / "bench" / "results" / "coverage.json"))
    ap.add_argument("--shard", default=None, help="i/n over the word list (context test only)")
    ap.add_argument("--exact", action="store_true", help="reachability through engine.ranked (rescoring included)")
    a = ap.parse_args()
    engine = Engine(rescorer=None if a.rescorer == "none" else a.rescorer, threads=a.threads)
    words = list(engine.lex.words)
    if a.sample:
        words = random.Random(0).sample(words, a.sample)
    if a.shard:
        i, n = (int(x) for x in a.shard.split("/"))
        words = words[i::n]
    report = {"lexicon": len(engine.lex), "rescorer": engine.rescorer_name, "sample": a.sample, "shard": a.shard}
    if not a.shard or a.shard.startswith("0/"):
        report["reachability"] = reachability(engine, a.exact)
        report["names"] = names_test(engine)
        report["commit"] = commit_test(engine)
    report["context"] = context_test(engine, words, TEMPLATES[:a.templates])
    Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    short = {k: (v if k != "context" else {kk: vv for kk, vv in v.items() if kk != "failures"}) for k, v in report.items()}
    print(json.dumps(short, indent=2))
    reach = report.get("reachability")
    if reach and (reach["reachable"] != reach["words"] or reach["tier_order_violations"]):
        print("FAIL: a word is unreachable or a tier-2 word precedes a tier-1 word without context", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
