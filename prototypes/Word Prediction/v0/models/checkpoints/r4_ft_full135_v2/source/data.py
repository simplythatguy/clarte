"""Use only the two allowed TRAIN sources; split whole DD overlap components."""
import hashlib
import json
from collections import Counter

import pyarrow.parquet as pq

from bench.bench import Context, words_of
from bench.prepare_data import norm_text
from methods.neural.scorer import NeuralWordScorer
from .common import ART, ROOT, sha, write_json

AAC = ROOT / "data/raw/aac/unz/aac_comm/sent_train_aac.txt"
DD = ROOT / "data/raw/dailydialog/train.parquet"


def prompt(history, message=()):
    # Call the actual unchanged inference formatter, rather than duplicating it.
    formatter = object.__new__(NeuralWordScorer)
    formatter.partner, formatter.prompt_style = True, "dialogue"
    return formatter.prompt(Context("train", tuple(history), tuple(message)))


def records():
    dialogs = [[norm_text(t) for t in d] for d in pq.read_table(DD).column("dialog").to_pylist()]
    parent = list(range(len(dialogs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen = {}
    for i, d in enumerate(dialogs):
        keys = ["\n".join(" ".join(words_of(t)) for t in d)]
        keys += [" ".join(words_of(t)) for t in d if len(words_of(t)) >= 4]
        for key in keys:
            if key in seen:
                a, b = find(i), find(seen[key])
                parent[max(a, b)] = min(a, b)
            else:
                seen[key] = i
    members = {}
    for i in range(len(dialogs)):
        members.setdefault(find(i), []).append(i)
    assignments = {}
    groups = []
    for ids in members.values():
        content = sorted({"\n".join(dialogs[i]) for i in ids})
        key = hashlib.sha256("\n\n".join(content).encode()).hexdigest()
        split = "holdout" if int(key[:8], 16) % 20 == 0 else "train"
        groups.append({"sha256": key, "dialogue_indices": ids, "split": split})
        for i in ids:
            assignments[i] = (key, split)
    output = []
    for i, raw in enumerate(AAC.read_text().splitlines()):
        text = " ".join(words_of(raw))
        if text:
            # Worker IDs are absent. All AAC goes into training, so no worker
            # is split across training and holdout. Holdout is DD-only.
            output.append({"domain": "aac", "source_id": i, "group": "aac_all_workers",
                           "split": "train", "prompt": prompt(()), "reply": " " + text})
    for i, d in enumerate(dialogs):
        key, split = assignments[i]
        history = []
        for ti, raw in enumerate(d):
            role = "partner" if ti % 2 == 0 else "user"
            if role == "user":
                text = " ".join(words_of(raw))
                if text:
                    output.append({"domain": "dd", "source_id": [i, ti], "group": key,
                                   "split": split, "prompt": prompt(history), "reply": " " + text})
            history.append((role, raw))
    return output, groups


def prepare(tokenizer, max_length=128, target_block=48):
    rows, groups = records()
    samples = {"aac": [], "dd": [], "holdout": []}
    counts = Counter()
    for r in rows:
        history = tokenizer.encode(r["prompt"], add_special_tokens=False)
        reply = tokenizer.encode(r["reply"], add_special_tokens=False)
        for start in range(0, len(reply), target_block):
            target = reply[start:start + target_block]
            context = (history + reply[:start])[-(max_length - len(target)):]
            ids = context + target
            labels = [-100] * len(context) + target
            item = {"ids": ids, "labels": labels, "group": r["group"],
                    "domain": r["domain"], "source_id": r["source_id"]}
            key = "holdout" if r["split"] == "holdout" else r["domain"]
            samples[key].append(item)
            counts[key + "_input_tokens"] += len(ids)
            counts[key + "_target_tokens"] += len(target)
    # Fix a modest validation set once, by train-only source ID; no dev access.
    samples["holdout"].sort(key=lambda r: hashlib.sha256(json.dumps(r["source_id"]).encode()).hexdigest())
    samples["holdout"] = samples["holdout"][:256]
    manifest = {"sources": {str(p.relative_to(ROOT)): sha(p) for p in (AAC, DD)},
                "split_rule": "DD connected components sharing a >=4-word normalized turn or identical dialogue; sha256 % 20 == 0 held out",
                "aac_worker_limit": "No worker identifiers in release. All AAC assigned to train; holdout is DD-only.",
                "groups": groups, "sample_counts": {k: len(v) for k, v in samples.items()},
                "all_pre_cap_counts": dict(counts), "validation_cap": 256,
                "max_length": max_length, "target_block": target_block,
                "format_examples": [{k: r[k] for k in ("domain", "prompt", "reply")} for r in (rows[0], next(x for x in rows if x["domain"] == "dd"))]}
    train_groups = {r["group"] for k in ("aac", "dd") for r in samples[k]}
    assert train_groups.isdisjoint({r["group"] for r in samples["holdout"]})
    assert samples["holdout"]
    write_json(ART / "train-manifest.json", manifest)
    return samples
