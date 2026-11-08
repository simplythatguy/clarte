"""Bounded MPS/CPU supervised training; DD TRAIN holdout is the only selector."""
import argparse
import json
import math
import os
import random
import resource
import time

import numpy as np
import torch
from safetensors.torch import save_file
from transformers import AutoModelForCausalLM, AutoTokenizer

from methods.neural.fetch import MODELS
from .common import ART, CHECKPOINTS, HERE, ROOT, protect, sha, write_json
from .data import prepare
from .lora import export_state, install


def batch(rows, device, pad):
    width = max(len(x["ids"]) for x in rows)
    ids = torch.full((len(rows), width), pad, dtype=torch.long)
    mask = torch.zeros_like(ids)
    labels = torch.full_like(ids, -100)
    for i, row in enumerate(rows):
        n = len(row["ids"])
        ids[i, :n] = torch.tensor(row["ids"])
        labels[i, :n] = torch.tensor(row["labels"])
        mask[i, :n] = 1
    return ids.to(device), mask.to(device), labels.to(device)


def loss(model, tensors):
    ids, mask, labels = tensors
    hidden = model.base_model(input_ids=ids, attention_mask=mask, use_cache=False).last_hidden_state
    target = labels[:, 1:]
    selected = target != -100
    logits = model.get_output_embeddings()(hidden[:, :-1][selected]).float()
    return torch.nn.functional.cross_entropy(logits, target[selected], reduction="sum"), int(selected.sum())


