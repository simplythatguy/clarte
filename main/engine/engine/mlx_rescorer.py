"""Exact transformer rescoring on Apple's MLX (GPU): same contract as neural.Rescorer, bigger models.

score(prompt, words) = log P(word tokens | prompt) + log P(word boundary | prompt, word), summed over
the lower-case and Capitalised spellings. The prompt's keys and values are kept in an mlx-lm KV
cache and extended when the next prompt starts with the previous one (autoregressive property).
Candidates are scored in one forward pass over a token-trie forest: every distinct candidate
prefix is one position; each node attends to the prompt and to its own ancestors only (a boolean
mask) and gets its own rotary position (prompt length + depth), applied by placing the nodes on the
batch axis so `rope` takes one offset per node.

Only decoder blocks of the Qwen2/Qwen3/Llama shape are supported (input_layernorm -> q/k/v/o
projections [+ q_norm/k_norm] -> post_attention_layernorm -> gated MLP), which covers Qwen2.5,
Qwen3 and SmolLM2/Llama-3.2 checkpoints.
"""
import json
import time
from pathlib import Path

import numpy as np

MODELS = Path(__file__).resolve().parents[1] / "models"
PUNCT = set(".,!?;:'\")(-…\n")
SUPPORTED = {"qwen2", "qwen3", "llama"}

# name -> folder under models/ (HF or MLX format; mlx-lm reads both)
CATALOG = {
    "qwen2.5-0.5b": "Qwen2.5-0.5B",
    "qwen2.5-1.5b": "Qwen2.5-1.5B",
    "qwen2.5-3b": "Qwen2.5-3B",
    "qwen3-0.6b": "Qwen3-0.6B-Base",
    "qwen3-1.7b": "Qwen3-1.7B-Base",
    "qwen3-4b": "Qwen3-4B-Base",
    "smollm2-360m": "SmolLM2-360M",
    "smollm2-1.7b": "SmolLM2-1.7B",
    "llama-3.2-1b": "Llama-3.2-1B-bf16",
}


