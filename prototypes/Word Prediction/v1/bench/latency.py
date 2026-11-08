"""Latency through the HTTP server: cold start, then p50/p95 per request for empty and typed groups.

  ../v0/.venv/bin/python bench/latency.py [--rescorer auto] [--port 18777] [--requests 200] [--concurrency 1]

Starts `server.py` as a subprocess, waits for /api/v1/health (cold start = time to first healthy
response), then replays realistic contexts from the dd_dev split: for each message position it asks
for the next word (empty groups) and then for each typed prefix of the actual word, the way the UI
does. Each request is a new HTTP connection. Reports per-request wall time at the client.
"""
import argparse
import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
V1 = HERE.parent
sys.path.insert(0, str(V1.parent / "v0"))
from wordpred.context import code_of, words_of  # noqa: E402

DATA = Path("/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction/data/bench")


def requests_from_dev(n):
    out = []
    for line in (DATA / "dd_dev.jsonl").read_text().splitlines():
        conv = json.loads(line)
        history = []
        for turn in conv["turns"]:
            if turn["target"]:
                committed = []
                for w in words_of(turn["text"]):
                    code = code_of(w)
                    for k in range(len(code) + 1):
                        out.append({"history": list(history), "message": list(committed), "groups": code[:k]})
                    committed.append(w)
            history.append([turn["speaker"], turn["text"]])
            if len(out) >= n:
                return out[:n]
    return out


def post(port, body):
    req = Request(f"http://127.0.0.1:{port}/api/v1/predict", data=json.dumps(body).encode(),
                  headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    return 1000 * (time.perf_counter() - t0), data


def quantiles(xs):
    xs = sorted(xs)
    return {"n": len(xs), "p50": round(xs[len(xs) // 2], 1), "p95": round(xs[int(len(xs) * 0.95)], 1),
            "max": round(xs[-1], 1), "mean": round(statistics.mean(xs), 1)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rescorer", default="auto")
    ap.add_argument("--port", type=int, default=18777)
    ap.add_argument("--requests", type=int, default=300)
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--params", default=None)
    ap.add_argument("--pace", type=float, default=0.0, help="seconds to wait between requests (a gaze user sends about one per second)")
    ap.add_argument("--complete-every", type=int, default=0, help="also send a complete:true request after every Nth word")
    ap.add_argument("--out", default=str(HERE / "results" / "latency.json"))
    a = ap.parse_args()
    cmd = [sys.executable, str(V1 / "server.py"), "--port", str(a.port), "--rescorer", a.rescorer]
    if a.params:
        cmd += ["--params", a.params]
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        while True:
            try:
                with urlopen(f"http://127.0.0.1:{a.port}/api/v1/health", timeout=2) as r:
                    health = json.loads(r.read())
                    break
            except Exception:  # noqa: BLE001
                if proc.poll() is not None:
                    raise SystemExit("server exited during startup")
                time.sleep(0.5)
        cold = time.perf_counter() - t0
        first_ms, _ = post(a.port, {"history": [["partner", "Hello"]], "message": [], "groups": ""})
        reqs = requests_from_dev(a.requests)
        if a.complete_every:
            # the "Other words" chooser: after the whole code of every Nth word, one complete-only page
            extra, i = [], 0
            for j, b in enumerate(reqs):
                extra.append(b)
                if b["groups"] and (j + 1 == len(reqs) or not reqs[j + 1]["groups"]):
                    i += 1
                    if i % a.complete_every == 0:
                        extra.append({**b, "complete": True, "limit": 4})
            reqs = extra

        def call(b):
            if a.pace:
                time.sleep(a.pace)
            return b, post(a.port, b)
        with ThreadPoolExecutor(a.concurrency) as pool:
            results = list(pool.map(call, reqs))
        empty = [ms for b, (ms, _) in results if not b["groups"]]
        typed = [ms for b, (ms, _) in results if b["groups"] and not b.get("complete")]
        comp = [ms for b, (ms, _) in results if b.get("complete")]
        server_ms = [d["ms"] for b, (ms, d) in results]
        for b, (ms, d) in results:
            assert d["words"] and all(code_of(w["word"]).startswith(b["groups"]) for w in d["words"] if not w.get("corrected")), b
        report = {"rescorer": health.get("rescorer"), "vocabulary": health.get("vocabulary"), "cold_start_s": round(cold, 1),
                  "first_request_ms": round(first_ms, 1), "concurrency": a.concurrency, "pace_s": a.pace,
                  "empty_groups_ms": quantiles(empty), "typed_groups_ms": quantiles(typed), "all_ms": quantiles(empty + typed),
                  "complete_ms": quantiles(comp) if comp else None, "over_150ms": sum(ms > 150 for ms in empty + typed),
                  "server_side_ms": quantiles(server_ms), "params": a.params}
        print(json.dumps(report, indent=2))
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
