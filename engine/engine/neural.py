"""Exact transformer rescoring of candidate words against a KV-cached conversation prompt.

score(prompt, words) returns log P(word tokens | prompt) + log P(word boundary | prompt, word),
summed over the lower-case and Capitalised spellings. The prompt's keys and values are reused
across requests whenever the new prompt extends the previous one (the autoregressive property:
earlier positions never attend to later ones, so their keys and values do not change).
"""
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from wordpred.paths import models_dir

MODELS = models_dir()
V0_MODELS = MODELS
PUNCT = set(".,!?;:'\")(-…\n")


# `auto` takes the first of these that is present: the round-2 finalist (MLX, GPU) first, then the
# round-1 torch model, which needs nothing but v0's checkpoint.
PREFERENCE = ("qwen2.5-1.5b", "qwen3-1.7b", "qwen2.5-0.5b", "smol135-ft")


def available():
    """Rescoring models present on disk, in `auto` preference order."""
    from .mlx_rescorer import present as mlx_present
    out = []
    for name in PREFERENCE:
        if name == "smol135-ft":
            if (V0_MODELS / "checkpoints" / "r4_ft_full135_v2" / "model.safetensors").is_file():
                out.append(name)
        elif mlx_present(name):
            try:
                import mlx.core  # noqa: F401
            except ImportError:
                continue
            out.append(name)
    return out


def make_rescorer(name, threads=4, max_tokens=512, max_turns=24, adapter=None):
    """smol135-ft runs on torch (CPU); every other name is an MLX model from mlx_rescorer.CATALOG."""
    if name == "smol135-ft":
        return Rescorer(name, threads=threads, max_tokens=max_tokens, max_turns=max_turns)
    from .mlx_rescorer import MLXRescorer
    return MLXRescorer(name, max_tokens=max_tokens, max_turns=max_turns, adapter=adapter)