def common_prefix(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def present(name):
    folder = MODELS / CATALOG.get(name, name)
    return folder.is_dir() and (folder / "config.json").is_file() and any(folder.glob("*.safetensors"))


class MLXRescorer:
    def __init__(self, name="qwen2.5-0.5b", max_tokens=512, max_turns=24, adapter=None):
        import mlx.core as mx
        from mlx_lm import load
        from mlx_lm.models.cache import make_prompt_cache
        self.mx = mx
        self.name = name
        self.device = "mlx"
        self.max_tokens, self.max_turns = max_tokens, max_turns
        folder = MODELS / CATALOG.get(name, name)
        if not present(name):
            raise FileNotFoundError(f"{folder} (run fetch_models.py {name})")
        self.model, self.tokenizer = load(str(folder), adapter_path=adapter)
        cfg = json.loads((folder / "config.json").read_text())
        if cfg.get("model_type") not in SUPPORTED:
            raise ValueError(f"unsupported model_type {cfg.get('model_type')} for the forest pass")
        self.inner = self.model.model
        self.layers = self.inner.layers
        self.head = (self.inner.embed_tokens.as_linear if getattr(self.model.args, "tie_word_embeddings", False)
                     else self.model.lm_head)
        self.make_cache = lambda: make_prompt_cache(self.model)
        tok = self.tokenizer
        vocab_size = cfg["vocab_size"]
        boundary = np.zeros(vocab_size, dtype=bool)
        for tid in range(min(vocab_size, len(tok))):
            s = tok.decode([tid])
            if not s or s[0].isspace() or all(c in PUNCT or c.isspace() for c in s):
                boundary[tid] = True
        if tok.eos_token_id is not None:
            boundary[tok.eos_token_id] = True
        self.boundary = mx.array(boundary)
        self.vocab_size = vocab_size
        self._name_mask = None
        self.bos = tok.bos_token_id if getattr(tok, "bos_token_id", None) is not None else None
        self.pad = tok.eos_token_id or 0
        self.prev_ids, self.cache, self.prev_last = [], None, None
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
        mx = self.mx
        ids = self.tokenizer.encode(text, add_special_tokens=False)
        if len(ids) > self.max_tokens:
            ids = ids[-self.max_tokens:]
        if self.bos is not None:
            ids = [self.bos] + ids
        if not ids:
            ids = [self.pad]
        shared = common_prefix(self.prev_ids, ids) if self.cache is not None else 0
        if shared == len(ids) == len(self.prev_ids):
            return len(ids), self.prev_last
        if shared > 0:
            # Autoregressive property: positions before the first changed token keep their keys and values, so a
            # growing partner transcript ("Partner: where would you\nMe:" -> "Partner: where would you like\nMe:")
            # recomputes the tail only, not the whole prompt.
            shared = min(shared, len(ids) - 1)
            new = ids[shared:]
            for c in self.cache:
                c.trim(c.offset - shared)
            logits = self.model(mx.array([new]), cache=self.cache)
        else:
            self.cache = self.make_cache()
            logits = self.model(mx.array([ids]), cache=self.cache)
        last = logits[0, -1].astype(mx.float32)
        last = last - mx.logsumexp(last)
        mx.eval(last, *[c.keys for c in self.cache])
        self.prev_ids, self.prev_last = ids, last
        return len(ids), last

    def _forest(self, tokens, positions, mask):
        """Hidden states for N trie nodes attending to the cached prompt and their own ancestors."""
        mx = self.mx
        N = len(tokens)
        pos = mx.array(positions, dtype=mx.int32)
        h = self.inner.embed_tokens(mx.array([tokens]))                 # [1, N, D]
        for layer, c in zip(self.layers, self.cache):
            a = layer.self_attn
            x = layer.input_layernorm(h)
            q = a.q_proj(x).reshape(1, N, a.n_heads, -1)
            k = a.k_proj(x).reshape(1, N, a.n_kv_heads, -1)
            v = a.v_proj(x).reshape(1, N, a.n_kv_heads, -1).transpose(0, 2, 1, 3)
            if hasattr(a, "q_norm"):
                q, k = a.q_norm(q), a.k_norm(k)
            # nodes on the batch axis so each gets its own rotary position, then back to [1, H, N, D]
            q = a.rope(q.transpose(1, 2, 0, 3), offset=pos).transpose(2, 1, 0, 3)
            k = a.rope(k.transpose(1, 2, 0, 3), offset=pos).transpose(2, 1, 0, 3)
            K = mx.concatenate([c.keys[..., :c.offset, :], k], axis=2)
            V = mx.concatenate([c.values[..., :c.offset, :], v], axis=2)
            o = mx.fast.scaled_dot_product_attention(q, K, V, scale=a.scale, mask=mask)
            h = h + a.o_proj(o.transpose(0, 2, 1, 3).reshape(1, N, -1))
            h = h + layer.mlp(layer.post_attention_layernorm(h))
        return self.head(self.inner.norm(h))[0].astype(mx.float32)          # [N, V]

    def name_mass(self, text, common):
        """How likely the next word is a name: the probability that the next token starts a capitalised word
        that is not an everyday word (`common`) and not I: "my name is" 0.45, "Hi, I'm Sarah. What's your
        name?" 0.62, "hi I'm" 0.41, "i'm" 0.02, "i feel" 0.001. Reuses the prompt's cached keys and values,
        so it costs no extra model pass when the candidates are scored after it."""
        mx = self.mx
        if self._name_mask is None:
            import re
            mask = np.zeros(self.vocab_size, dtype=bool)
            for token, i in self.tokenizer.get_vocab().items():
                if i >= self.vocab_size:
                    continue
                piece = self.tokenizer.convert_tokens_to_string([token])
                m = re.match(r"^ ([A-Z][a-z]+)", piece)
                if m and m.group(1).lower() not in common and not piece.startswith((" I'", " I ")):
                    mask[i] = True
            self._name_mask = mx.array(mask)
        _, last = self._prefix(text)
        return float(mx.exp(mx.logsumexp(mx.where(self._name_mask[: last.shape[0]], last, -mx.inf))))

    def score(self, text, words):
        """Log probability of each word followed by a word boundary, given the prompt text."""
        mx = self.mx
        t0 = time.perf_counter()
        n, last = self._prefix(text)
        t1 = time.perf_counter()
        seqs, owner = [], []
        for i, w in enumerate(words):
            for s in self._encode_word(w):
                seqs.append(s)
                owner.append(i)
        if not seqs:
            return np.zeros(0)
        nodes = sorted({s[:d] for s in seqs for d in range(1, len(s) + 1)}, key=lambda t: (len(t), t))
        index = {node: i for i, node in enumerate(nodes)}
        N = len(nodes)
        mask = np.zeros((N, n + N), dtype=bool)
        mask[:, :n] = True
        for row, node in enumerate(nodes):
            for d in range(1, len(node) + 1):
                mask[row, n + index[node[:d]]] = True
        logits = self._forest([node[-1] for node in nodes], [n + len(node) - 1 for node in nodes], mx.array(mask))
        lse = mx.logsumexp(logits, axis=-1)
        lse_b = mx.logsumexp(mx.where(self.boundary, logits, -mx.inf), axis=-1)
        step_rows, step_targets, step_owner = [], [], []
        for i, s in enumerate(seqs):
            for d in range(1, len(s)):
                step_rows.append(index[s[:d]])
                step_targets.append(s[d])
                step_owner.append(i)
        B = len(seqs)
        total = last[mx.array([s[0] for s in seqs])]
        if step_rows:
            r = mx.array(step_rows)
            vals = logits[r, mx.array(step_targets)] - lse[r]
            total = total + mx.zeros(B).at[mx.array(step_owner)].add(vals)
        ends = mx.array([index[s] for s in seqs])
        total = total + lse_b[ends] - lse[ends]
        total = np.array(total.tolist())
        scores = np.full(len(words), -np.inf)
        for v, i in zip(total, owner):
            scores[i] = np.logaddexp(scores[i], v)
        t2 = time.perf_counter()
        self.last_ms = {"prefix": 1000 * (t1 - t0), "candidates": 1000 * (t2 - t1), "tokens": n, "batch": B, "nodes": N}
        return scores

    def naive_score(self, text, words):
        """Reference: score each spelling by running prompt + word tokens as one plain sequence."""
        mx = self.mx
        ids = self.tokenizer.encode(text, add_special_tokens=False)[-self.max_tokens:]
        if self.bos is not None:
            ids = [self.bos] + ids
        scores = np.full(len(words), -np.inf)
        for i, w in enumerate(words):
            for s in self._encode_word(w):
                logits = self.model(mx.array([ids + list(s)]))[0].astype(mx.float32)
                lp = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
                tot = sum(float(lp[len(ids) - 1 + d, s[d]]) for d in range(len(s)))
                end = lp[len(ids) + len(s) - 1]
                tot += float(mx.logsumexp(mx.where(self.boundary, end, -mx.inf)))
                scores[i] = np.logaddexp(scores[i], tot)
        return scores

    def reset(self):
        self.prev_ids, self.cache, self.prev_last = [], None, None
