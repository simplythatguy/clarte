"""Names where a name is likely, and ordinary words where one is not (round 5).

Replays the s6 screen (bench/matrix.py `cost`: Q1, Q4, Options, Other words, Spell) in-process, so the name
parameters can be swept without restarting a server. Two sets:
- names: names of every frequency (Census and wordfreq common, rare Wiktionary names) after cues where a
  name is likely ("my name is", "ask", "tell", "where's", a partner asking who),
- ordinary: the same cues followed by ordinary words ("my name is very long", "ask where i can meet them",
  "where's the nearest bathroom"), which must not get dearer.

  .venv/bin/python bench/names_eval.py [--sweep] [--rescorer qwen2.5-1.5b]
"""
import argparse
import itertools
import json
import os
import random
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from matrix import cost  # noqa: E402

CUES = [
    ([], ["my", "name", "is"]), ([], ["ask"]), ([], ["tell"]), ([], ["where's"]), ([], ["can", "you", "call"]),
    ([], ["say", "hi", "to"]), ([], ["this", "is"]), ([], ["i", "saw"]), ([], ["i'm"]), ([], ["hi", "i'm"]),
    ([["partner", "Who should I call?"]], []), ([["partner", "What is your name?"]], ["my", "name", "is"]),
]
ORDINARY = [
    ([], ["my", "name", "is"], "very"), ([], ["my", "name", "is", "very"], "long"), ([], ["ask"], "where"),
    ([], ["ask", "where", "i", "can", "meet"], "them"), ([], ["where's"], "the"), ([], ["where's", "the", "nearest"], "bathroom"),
    ([], ["tell"], "me"), ([], ["tell", "me"], "more"), ([], ["can", "you", "call"], "me"), ([], ["say", "hi", "to"], "everyone"),
    ([], ["this", "is"], "great"), ([], ["i", "saw"], "it"), ([], ["i'm"], "tired"), ([], ["i'm"], "fine"), ([], ["hi", "i'm"], "back"),
    ([], ["i'm"], "sorry"), ([], ["i'm", "so"], "happy"), ([["partner", "Who should I call?"]], [], "nobody"),
    ([["partner", "What is your name?"]], ["my", "name", "is"], "not"), ([], ["i", "want", "to"], "go"), ([], ["the"], "dog"),
]


class Local:
    """bench/matrix.py's engine interface, in-process."""

    def __init__(self, engine):
        self.engine = engine

    def predict(self, history, message, groups, **extra):
        return self.engine.predict(history, message, groups, limit=extra.get("limit", 8), offset=extra.get("offset", 0),
                                   complete=extra.get("complete", False))


def name_sample(lex, n=40, seed=3):
    import numpy as np
    rng = random.Random(seed)
    idx = [i for i in np.flatnonzero(lex.is_name) if lex.name_prior[i] > 1e-9 and lex.words[i].isalpha() and len(lex.words[i]) >= 3]
    idx.sort(key=lambda i: -lex.name_prior[i])
    thirds = [idx[: len(idx) // 50], idx[len(idx) // 50: len(idx) // 5], idx[len(idx) // 5:]]
    picked = [lex.words[i] for part, k in zip(thirds, (n // 3, n // 3, n - 2 * (n // 3))) for i in rng.sample(part, k)]
    return picked + ["amal", "priya", "okafor", "siobhan", "yusuf", "marcus", "omer"]


def letters_cost(words):
    """Spell's looks per word, from s6 spell.ts (node), so Spell routes are priced as the screen prices them."""
    import subprocess
    # s6 left the repository with prototypes/ (2026-11-09); run it from a checkout of an earlier commit.
    script = Path(os.environ.get("CLARTE_S6", ""))
    if not (script / "src" / "spell.ts").is_file():
        sys.exit("names_eval needs UI v0's s6 screen: git worktree add /tmp/v0 d6a27ca, then CLARTE_S6=/tmp/v0/prototypes/UI/v0/s6")
    code = ("import { rankLetters } from './src/spell.ts'; import { signatureOf } from '../shared/decoder.ts';"
            "const ws = JSON.parse(process.argv[1]); const out = {};"
            "for (const w of ws) { const g = signatureOf(w); let n = 0; for (let i = 0; i < w.length; i++) { const r = rankLetters(w.slice(0, i), g).indexOf(w[i]); n += 1 + Math.floor(Math.max(0, r) / 3); } out[w] = n; }"
            "console.log(JSON.stringify(out));")
    run = subprocess.run(["node", "--input-type=module", "-e", code, json.dumps(sorted(set(words)))], cwd=script, capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


def evaluate(engine, names, letters):
    local = Local(engine)
    named = [cost(local, h, m, w, letters[w])[0] for h, m in CUES for w in names]
    plain = [cost(local, h, m, w, letters[w])[0] for h, m, w in ORDINARY]
    return statistics.mean(named), statistics.mean(plain), plain


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rescorer", default="qwen2.5-1.5b")
    ap.add_argument("--sweep", action="store_true")
    a = ap.parse_args()
    from engine import Engine
    engine = Engine(rescorer=a.rescorer)
    names = name_sample(engine.lex)
    letters = letters_cost(names + [w for _, _, w in ORDINARY])
    grid = [dict(name_weight=0.0, name_cands=0, prompt_caps=0), dict(name_cands=0, prompt_caps=0)]
    grid += [dict(name_min_len=n, name_margin=m) for n, m in itertools.product((4, 5), (1.0, 2.0))] if a.sweep else [{}]  # round 5 chose 4, 2.0
    base = dict(engine.params)
    print(f"{len(names)} names x {len(CUES)} cues; {len(ORDINARY)} ordinary continuations")
    for g in grid:
        engine.params = {**base, **g}
        engine._prior_key = None
        engine._ranked.clear()
        engine.lifted.clear()
        n, o, plain = evaluate(engine, names, letters)
        local = Local(engine)
        omer = cost(local, [], ["i'm"], "omer", letters["omer"])
        print(f"{json.dumps(g):80} names {n:6.2f}   ordinary {o:5.2f}  ({' '.join(str(c) for c in plain)})   I'm omer {omer[0]} by {omer[1]}", flush=True)


if __name__ == "__main__":
    main()
