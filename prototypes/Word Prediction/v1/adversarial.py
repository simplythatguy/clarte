"""Run adversarial.jsonl against the engine (in-process or over HTTP) and report pass/fail per case.

  ../v0/.venv/bin/python adversarial.py [--rescorer auto] [--url http://127.0.0.1:8765] [--out bench/results/adversarial.json]

Each case types the target's code one group at a time and records the target's rank after every
group. `expect` lists [k, top] pairs: after k groups ("full" = the whole code) the target must be
within the top `top`. `deletion` runs the full code, then a different request, then the full code
again and requires the same answer. `typed` overrides the groups (gaze-slip cases expect a
`corrected` word). `commits` are accepted first. `history_repeat`/`message_repeat` build giant inputs.
"""
import argparse
import json
import sys
from pathlib import Path

V1 = Path(__file__).resolve().parent
sys.path.insert(0, str(V1))
sys.path.insert(0, str(V1.parent / "v0"))
from wordpred.context import code_of  # noqa: E402


class Local:
    def __init__(self, rescorer, threads):
        from engine import Engine
        self.engine = Engine(rescorer=None if rescorer == "none" else rescorer, threads=threads)

    def reset(self):
        self.engine.start_conversation("adv")

    def commit(self, w):
        self.engine.commit(w)

    def predict(self, history, message, groups, complete=False):
        return self.engine.predict(history, message, groups, limit=64, complete=complete)


class Remote:
    def __init__(self, url):
        self.url = url.rstrip("/")

    def _post(self, path, body):
        from urllib.request import Request, urlopen
        req = Request(self.url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def reset(self):
        pass

    def commit(self, w):
        self._post("/api/v1/commit", {"word": w})

    def predict(self, history, message, groups, complete=False):
        return self._post("/api/v1/predict", {"history": history, "message": message, "groups": groups, "limit": 64,
                                              "complete": complete})


def run_case(system, case):
    history = list(case.get("history_repeat", [])) * case.get("repeat", 1) + case["history"] if "history_repeat" in case else case["history"]
    message = (case["message_repeat"].split() * case.get("repeat", 1) + case["message"]) if "message_repeat" in case else case["message"]
    target = case["target"]
    code = case.get("typed", code_of(target))
    system.reset()
    for w in case.get("commits", []):
        system.commit(w)
    ranks, tops = [], []
    for k in range(len(code) + 1):
        out = system.predict(history, message, code[:k])
        words = [w["word"] for w in out["words"]]
        ranks.append(words.index(target) if target in words else None)
        tops.append(words[:2])
    result = {"id": case["id"], "category": case["category"], "target": target, "code": code, "ranks": ranks,
              "top2_by_k": tops, "first_top1": next((k for k, r in enumerate(ranks) if r == 0), None),
              "first_top2": next((k for k, r in enumerate(ranks) if r in (0, 1) and k >= 1), None)}
    failures = []
    if case.get("expect_corrected"):
        # Round 4: with Wiktionary's words a slipped code may match a few obscure words (total > 0); the
        # correction must still come first.
        if not (out["words"] and out["words"][0].get("corrected") and out["words"][0]["word"] == target):
            failures.append(f"expected corrected {target}, got {out['words'][:2]}")
    for k, top in case.get("expect", []):
        kk = len(code) if k == "full" else k
        r = ranks[kk] if kk < len(ranks) else None
        if r is None or r >= top:
            failures.append(f"after {kk} groups rank {r}, needed top {top}; shown {tops[kk]}")
    if "expect_complete" in case:
        # the "Other words" chooser: complete words only, four per page
        comp = system.predict(history, message, code, complete=True)
        cw = [w["word"] for w in comp["words"]]
        rc = cw.index(target) if target in cw else None
        result["rank_complete"] = rc
        if rc is None or rc >= case["expect_complete"]:
            failures.append(f"complete-only rank {rc}, needed top {case['expect_complete']}; shown {cw[:4]}")
    if case.get("deletion"):
        first = system.predict(history, message, code)["words"][:2]
        system.predict(history, message[:-1], code[:1])
        again = system.predict(history, message, code)["words"][:2]
        if first != again:
            failures.append(f"different answer after deletion: {first} vs {again}")
    result["pass"] = not failures
    result["failures"] = failures
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rescorer", default="auto")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--url", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--out", default=str(V1 / "bench" / "results" / "adversarial.json"))
    a = ap.parse_args()
    system = Remote(a.url) if a.url else Local(a.rescorer, a.threads)
    cases = [json.loads(l) for l in (V1 / "adversarial.jsonl").read_text().splitlines() if l.strip()]
    results = []
    for case in cases:
        if a.only and a.only not in case["id"]:
            continue
        r = run_case(system, case)
        results.append(r)
        print(("PASS" if r["pass"] else "FAIL"), r["id"], r["ranks"], ("; ".join(r["failures"]) if r["failures"] else ""), flush=True)
    passed = sum(r["pass"] for r in results)
    print(f"{passed}/{len(results)} passed")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({"passed": passed, "cases": len(results), "results": results}, indent=2) + "\n")


if __name__ == "__main__":
    main()
