# Optional rescoring models (not in git)

Everything in this folder except this file and `.gitignore` is ignored by git.

- `Qwen2.5-1.5B/` (Apache-2.0, Alibaba Cloud): the round-2 finalist, `.venv/bin/python ../fetch_models.py`
  (3.1 GB, HF safetensors; mlx-lm loads them directly). `server.py` picks it up automatically.
- Other folders of `engine/mlx_rescorer.CATALOG` (`Qwen2.5-0.5B`, `Qwen2.5-3B`, `Qwen3-0.6B-Base`,
  `Qwen3-1.7B-Base`, `Qwen3-4B-Base`, `SmolLM2-360M`, `SmolLM2-1.7B`): fetched during the experiments
  with `../fetch_models.py NAME`; usable with `--rescorer NAME` when the catalog entry is present; see
  RESULTS.md for what was measured. `Qwen3-0.6B/` is the instruct checkpoint from round 1 and unused.
- `adapters/`: LoRA adapters written by `../train_lora.py train` (none shipped).

Without any of them the server falls back to v0's fine-tuned SmolLM2-135M on torch
(`checkpoints/r4_ft_full135_v2`), and without that it still starts (`--model light`).
