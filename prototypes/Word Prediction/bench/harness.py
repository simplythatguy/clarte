"""Dev/test harness: runs v0 or v1 over the frozen splits and scores two policies.

  harness.py run --system v1|v0 --name NAME [--splits aac_dev,dd_dev] [--convs N] [--shard i/n]
                 [--rescorer auto|smol135-ft|qwen2.5-0.5b|none] [--params '{"top_k": 24}'] [--threads 3]
  harness.py summary NAME [--splits ...]
  harness.py compare NAME_A NAME_B [--metric ui|ghost|full|top1_next|top2_full] [--splits ...]

Per word, after k = 0..n typed groups, the rank of the target in the list the system shows.
UI policy (this product): accept at the first k where the target is top-1, or top-2 when k >= 1,
costing k+1 selections; otherwise type all n groups and page two at a time: n + rank//2 + 1;
a word not in the list at all costs the frozen fallback 2n+5. Ghost policy and chooser costs are
copied from the frozen research benchmark (bench/bench.py, PAGE=4, MAX_PAGES=3) for comparison.
The data, tokenizer and cost functions are the frozen benchmark's; the harness only adds the UI policy.
"""
import argparse
import json
import random
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
V1 = HERE.parent
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1.parent / "v0"))
RESEARCH = Path("/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction")
DATA = RESEARCH / "data" / "bench"
RESULTS = HERE / "results"
DEV = ("aac_dev", "dd_dev")
PAGE, MAX_PAGES = 4, 3
UI_MAX_PAGES = 10     # two words per page; after that the person spells the word (frozen fallback cost)

from wordpred.context import Context, code_of, words_of  # noqa: E402


def cost_chooser(k, r):
    return k + 1 + r // PAGE + 1


def fallback(n):
    return n + 1 + (MAX_PAGES - 1) + 1 + n + 1


def ghost_costs(ranks):
    """Frozen benchmark word_costs: ranks[k] from the top-12 list after k zones."""
    n = len(ranks) - 1
    r_full = ranks[n]
    full = cost_chooser(n, r_full) if r_full is not None and r_full < PAGE * MAX_PAGES else fallback(n)
    ghost = next((k + 2 for k in range(n) if ranks[k] == 0), full)
    return {"full": full, "ghost": ghost}


def ui_cost(ranks, rank_full, max_pages=UI_MAX_PAGES):
    n = len(ranks) - 1
    for k in range(n):
        r = ranks[k]
        if r == 0 or (k >= 1 and r == 1):
            return k + 1
    if rank_full is None or rank_full // 2 >= max_pages:
        return fallback(n)
    return n + rank_full // 2 + 1


class V1Adapter:
    def __init__(self, rescorer="auto", params=None, threads=3, model="deployable"):
        from engine import Engine
        self.engine = Engine(model=model, rescorer=None if rescorer in (None, "none") else rescorer,
                             params=params, threads=threads)
        self.name = f"v1[{self.engine.model},{self.engine.rescorer_name}]"

    def start_conversation(self, conv_id):
        self.engine.start_conversation(conv_id)

    def lists(self, ctx, code):
        words = self.engine.ranked(ctx, code)[0]
        return words[:12], words[:12], words

    def detail(self, ctx, code):
        """Top-2 probabilities, completeness and the longer mass (for the branch simulation), and the
        complete-only word list at this code (for the "Other words" cost)."""
        words, probs, lengths, _ = self.engine.ranked(ctx, code)
        k = len(code)
        top = [round(float(probs[i]), 5) if i < len(probs) else None for i in (0, 1)]
        comp = [bool(lengths[i] == k) if i < len(lengths) else None for i in (0, 1)]
        return {"p": top, "c": comp, "longer": round(float(probs[lengths > k].sum()), 5) if len(words) else 0.0,
                "complete_words": [w for w, n in zip(words, lengths) if n == k]}

    def commit(self, ctx, word):
        self.engine.commit(word)

    def close(self):
        self.engine.close()


class V0Adapter:
    """v0 deployable: composer list for the ghost policy (as researched), probability order for the UI."""
    def __init__(self, model="deployable", **_):
        from wordpred import Predictor
        self.p = Predictor(model=model)
        self.name = f"v0[{model}]"

    def start_conversation(self, conv_id):
        self.p.start_conversation(conv_id)

    def lists(self, ctx, code):
        composer = self.p.rank(ctx, code)[:12]
        prob = [w for w, _ in self.p.matching_probabilities(ctx, code)]
        return prob[:12], composer, prob

    def commit(self, ctx, word):
        self.p.commit(ctx, word)

    def close(self):
        self.p.close()


def load(split):
    return [json.loads(l) for l in (DATA / f"{split}.jsonl").read_text().splitlines()]