def evaluate(model, rows, device, pad, size):
    model.eval()
    total = count = 0
    with torch.inference_mode():
        for start in range(0, len(rows), size):
            value, n = loss(model, batch(rows[start:start+size], device, pad))
            total += float(value)
            count += n
    model.train()
    return {"loss": total/count, "target_tokens": count, "examples": len(rows)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--mode", choices=["full", "lora"], required=True)
    ap.add_argument("--model", choices=["smol135", "smol360"], default="smol135")
    ap.add_argument("--steps", type=int, default=800)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--accumulate", type=int, default=2)
    ap.add_argument("--lr", type=float)
    ap.add_argument("--seed", type=int, default=1717)
    ap.add_argument("--eval-every", type=int, default=100)
    ap.add_argument("--patience", type=int, default=2)
    ap.add_argument("--aac-share", type=float, default=.25)
    ap.add_argument("--aac-only", action="store_true")
    ap.add_argument("--device", choices=["mps", "cpu"], default="mps")
    a = ap.parse_args()
    assert a.name.startswith("r4_ft_")
    assert 0 <= a.aac_share <= 1
    protect()
    out = CHECKPOINTS / a.name
    out.mkdir(exist_ok=False)
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    rng = random.Random(a.seed)
    if a.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS unavailable; choose CPU explicitly")
    repo, revision, license_name = MODELS[a.model]
    tokenizer = AutoTokenizer.from_pretrained(repo, revision=revision,
                cache_dir=ROOT / "methods/neural/hf-cache", local_files_only=True)
    samples = prepare(tokenizer)
    write_json(out / "train-manifest.json", json.loads((ART / "train-manifest.json").read_text()))
    net = AutoModelForCausalLM.from_pretrained(repo, revision=revision,
              cache_dir=ROOT / "methods/neural/hf-cache", local_files_only=True,
              dtype=torch.float32, attn_implementation="sdpa").to(a.device)
    selected = install(net) if a.mode == "lora" else []
    lr = a.lr if a.lr is not None else (2e-5 if a.mode == "full" else 2e-4)
    params = [p for p in net.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(params, lr=lr, betas=(.9,.999), eps=1e-8, weight_decay=.01)
    pad = tokenizer.pad_token_id or tokenizer.eos_token_id
    config = {**vars(a), "lr": lr, "base_repo": repo, "base_revision": revision,
              "dtype": "float32", "save_dtype": "float16", "trainable_parameters": sum(p.numel() for p in params),
              "total_parameters": sum(p.numel() for p in net.parameters()), "lora_rank": 8 if selected else None,
              "lora_alpha": 16 if selected else None, "lora_modules": selected, "lora_dropout": 0,
              "optimizer": "AdamW", "warmup_steps": 40, "schedule": "cosine, floor .1",
              "max_length": 128, "target_block": 48, "min_improvement": .002,
              "holdout_scope": "DailyDialog TRAIN overlap-component-disjoint only; all AAC stays in train",
              "aac_only_selection": "fixed budget; no DD holdout used" if a.aac_only else None,
              "data_manifest_sha256": sha(out / "train-manifest.json"),
              "source_sha256": {p.name: sha(p) for p in HERE.glob("*.py")},
              "torch": torch.__version__, "process_threads": torch.get_num_threads()}
    write_json(out / "recipe.json", config)
    log = out / "curve.jsonl"
    events = []

    def record(row):
        row["elapsed_seconds"] = time.monotonic() - started
        events.append(row)
        with log.open("a") as f:
            f.write(json.dumps(row) + "\n")
        print(json.dumps(row), flush=True)

    def save(step, val):
        state = export_state(net)
        temp = out / "best.tmp.safetensors"
        save_file(state, str(temp), metadata={"base_revision": revision,
                    "training_data": "aac_train_only" if a.aac_only else "aac_train+dailydialog_train",
                    "license": "apache-2.0+cc-by-4.0" if a.aac_only else "cc-by-nc-sa-4.0",
                    "step": str(step), "lm_head.weight": "model.embed_tokens.weight"})
        os.replace(temp, out / "model.safetensors")
        net.config.save_pretrained(out)
        receipt = {"name": a.name, "model": a.model, "base_revision": revision, "step": step,
                   "holdout": val, "sha256": sha(out / "model.safetensors"),
                   "weight_bytes": (out / "model.safetensors").stat().st_size,
                   "source_config_sha256": sha(out / "recipe.json"), "merged_lora": a.mode == "lora",
                   "licence": "Apache-2.0 base; CC BY 4.0 AAC" if a.aac_only else "CC BY-NC-SA 4.0 adaptation; Apache-2.0 base notices retained"}
        write_json(out / "receipt.json", receipt)
        return receipt

    started = time.monotonic()
    baseline = None if a.aac_only else evaluate(net, samples["holdout"], a.device, pad, a.batch)
    record({"kind": "validation", "step": 0, "holdout": baseline})
    best_loss = baseline["loss"] if baseline else float("inf")
    best_step, stale = 0, 0
    save(0, baseline)
    net.train()
    total_input = total_target = 0
    domain_tokens = {"aac": 0, "dd": 0}
    window_loss = window_n = 0
    for step in range(1, a.steps+1):
        scale = min(step/40, 1) if step <= 40 else .1 + .9*.5*(1+math.cos(math.pi*(step-40)/max(1,a.steps-40)))
        for group in optimizer.param_groups:
            group["lr"] = lr*scale
        optimizer.zero_grad(set_to_none=True)
        tensors = []
        for micro in range(a.accumulate):
            rows = []
            for _ in range(a.batch):
                domain = "aac" if a.aac_only or rng.random() < a.aac_share else "dd"
                row = rng.choice(samples[domain]); rows.append(row)
                domain_tokens[domain] += sum(x != -100 for x in row["labels"])
            tensors.append(batch(rows, a.device, pad))
        denominator = sum(int((t[2][:, 1:] != -100).sum()) for t in tensors)
        for t in tensors:
            value, n = loss(net, t)
            if not bool(torch.isfinite(value)):
                raise RuntimeError(f"Nonfinite loss at step {step}")
            (value/denominator).backward()
            window_loss += float(value.detach()); window_n += n
            total_target += n; total_input += int(t[1].sum())
        norm = torch.nn.utils.clip_grad_norm_(params, 1.)
        if not bool(torch.isfinite(norm)):
            raise RuntimeError(f"Nonfinite gradient at step {step}")
        optimizer.step()
        if step % 20 == 0:
            record({"kind": "train", "step": step, "loss": window_loss/window_n,
                    "lr": lr*scale, "input_tokens_seen": total_input, "target_tokens_seen": total_target,
                    "domain_target_tokens": dict(domain_tokens)})
            window_loss = window_n = 0
        if not a.aac_only and (step % a.eval_every == 0 or step == a.steps):
            val = evaluate(net, samples["holdout"], a.device, pad, a.batch)
            improved = val["loss"] < best_loss-.002
            if improved:
                best_loss, best_step, stale = val["loss"], step, 0
                checkpoint = save(step, val)
            else:
                stale += 1; checkpoint = None
            record({"kind": "validation", "step": step, "holdout": val, "improved": improved,
                    "checkpoint_sha256": checkpoint["sha256"] if checkpoint else None,
                    "best_step": best_step})
            if stale >= a.patience:
                record({"kind": "early_stop", "step": step, "reason": "train-only holdout patience"})
                break
    if a.aac_only:
        best_step = step
        save(step, None)
    if a.device == "mps":
        torch.mps.synchronize()
    report = {"config": config, "steps_executed": step, "best_step": best_step,
              "input_tokens_seen": total_input, "target_tokens_seen": total_target,
              "domain_target_tokens": domain_tokens, "wall_seconds": time.monotonic()-started,
              "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "mps_current_bytes": torch.mps.current_allocated_memory() if a.device == "mps" else None,
              "mps_driver_bytes": torch.mps.driver_allocated_memory() if a.device == "mps" else None,
              "checkpoint": json.loads((out / "receipt.json").read_text()), "errors": 0}
    write_json(out / "training.json", report)
    protect()
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
