"""Replay the s6 UI with Q1 Options on harness records (owner, 2026-11-08): when the two best words are both
whole words and p1/p0 >= ratio, Q1 reads Options; a person who finished the word opens it (1) and picks from
pages of four (+1 per page, +1 pick). Mid-word they keep typing. Prints the baseline and the cheapest rules.

  ../v0/.venv/bin/python bench/options_sim.py RUN_NAME
"""
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import DEV, fallback, records
PAGE = 4

def fires(top, k, ratio, need_c1, p0_max):
    p0, p1, c0, c1, _ = top
    if not c0 or p0 is None:
        return False
    if p0 > p0_max:
        return False
    if p1 is None or p0 <= 0:
        return False
    if need_c1 and not c1:
        return False
    return p1 / p0 >= ratio

def cost(rec, rule, mode):
    n, ranks, tops, rc = rec["n"], rec["ranks"], rec["top"], rec["rank_complete"]
    shown = 0
    for k in range(n + 1):
        f = mode == "options" and k >= 1 and fires(tops[k], k, *rule)
        if f:
            shown += 1
            if k == n:
                return (n + 2 + rc // PAGE if rc is not None else fallback(n)), shown, f
            continue
        if ranks[k] == 0:
            return k + 1, shown, False
    if rc is None:
        return fallback(n), shown, False
    return n + 3 + rc // PAGE + 1, shown, False

def run(recs, rule, mode):
    spw, share = [], []
    for s, rs in recs.items():
        tot = sh = st = 0
        for r in rs:
            c, shown, _ = cost(r, rule, mode)
            tot += c; sh += shown; st += r["n"]
        spw.append(tot / len(rs)); share.append(sh / st)
    return sum(spw) / len(spw), sum(share) / len(share), spw

run_name = sys.argv[1]
recs = {s: [r for r in records(run_name, s) if r.get("top")] for s in DEV}
base = run(recs, (1, 0, 1), "none")
print(f"baseline (Q1 word, Q4 Delete, no branch): spw {base[0]:.4f} {['%.4f'%x for x in base[2]]}")
rows = []
for ratio, need_c1, p0_max in itertools.product([0, 1e-6, 1e-5, 1e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.2, 0.3, 0.5], (0, 1), (1.01, 0.999, 0.99, 0.95, 0.9, 0.8, 0.7)):
    s, sh, per = run(recs, (ratio, need_c1, p0_max), "options")
    rows.append((s, sh, ratio, need_c1, p0_max, per))
rows.sort()
for r in rows[:15]:
    print(f"spw {r[0]:.4f} options-shown {r[1]:.1%} ratio {r[2]:g} need_c1 {r[3]} p0_max {r[4]} per-split {['%.4f'%x for x in r[5]]}")