def conv_limit(spec, split):
    """--convs 60 or --convs aac_dev=120,dd_dev=30"""
    if not spec:
        return None
    if "=" not in spec:
        return int(spec)
    return {k: int(v) for k, v in (part.split("=") for part in spec.split(","))}.get(split)


def run_split(adapter, split, out, convs=None, shard=(0, 1)):
    errors = calls = 0
    lat = []
    limit = conv_limit(convs, split)
    for ci, conv in enumerate(load(split)):
        if limit and ci >= limit:
            break
        if ci % shard[1] != shard[0]:
            continue
        adapter.start_conversation(conv["conv_id"])
        history = []
        for ti, turn in enumerate(conv["turns"]):
            if turn["target"]:
                committed = []
                for wi, w in enumerate(words_of(turn["text"])):
                    ctx = Context(conv["conv_id"], tuple(history), tuple(committed))
                    code = code_of(w)
                    ranks, ranks_ghost, rank_full, rank_complete, tops = [], [], None, None, []
                    for k in range(len(code) + 1):
                        t0 = time.perf_counter()
                        ui, ghost, full = adapter.lists(ctx, code[:k])
                        lat.append(time.perf_counter() - t0)
                        calls += 1
                        for lst in (ui, ghost):
                            if any(not code_of(c).startswith(code[:k]) for c in lst) or len(set(lst)) != len(lst):
                                errors += 1
                        ranks.append(ui.index(w) if w in ui else None)
                        ranks_ghost.append(ghost.index(w) if w in ghost else None)
                        if hasattr(adapter, "detail"):
                            d = adapter.detail(ctx, code[:k])
                            tops.append([d["p"][0], d["p"][1], d["c"][0], d["c"][1], d["longer"]])
                            if k == len(code):
                                rank_complete = d["complete_words"].index(w) if w in d["complete_words"] else None
                        if k == len(code):
                            rank_full = full.index(w) if w in full else None
                    rec = {"conv": conv["conv_id"], "turn": ti, "i": wi, "word": w, "n": len(code),
                           "ranks": ranks, "ranks_ghost": ranks_ghost, "rank_full": rank_full,
                           "rank_complete": rank_complete, "top": tops or None,
                           "ui": ui_cost(ranks, rank_full), **ghost_costs(ranks_ghost), "spell": 2 * len(code) + 1}
                    out.write(json.dumps(rec) + "\n")
                    adapter.commit(ctx, w)
                    committed.append(w)
            history.append((turn["speaker"], turn["text"]))
    lat.sort()
    return {"errors": errors, "rank_calls": calls,
            "latency_ms_p50": 1000 * lat[len(lat) // 2] if lat else None,
            "latency_ms_p95": 1000 * lat[int(len(lat) * 0.95)] if lat else None}


def records(name, split):
    recs = []
    for path in sorted((RESULTS / name).glob(f"{split}*.jsonl")):
        recs += [json.loads(l) for l in path.read_text().splitlines()]
    return recs


def summarize(recs):
    n = len(recs)
    for r in recs:                                   # recompute from the recorded ranks (policy may change)
        r["ui"] = ui_cost(r["ranks"], r["rank_full"])
        r["ui_uncapped"] = ui_cost(r["ranks"], r["rank_full"], max_pages=10**9)
    s = {"words": n}
    for key in ("ui", "ui_uncapped", "ghost", "full", "spell"):
        s[f"spw_{key}"] = sum(r[key] for r in recs) / n
    s["ui_fallbacks"] = sum(r["rank_full"] is None or r["rank_full"] // 2 >= UI_MAX_PAGES for r in recs) / n
    s["top1_next"] = sum(r["ranks"][0] == 0 for r in recs) / n
    s["top2_next"] = sum(r["ranks"][0] in (0, 1) for r in recs) / n
    for k in (1, 2, 3, 4):
        sub = [r for r in recs if r["n"] >= k]
        if sub:
            s[f"top1_k{k}"] = sum(r["ranks"][k] == 0 for r in sub) / len(sub)
            s[f"top2_k{k}"] = sum(r["ranks"][k] in (0, 1) for r in sub) / len(sub)
    s["top1_full"] = sum(r["rank_full"] == 0 for r in recs) / n
    s["top2_full"] = sum(r["rank_full"] in (0, 1) for r in recs) / n
    s["top12_full"] = sum(r["rank_full"] is not None and r["rank_full"] < 12 for r in recs) / n
    s["not_found"] = sum(r["rank_full"] is None for r in recs) / n
    return s


def value(rec, metric):
    if metric == "ui":
        return ui_cost(rec["ranks"], rec["rank_full"])
    if metric == "ui_uncapped":
        return ui_cost(rec["ranks"], rec["rank_full"], max_pages=10**9)
    if metric in ("ghost", "full", "spell"):
        return rec[metric]
    if metric == "top1_next":
        return float(rec["ranks"][0] == 0)
    if metric == "top2_full":
        return float(rec["rank_full"] in (0, 1))
    if metric == "top1_full":
        return float(rec["rank_full"] == 0)
    raise ValueError(metric)


def cmd_run(a):
    shard = tuple(int(x) for x in a.shard.split("/")) if a.shard else (0, 1)
    params = json.loads(a.params) if a.params else None
    adapter = (V1Adapter(a.rescorer, params, a.threads, a.model) if a.system == "v1" else V0Adapter(a.model))
    d = RESULTS / a.name
    d.mkdir(parents=True, exist_ok=True)
    report = {"system": adapter.name, "params": params, "rescorer": a.rescorer, "convs": a.convs, "shard": a.shard, "splits": {}}
    t0 = time.time()
    for split in a.splits.split(","):
        suffix = f".shard{shard[0]}" if a.shard else ""
        p = d / f"{split}{suffix}.jsonl"
        with p.open("w") as out:
            info = run_split(adapter, split, out, a.convs, shard)
        report["splits"][split] = {**summarize([json.loads(l) for l in p.read_text().splitlines()]), **info}
    adapter.close()
    report["wall_seconds"] = time.time() - t0
    (d / f"summary{'.shard' + str(shard[0]) if a.shard else ''}.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def cmd_summary(a):
    report = {"name": a.name, "splits": {}}
    for split in a.splits.split(","):
        recs = records(a.name, split)
        if recs:
            report["splits"][split] = summarize(recs)
    devs = [report["splits"][s] for s in DEV if s in report["splits"]]
    if len(devs) == 2:
        report["PRIMARY_ghost"] = sum(s["spw_ghost"] for s in devs) / 2
        report["PRIMARY_ui"] = sum(s["spw_ui"] for s in devs) / 2
    print(json.dumps(report, indent=2))
    return report


def cmd_compare(a):
    """Paired bootstrap over conversations of (B - A), macro over splits; negative = B better for costs."""
    rng = random.Random(0)
    splits = a.splits.split(",")
    per = {}
    for s in splits:
        A, B = {}, {}
        for store, name in ((A, a.run_a), (B, a.run_b)):
            for r in records(name, s):
                acc = store.setdefault(r["conv"], [0.0, 0])
                acc[0] += value(r, a.metric)
                acc[1] += 1
        common = sorted(set(A) & set(B))
        if set(A) != set(B):
            print(f"warning: {s}: runs cover different conversations ({len(A)} vs {len(B)}); comparing {len(common)} common", file=sys.stderr)
        per[s] = [(A[c][0], B[c][0], A[c][1]) for c in common]

    def delta(rows):
        n = sum(r[2] for r in rows)
        return (sum(r[1] for r in rows) - sum(r[0] for r in rows)) / n

    def mean_of(rows, which):
        return sum(r[which] for r in rows) / sum(r[2] for r in rows)

    point = statistics.mean(delta(per[s]) for s in splits)
    boots = sorted(statistics.mean(delta([rng.choice(per[s]) for _ in per[s]]) for s in splits) for _ in range(2000))
    out = {"metric": a.metric, "splits": splits, "A": a.run_a, "B": a.run_b,
           "A_mean": statistics.mean(mean_of(per[s], 0) for s in splits),
           "B_mean": statistics.mean(mean_of(per[s], 1) for s in splits),
           "delta_B_minus_A": point, "ci95": [boots[49], boots[1949]],
           "significant": boots[1949] < 0 or boots[49] > 0, "words": sum(r[2] for s in splits for r in per[s])}
    print(json.dumps(out, indent=2))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--system", choices=["v1", "v0"], default="v1")
    r.add_argument("--model", default="deployable")
    r.add_argument("--rescorer", default="auto")
    r.add_argument("--params", default=None)
    r.add_argument("--threads", type=int, default=3)
    r.add_argument("--name", required=True)
    r.add_argument("--splits", default=",".join(DEV))
    r.add_argument("--convs", default=None, help="first N conversations of each split, or aac_dev=120,dd_dev=30")
    r.add_argument("--shard", default=None, help="i/n: conversations with index %% n == i")
    s = sub.add_parser("summary")
    s.add_argument("name")
    s.add_argument("--splits", default=",".join(DEV))
    c = sub.add_parser("compare")
    c.add_argument("run_a")
    c.add_argument("run_b")
    c.add_argument("--metric", default="ui")
    c.add_argument("--splits", default=",".join(DEV))
    a = ap.parse_args()
    {"run": cmd_run, "summary": cmd_summary, "compare": cmd_compare}[a.cmd](a)


if __name__ == "__main__":
    main()
