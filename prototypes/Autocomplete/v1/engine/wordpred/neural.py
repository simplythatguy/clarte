"""The selected live CPU2 packed SmolLM2-135M fine-tuned word scorer."""
import hashlib
import json

import numpy as np

from .context import code_of
from .paths import BASE_REVISION, CHECKPOINT


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class NeuralScorer:
    def __init__(self, root):
        self.root = root
        self.checkpoint = root / "checkpoints" / CHECKPOINT
        self.receipt = json.loads((self.checkpoint / "receipt.json").read_text())
        if not (self.checkpoint / "training.json").is_file() or self.receipt["step"] == 0:
            raise ValueError("Only completed, nonzero-step checkpoints can be evaluated")
        if self.receipt["model"] != "smol135" or self.receipt["base_revision"] != BASE_REVISION:
            raise ValueError("Fine-tuned checkpoint and pinned SmolLM2 tokenizer/config do not match")
        if sha(self.checkpoint / "model.safetensors") != self.receipt["sha256"]:
            raise ValueError("Checkpoint hash differs from receipt")
        self.weight, self.max_context = 0.9, 128
        self.first_tokens, self.multi_limit = 8, 16
        self.device, self.threads = "cpu", 2
        self.position_key = None
        self.net = None
        self.prev_ids, self.prev_kv = [], None
        vocab = json.loads((root / "vocabulary.json").read_bytes())["words"]
        self.words = [r["word"] for r in vocab]
        self.unigram = np.array([r["frequency"] for r in vocab], dtype=np.float64)
        self.unigram /= self.unigram.sum()
        self.prefixes = {}
        for i, word in enumerate(self.words):
            code = code_of(word)
            for k in range(len(code) + 1):
                self.prefixes.setdefault(code[:k], []).append(i)
        self.prefixes = {p: np.array(idx, dtype=np.int32) for p, idx in self.prefixes.items()}

    def start_conversation(self, conv_id):
        self.position_key = None
        self.prev_ids, self.prev_kv = [], None

    def prompt(self, ctx):
        history = "\n".join(("Me: " if role == "user" else "Partner: ") + text
                            for role, text in ctx.history[-6:])
        return (history + "\n" if history else "") + "Me:" + (" " + " ".join(ctx.message) if ctx.message else "")

    def _load(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.torch = torch
        torch.set_num_threads(self.threads)
        if torch.get_num_interop_threads() != 1:
            torch.set_num_interop_threads(1)
        base = self.root / "base"
        self.tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
        self.net = AutoModelForCausalLM.from_pretrained(base, local_files_only=True, torch_dtype=torch.float32,
                                                       attn_implementation="sdpa").eval().to(self.device)
        self.sequences = []
        self.single_ids, self.single_words = [], []
        self.multi = []
        for wi, word in enumerate(self.words):
            forms = {word}
            forms.add(word[0].upper() + word[1:])
            seen = set()
            for form in sorted(forms):
                seq = tuple(self.tokenizer.encode(" " + form, add_special_tokens=False))
                if seq in seen:
                    continue
                seen.add(seq)
                self.sequences.append((wi, seq))
                if len(seq) == 1:
                    self.single_ids.append(seq[0])
                    self.single_words.append(wi)
                else:
                    self.multi.append((wi, seq))
        self.single_ids = np.array(self.single_ids)
        self.single_words = np.array(self.single_words)
        self.multi_roots = np.array([seq[0] for _, seq in self.multi])
        self.multi_words = np.array([wi for wi, _ in self.multi])
        from safetensors.torch import load_model
        if sha(self.checkpoint / "model.safetensors") != self.receipt["sha256"]:
            raise ValueError("Checkpoint changed between construction and loading")
        missing, unexpected = load_model(self.net, str(self.checkpoint / "model.safetensors"))
        if missing or unexpected:
            raise ValueError(f"Checkpoint tensor mismatch: missing={missing}, unexpected={unexpected}")
        self.net.eval()

    def _repeat_cache(self, cache, n):
        from transformers.cache_utils import DynamicCache
        old = cache.to_legacy_cache() if hasattr(cache, "to_legacy_cache") else cache
        return DynamicCache(ddp_cache_data=[(key.expand(n, -1, -1, -1), value.expand(n, -1, -1, -1))
                                           for key, value in old])

    def _batch(self, seqs, kv, context_len):
        torch = self.torch
        if not seqs:
            return np.empty(0)
        sequences = [tuple(seq) for seq in seqs]
        prefixes = {seq[:depth] for seq in sequences
                    for depth in range(1, len(seq))}
        if not prefixes:
            return np.zeros(len(sequences), dtype=np.float32)
        nodes = sorted(prefixes, key=lambda node: (len(node), node))
        index = {node: i for i, node in enumerate(nodes)}
        n = len(nodes)
        dtype = self.net.get_input_embeddings().weight.dtype
        mask = torch.full((1, 1, n, context_len + n), torch.finfo(dtype).min,
                          dtype=dtype, device=self.device)
        mask[:, :, :, :context_len] = 0
        for row, node in enumerate(nodes):
            ancestors = [context_len + index[node[:depth]] for depth in range(1, len(node) + 1)]
            mask[0, 0, row, ancestors] = 0
        # Physical cache slots enumerate all forest nodes. Logical token
        # positions follow each node's depth, including when branches share it.
        out = self.net.base_model(
            input_ids=torch.tensor([[node[-1] for node in nodes]], device=self.device),
            position_ids=torch.tensor([[context_len + len(node) - 1 for node in nodes]], device=self.device),
            attention_mask=mask, past_key_values=self._repeat_cache(kv, 1), use_cache=False)
        logits = self.net.get_output_embeddings()(out.last_hidden_state[0]).float()
        normalizer = torch.logsumexp(logits, dim=-1)
        owners, rows, targets = [], [], []
        for i, seq in enumerate(sequences):
            for depth in range(1, len(seq)):
                owners.append(i); rows.append(index[seq[:depth]]); targets.append(seq[depth])
        sums = torch.zeros(len(sequences), dtype=torch.float32, device=self.device)
        if owners:
            values = logits[rows, targets] - normalizer[rows]
            sums.index_add_(0, torch.tensor(owners, device=self.device), values)
        return sums.cpu().numpy()

    def _infer(self, prompt):
        if self.net is None:
            self._load()
        torch = self.torch
        ids = self.tokenizer.encode(prompt, add_special_tokens=False)[-self.max_context:]
        if not ids:
            ids = [self.tokenizer.bos_token_id or self.tokenizer.eos_token_id]
        with torch.inference_mode():
            reuse = self.prev_kv is not None and len(ids) > len(self.prev_ids) and ids[:len(self.prev_ids)] == self.prev_ids
            input_ids = ids[len(self.prev_ids):] if reuse else ids
            args = {"past_key_values": self.prev_kv} if reuse else {}
            out = self.net.base_model(input_ids=torch.tensor([input_ids], device=self.device), use_cache=True, **args)
            logits = self.net.get_output_embeddings()(out.last_hidden_state[:, -1]).float()[0]
            root_lp = (logits - torch.logsumexp(logits, dim=0)).cpu().numpy()
            kv = out.past_key_values
            self.prev_ids, self.prev_kv = ids, kv
            mass = np.zeros(len(self.words), dtype=np.float64)
            np.add.at(mass, self.single_words, np.exp(root_lp[self.single_ids]))
            # A token-trie root screen. Bound the active continuation frontier by
            # model root probability, then split its mass by a frequency prior.
            roots = np.unique(self.multi_roots)
            top_roots = roots[np.argsort(-root_lp[roots], kind="stable")[:self.first_tokens]]
            active = np.flatnonzero(np.isin(self.multi_roots, top_roots))
            priority = root_lp[self.multi_roots[active]] + 0.35 * np.log(self.unigram[self.multi_words[active]])
            active = active[np.argsort(-priority, kind="stable")[:self.multi_limit]]
            for start in range(0, len(active), 32):
                indices = active[start:start + 32]
                seqs = [self.multi[j][1] for j in indices]
                tail = self._batch(seqs, kv, len(ids))
                for j, lp in zip(indices, tail):
                    wi, seq = self.multi[j]
                    mass[wi] += np.exp(float(root_lp[seq[0]]) + float(lp))
        # Quantize identically before returning and storing: replay rankings
        # must not silently differ from a live pass because of storage precision.
        return np.log(np.maximum(mass, 1e-40)).astype(np.float16)

    def _position(self, ctx):
        logs = self._infer(self.prompt(ctx))
        probability = np.exp(logs.astype(np.float64))
        probability /= probability.sum()
        self.scores = self.weight * probability + (1 - self.weight) * self.unigram

    def rank(self, ctx, code):
        key = (ctx.conv_id, ctx.history, ctx.message)
        if key != self.position_key:
            self._position(ctx)
            self.position_key = key
        idx = self.prefixes.get(code)
        if idx is None:
            return []
        order = np.argsort(-self.scores[idx], kind="stable")
        return [self.words[i] for i in idx[order][:12]]
