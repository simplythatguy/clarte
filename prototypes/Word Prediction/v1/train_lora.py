"""LoRA-adapt an MLX rescorer on the allowed training data only (never dev or test text).

Data (the research benchmark's rule, BENCHMARK.md): AAC `sent_train_aac.txt` and DailyDialog `train`.
Each user turn becomes one completion example: prompt = the conversation so far in the rescorer's own
format ("Partner: ...\\nMe: ...\\nMe:"), completion = " " + the user's words. DailyDialog dialogues that
share a 4-word turn are one group; groups with sha256 % 20 == 0 are the validation set (DD only), the
same rule as the research fine-tune (methods/finetune/data.py). The prompt is masked in the loss.

  ../v0/.venv/bin/python train_lora.py prepare                       # data/lora/{train,valid}.jsonl (gitignored)
  ../v0/.venv/bin/python train_lora.py train qwen2.5-1.5b [--iters 600] [--batch-size 8] [--lr 1e-4] [--layers 16]
                                                                     # -> models/adapters/<name>/ (gitignored) + receipt
"""
import argparse
import hashlib
import json
import random
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "v0"))
RESEARCH = Path("/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction")
AAC = RESEARCH / "data/raw/aac/unz/aac_comm/sent_train_aac.txt"
DD = RESEARCH / "data/raw/dailydialog/train.parquet"
OUT = HERE / "data" / "lora"
ADAPTERS = HERE / "models" / "adapters"

from wordpred.context import words_of  # noqa: E402


def norm_text(s):
    """bench/prepare_data.py's normaliser: curly quotes to ', surrounding whitespace stripped."""
    return s.replace("\u2019", "'").replace("\u2018", "'").strip()


def prompt_of(history, max_turns=24):
    turns = history[-max_turns:]
    text = "\n".join(("Me: " if role == "user" else "Partner: ") + t for role, t in turns)
    return (text + "\n" if text else "") + "Me:"


def prepare():
    import pyarrow.parquet as pq
    dialogs = [[norm_text(t) for t in d] for d in pq.read_table(DD).column("dialog").to_pylist()]
    parent = list(range(len(dialogs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen = {}
    for i, d in enumerate(dialogs):
        keys = ["\n".join(" ".join(words_of(t)) for t in d)] + [" ".join(words_of(t)) for t in d if len(words_of(t)) >= 4]
        for key in keys:
            if key in seen:
                a, b = find(i), find(seen[key])
                parent[max(a, b)] = min(a, b)
            else:
                seen[key] = i
    members = {}
    for i in range(len(dialogs)):
        members.setdefault(find(i), []).append(i)
    split_of = {}
    for ids in members.values():
        content = sorted({"\n".join(dialogs[i]) for i in ids})
        key = hashlib.sha256("\n\n".join(content).encode()).hexdigest()
        for i in ids:
            split_of[i] = "valid" if int(key[:8], 16) % 20 == 0 else "train"
    rows = {"train": [], "valid": []}
    for raw in AAC.read_text().splitlines():
        text = " ".join(words_of(raw))
        if text:
            rows["train"].append({"prompt": prompt_of([]), "completion": " " + text})
    for i, d in enumerate(dialogs):
        history = []
        for ti, raw in enumerate(d):
            role = "partner" if ti % 2 == 0 else "user"
            if role == "user":
                text = " ".join(words_of(raw))
                if text:
                    rows[split_of[i]].append({"prompt": prompt_of(history), "completion": " " + text})
            history.append((role, raw))
    rng = random.Random(0)
    for k in rows:
        rng.shuffle(rows[k])
    rows["valid"] = rows["valid"][:512]
    OUT.mkdir(parents=True, exist_ok=True)
    for k, v in rows.items():
        (OUT / f"{k}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in v))
    manifest = {"sources": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (AAC, DD)},
                "rule": "AAC sent_train + DailyDialog train user turns; DD groups (shared >=4-word turn) with sha256 % 20 == 0 -> valid (capped 512)",
                "counts": {k: len(v) for k, v in rows.items()}, "examples": [rows["train"][0], rows["valid"][0]]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k: len(v) for k, v in rows.items()}))


def train(name, iters, batch_size, lr, layers, max_seq, rank):
    from engine.mlx_rescorer import CATALOG, MODELS
    model = MODELS / CATALOG[name]
    out = ADAPTERS / f"{name}-lora{rank}-i{iters}"
    out.mkdir(parents=True, exist_ok=True)
    config = {"lora_parameters": {"rank": rank, "scale": 20.0, "dropout": 0.0}}
    (out / "lora_config.yaml").write_text("lora_parameters:\n  rank: %d\n  scale: 20.0\n  dropout: 0.0\n" % rank)
    cmd = [sys.executable, "-m", "mlx_lm", "lora", "--model", str(model), "--train", "--data", str(OUT),
           "--iters", str(iters), "--batch-size", str(batch_size), "--learning-rate", str(lr), "--num-layers", str(layers),
           "--max-seq-length", str(max_seq), "--mask-prompt", "--adapter-path", str(out), "--val-batches", "32",
           "--steps-per-eval", "100", "--steps-per-report", "20", "--grad-checkpoint", "--seed", "0",
           "-c", str(out / "lora_config.yaml")]
    t0 = time.time()
    log = (out / "train.log").open("w")
    proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=str(HERE))
    log.close()
    receipt = {"model": name, "argv": cmd, "returncode": proc.returncode, "seconds": round(time.time() - t0),
               "data_manifest": json.loads((OUT / "manifest.json").read_text())["counts"], "config": config}
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))
    print((out / "train.log").read_text()[-1500:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    t = sub.add_parser("train")
    t.add_argument("name")
    t.add_argument("--iters", type=int, default=600)
    t.add_argument("--batch-size", type=int, default=8)
    t.add_argument("--lr", type=float, default=1e-4)
    t.add_argument("--layers", type=int, default=16)
    t.add_argument("--max-seq", type=int, default=512)
    t.add_argument("--rank", type=int, default=8)
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare()
    else:
        train(a.name, a.iters, a.batch_size, a.lr, a.layers, a.max_seq, a.rank)


if __name__ == "__main__":
    main()
