"""Cache the engine's answers for every typed step of a word sample, so the s6 screen policy can be tuned
offline (bench/policy_eval.py) without asking the engine again (round 4).

Two samples:
- usage: word positions from the dev splits (aac_dev, dd_dev) with their real conversation and message,
  every N-th target word, so the policy is judged on what people actually say;
- matrix: the bench/matrix.py buckets (very common to invented, short to 45 letters) in three contexts,
  so no kind of word is left behind.
For each word: the first page (limit 8, with `rare`, `complete`, `branch`) after 0..n typed groups, and the
whole-word chooser list at the full code (complete: true, up to 128 words).

  ../v0/.venv/bin/python bench/policy_cache.py MATRIX_WORDS_JSON OUT_JSON [--port 8766] [--every 9]
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import DEV, load  # noqa: E402
from matrix import CONTEXTS, code  # noqa: E402
from wordpred.context import words_of  # noqa: E402


def predict(port, history, message, groups, **extra):
    body = json.dumps({"history": history, "message": message, "groups": groups, "limit": 8, **extra}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/v1/predict", data=body, headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def steps(port, history, message, word):
    c = code(word)
    pages = [predict(port, history, message, c[:k]) for k in range(len(c) + 1)]
    chooser = [w["word"] for w in predict(port, history, message, c, complete=True, limit=64)["words"]]
    if len(chooser) == 64:
        chooser += [w["word"] for w in predict(port, history, message, c, complete=True, limit=64, offset=64)["words"]]
    return {"word": word, "n": len(c), "pages": [{"words": p["words"], "branch": p.get("branch", False)} for p in pages], "chooser": chooser}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("matrix_words")
    ap.add_argument("out")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--every", type=int, default=9, help="usage sample: every N-th target word")
    a = ap.parse_args()
    usage, seen = [], 0
    for split in DEV:
        for conv in load(split):
            history = []
            for turn in conv["turns"]:
                if turn["target"]:
                    message = []
                    for w in words_of(turn["text"]):
                        if seen % a.every == 0 and code(w):
                            usage.append({"split": split, **steps(a.port, [list(h) for h in history], list(message), w)})
                        seen += 1
                        message.append(w)
                history.append((turn["speaker"], turn["text"]))
        print(f"{split}: {len(usage)} usage words so far", file=sys.stderr)
    matrix = []
    for bucket, words in json.load(open(a.matrix_words)).items():
        for w in words:
            for ctx, (history, message) in CONTEXTS.items():
                matrix.append({"bucket": bucket, "context": ctx, **steps(a.port, history, message, w)})
    json.dump({"usage": usage, "matrix": matrix}, open(a.out, "w"))
    print(f"{len(usage)} usage words, {len(matrix)} matrix word-contexts -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
