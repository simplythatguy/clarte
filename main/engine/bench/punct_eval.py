"""Punctuation for the spoken sentence (NAT-38) on held-out conversations.

  punct_eval.py DIALOGS.parquet [--dialogs 80] [--params '{"comma_margin": 1.0}']

DIALOGS.parquet is DailyDialog's validation split (the `dialog` column). Every second turn is the
person's; the turns before it are the history. Each of the person's turns that is one sentence of 2 to 20
words is stripped to its words, punctuated by the engine, and compared with how it was written: the end
mark (., ? or !) and the commas between words.
"""
import argparse
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

WORD = re.compile(r"[a-z]+(?:'[a-z]+)*|[0-9]+(?:[.:][0-9]+)?")


def clean(text):
    return re.sub(r"\s+([’'])\s+", r"\1", str(text)).strip()


def dialogs(path, limit):
    import pyarrow.parquet as pq
    rows = pq.read_table(path).column("dialog").to_pylist()
    return rows[:limit] if limit else rows


def marks_of(text):
    """(words, the set of gap indexes followed by a comma, the end mark)."""
    t = text.replace("’", "'").lower()
    found = list(WORD.finditer(t))
    words = [m.group(0) for m in found]
    commas = {i for i in range(len(found) - 1) if "," in t[found[i].end():found[i + 1].start()]}
    tail = t[found[-1].end():] if found else ""
    end = next((c for c in reversed(tail) if c in ".?!"), "")
    return words, commas, end


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dialogs_path")
    ap.add_argument("--dialogs", type=int, default=80)
    ap.add_argument("--params", default=None)
    args = ap.parse_args()
    from server import load
    params = json.loads(args.params) if args.params else None
    engine = load(rescorer="smol135-ft", params={"punctuate": params} if params else None)
    ends, comma = Counter(), Counter()
    ms, shown = [], 0
    for turns in dialogs(args.dialogs_path, args.dialogs):
        turns = [clean(t) for t in turns if str(t).strip()]
        for i in range(1, len(turns), 2):
            if len(re.split(r"(?<=[.?!])\s", turns[i])) != 1:
                continue
            words, commas, end = marks_of(turns[i])
            if not 2 <= len(words) <= 20 or not end:
                continue
            history = [["user" if (i - j) % 2 == 0 else "partner", turns[j]] for j in range(max(0, i - 8), i)]
            t0 = time.perf_counter()
            res = engine.punctuate(history, words)
            ms.append(1000 * (time.perf_counter() - t0))
            _, got_commas, got_end = marks_of(res["text"])
            ends[(end, got_end)] += 1
            comma["tp"] += len(commas & got_commas)
            comma["fp"] += len(got_commas - commas)
            comma["fn"] += len(commas - got_commas)
            if shown < 12:
                print(f"  {turns[i]!r}\n→ {res['text']!r}")
                shown += 1
    total = sum(ends.values())
    ms.sort()
    print(f"\n{total} sentences; {ms[len(ms) // 2]:.0f} ms p50, {ms[int(len(ms) * 0.95)]:.0f} ms p95")
    print(f"end mark right: {sum(v for (a, b), v in ends.items() if a == b) / total:.1%}")
    for mark in ENDS:
        tp = ends[(mark, mark)]
        truth = sum(v for (a, _), v in ends.items() if a == mark)
        said = sum(v for (_, b), v in ends.items() if b == mark)
        print(f"  {mark!r}: {truth} written, {said} predicted, recall {tp / max(truth, 1):.0%}, precision {tp / max(said, 1):.0%}")
    p = comma["tp"] / max(comma["tp"] + comma["fp"], 1)
    r = comma["tp"] / max(comma["tp"] + comma["fn"], 1)
    print(f"commas: {comma['tp'] + comma['fn']} written, precision {p:.0%}, recall {r:.0%}")


ENDS = (".", "?", "!")

if __name__ == "__main__":
    main()