class Rescorer:
    def __init__(self, name="smol135-ft", device="auto", threads=4, max_tokens=512, max_turns=24):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.torch = torch
        self.name = name
        self.max_tokens, self.max_turns = max_tokens, max_turns
        self.device = device = "cpu" if device == "auto" else device
        dtype = torch.float16 if device == "mps" else torch.float32
        if name == "smol135-ft":
            base = V0_MODELS / "base"
            ckpt = V0_MODELS / "checkpoints" / "r4_ft_full135_v2"
            receipt = json.loads((ckpt / "receipt.json").read_text())
            if hashlib.sha256((ckpt / "model.safetensors").read_bytes()).hexdigest() != receipt["sha256"]:
                raise ValueError("fine-tuned checkpoint hash differs from its receipt")
            self.tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
            self.net = AutoModelForCausalLM.from_pretrained(base, local_files_only=True, dtype=dtype,
                                                            attn_implementation="sdpa").eval()
            from safetensors.torch import load_model
            missing, unexpected = load_model(self.net, str(ckpt / "model.safetensors"))
            if missing or unexpected:
                raise ValueError("checkpoint tensor mismatch")
        else:
            raise ValueError(f"unknown torch rescoring model {name}")
        self.net.to(device)
        if device == "cpu":
            torch.set_num_threads(threads)
        vocab_size = self.net.get_output_embeddings().weight.shape[0]
        boundary = np.zeros(vocab_size, dtype=bool)
        for tid in range(min(vocab_size, len(self.tokenizer))):
            s = self.tokenizer.decode([tid])
            if not s or s[0].isspace() or all(c in PUNCT or c.isspace() for c in s):
                boundary[tid] = True
        if self.tokenizer.eos_token_id is not None:
            boundary[self.tokenizer.eos_token_id] = True
        self.boundary = torch.tensor(boundary, device=device)
        self.pad = self.tokenizer.eos_token_id or 0
        self.prev_ids, self.prev_kv, self.prev_last = [], None, None
        self.encode_cache = {}
        self.last_ms = {}

    def prompt(self, history, message):
        turns = history[-self.max_turns:]
        text = "\n".join(("Me: " if role == "user" else "Partner: ") + t for role, t in turns)
        return (text + "\n" if text else "") + "Me:" + (" " + " ".join(message) if message else "")

    def _encode_word(self, word):
        seqs = self.encode_cache.get(word)
        if seqs is None:
            forms = {word, word[0].upper() + word[1:]}
            seqs = sorted({tuple(self.tokenizer.encode(" " + f, add_special_tokens=False)) for f in forms})
            self.encode_cache[word] = seqs
        return seqs

    def _prefix(self, text):
        torch = self.torch
        ids = self.tokenizer.encode(text, add_special_tokens=False)
        if len(ids) > self.max_tokens:
            ids = ids[-self.max_tokens:]
        if not ids:
            ids = [self.pad]
        from .mlx_rescorer import common_prefix
        shared = common_prefix(self.prev_ids, ids) if self.prev_kv is not None else 0
        if shared == len(ids) == len(self.prev_ids):
            return self.prev_kv, len(ids), self.prev_last
        if shared > 0:
            shared = min(shared, len(ids) - 1)       # keep the shared positions' keys/values, run the changed tail
            new = ids[shared:]
            self.prev_kv.crop(shared)
            out = self.net(input_ids=torch.tensor([new], device=self.device), past_key_values=self.prev_kv, use_cache=True)
        else:
            out = self.net(input_ids=torch.tensor([ids], device=self.device), use_cache=True)
        last = torch.log_softmax(out.logits[0, -1].float(), -1)
        self.prev_ids, self.prev_kv, self.prev_last = ids, out.past_key_values, last
        return out.past_key_values, len(ids), last

    def score(self, text, words):
        """Log probability of each word followed by a word boundary, given the prompt text."""
        torch = self.torch
        t0 = time.perf_counter()
        with torch.inference_mode():
            kv, n, last = self._prefix(text)
            t1 = time.perf_counter()
            seqs, owner = [], []
            for i, w in enumerate(words):
                for s in self._encode_word(w):
                    seqs.append(s)
                    owner.append(i)
            if not seqs:
                return np.zeros(0)
            # One forward pass over a token-trie forest: every distinct candidate prefix is one
            # position; a 4D mask lets each node attend to the context and its own ancestors only
            # (the paper's masking, applied to a forest instead of a line), so shared first tokens
            # are computed once and the context's keys and values are never duplicated.
            nodes = sorted({s[:d] for s in seqs for d in range(1, len(s) + 1)}, key=lambda t: (len(t), t))
            index = {node: i for i, node in enumerate(nodes)}
            N = len(nodes)
            dtype = self.net.get_input_embeddings().weight.dtype
            mask = torch.full((1, 1, N, n + N), torch.finfo(dtype).min, dtype=dtype, device=self.device)
            mask[:, :, :, :n] = 0
            rows_i, cols_i = [], []
            for row, node in enumerate(nodes):
                for d in range(1, len(node) + 1):
                    rows_i.append(row)
                    cols_i.append(n + index[node[:d]])
            mask[0, 0, rows_i, cols_i] = 0
            from transformers.cache_utils import DynamicCache
            cache = DynamicCache(ddp_cache_data=[(k, v) for k, v in kv.to_legacy_cache()])
            out = self.net.base_model(input_ids=torch.tensor([[node[-1] for node in nodes]], device=self.device),
                                      position_ids=torch.tensor([[n + len(node) - 1 for node in nodes]], device=self.device),
                                      attention_mask=mask, past_key_values=cache, use_cache=False)
            logits = self.net.get_output_embeddings()(out.last_hidden_state[0]).float()   # [N, V]
            lse = torch.logsumexp(logits, -1)
            lse_b = torch.logsumexp(logits.masked_fill(~self.boundary, float("-inf")), -1)
            step_rows, step_targets, step_owner = [], [], []
            for i, s in enumerate(seqs):
                for d in range(1, len(s)):
                    step_rows.append(index[s[:d]])
                    step_targets.append(s[d])
                    step_owner.append(i)
            B = len(seqs)
            total = last[torch.tensor([s[0] for s in seqs], device=self.device)].clone()
            if step_rows:
                r = torch.tensor(step_rows, device=self.device)
                vals = logits[r, torch.tensor(step_targets, device=self.device)] - lse[r]
                total.index_add_(0, torch.tensor(step_owner, device=self.device), vals)
            ends = torch.tensor([index[s] for s in seqs], device=self.device)
            total = (total + lse_b[ends] - lse[ends]).cpu().numpy()
        scores = np.full(len(words), -np.inf)
        for v, i in zip(total, owner):
            scores[i] = np.logaddexp(scores[i], v)
        t2 = time.perf_counter()
        self.last_ms = {"prefix": 1000 * (t1 - t0), "candidates": 1000 * (t2 - t1), "tokens": n, "batch": B, "nodes": N}
        return scores

    def reset(self):
        self.prev_ids, self.prev_kv, self.prev_last = [], None, None
