"""Simulate the s6 UI on harness records to tune the `branch` rule.

  harness.py run ... writes, per word and per typed length k, the top-2 probabilities, whether each
  is a complete word, the summed probability of longer words, and the target's rank among the
  complete words at the full code. This script replays every rule on those records:

  - Q1 shows words[0]; accepting costs k+1 selections.
  - Q4 shows words[1] only when the rule says branch (k >= 1); otherwise Q4 is Delete. Accepting
    words[1] also costs k+1. Hiding Delete costs nothing in this error-free replay, so the share of
    typed states where Delete is hidden is reported next to the cost.
  - A person who has typed the whole code (k = n) and still does not see the word opens "Other
    words" (accept + Done + Other words = 3 selections), which pages the complete words four per
    page (+1 per extra page), then picks (+1). A word not in that list costs the frozen spelling
    fallback 2n + 5.

  ../v0/.venv/bin/python bench/branch_sim.py RUN_NAME [--splits aac_dev,dd_dev] [--grid] [--rule 1,0.25,0]
"""
import argparse
import itertools
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import DEV, fallback, records  # noqa: E402

PAGE = 4


def branch(top, k, min_k, ratio, complete):
    p0, p1, c0, c1, _ = top
    if k < min_k or p1 is None or p0 is None or p0 <= 0 or p1 / p0 < ratio:
        return False
    if complete >= 1 and not c1:
        return False
    if complete >= 2 and not c0:
        return False
    return True


def word_cost(rec, rule):
    """(selections, typed states seen, states with Delete hidden, resolved by: ghost|branch|other|spell)."""
    min_k, ratio, complete = rule
    n = rec["n"]
    ranks, tops = rec["ranks"], rec["top"]
    seen = hidden = 0
    for k in range(n + 1):
        if k >= 1:
            seen += 1
        b = k >= 1 and branch(tops[k], k, min_k, ratio, complete)
        if b:
            hidden += 1
        if ranks[k] == 0:
            return k + 1, seen, hidden, "q1"
        if b and ranks[k] == 1:
            return k + 1, seen, hidden, "branch"
    rc = rec["rank_complete"]
    if rc is None:
        return fallback(n), seen, hidden, "spell"
    return n + 3 + rc // PAGE + 1, seen, hidden, "other"


def evaluate(recs_by_split, rule):
    out = {"rule": {"min_k": rule[0], "ratio": rule[1], "complete": rule[2]}}
    spw, hid = [], []
    how = {"q1": 0, "branch": 0, "other": 0, "spell": 0}
    for split, recs in recs_by_split.items():
        total = seen = hidden = 0
        for r in recs:
            c, s, h, w = word_cost(r, rule)
            total += c
            seen += s
            hidden += h
            how[w] += 1
        out[split] = {"spw": total / len(recs), "delete_hidden": hidden / max(seen, 1), "words": len(recs)}
        spw.append(total / len(recs))
        hid.append(hidden / max(seen, 1))
    out["spw"] = sum(spw) / len(spw)
    out["delete_hidden"] = sum(hid) / len(hid)
    out["resolved"] = how
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run")
    ap.add_argument("--splits", default=",".join(DEV))
    ap.add_argument("--grid", action="store_true")
    ap.add_argument("--rule", default=None, help="min_k,ratio,complete")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    recs = {s: [r for r in records(a.run, s) if r.get("top")] for s in a.splits.split(",")}
    recs = {s: v for s, v in recs.items() if v}
    if not recs:
        raise SystemExit("no records with top-2 probabilities; rerun the harness")
    rows = []
    if a.rule:
        mk, ra, co = a.rule.split(",")
        rows.append(evaluate(recs, (int(mk), float(ra), int(co))))
    else:
        ratios = [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.01]
        for min_k, ratio, complete in itertools.product((1, 2, 3), ratios, (0, 1, 2)):
            rows.append(evaluate(recs, (min_k, ratio, complete)))
    rows.sort(key=lambda r: (r["spw"], r["delete_hidden"]))
    never = evaluate(recs, (1, 1.01, 0))
    always = evaluate(recs, (1, 0.0, 0))
    print(f"never branch (Q4 always Delete): spw {never['spw']:.4f}; always branch (top-2 while typing): "
          f"spw {always['spw']:.4f}, Delete hidden {always['delete_hidden']:.1%}")
    print(f"{'min_k':>5} {'ratio':>5} {'compl':>5} {'spw':>8} {'hidden':>7} {'q1':>6} {'branch':>6} {'other':>6} {'spell':>5}")
    # Pareto front: cheaper than everything that hides Delete less often
    front = []
    best = float("inf")
    for r in sorted(rows, key=lambda r: r["delete_hidden"]):
        if r["spw"] < best - 1e-9:
            front.append(r)
            best = r["spw"]
    for r in front:
        h = r["resolved"]
        print(f"{r['rule']['min_k']:>5} {r['rule']['ratio']:>5.2f} {r['rule']['complete']:>5} {r['spw']:>8.4f} "
              f"{r['delete_hidden']:>7.1%} {h['q1']:>6} {h['branch']:>6} {h['other']:>6} {h['spell']:>5}")
    if a.out:
        Path(a.out).write_text(json.dumps({"run": a.run, "never": never, "always": always, "front": front, "all": rows}, indent=2) + "\n")


if __name__ == "__main__":
    main()
