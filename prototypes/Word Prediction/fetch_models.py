"""Download the optional rescoring model(s) into models/ (gitignored). The server runs without them.

  ../v0/.venv/bin/python fetch_models.py                 # the round-2 finalist (qwen2.5-1.5b)
  ../v0/.venv/bin/python fetch_models.py qwen3-1.7b qwen2.5-0.5b ...

Names and folders are engine/mlx_rescorer.CATALOG. Without any of them the server falls back to the
round-1 rescorer (v0's fine-tuned SmolLM2-135M on torch) and, without that, runs with no rescorer.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.mlx_rescorer import CATALOG, MODELS  # noqa: E402

REPOS = {
    "qwen2.5-0.5b": "Qwen/Qwen2.5-0.5B",
    "qwen2.5-1.5b": "Qwen/Qwen2.5-1.5B",
    "qwen2.5-3b": "Qwen/Qwen2.5-3B",
    "qwen3-0.6b": "Qwen/Qwen3-0.6B-Base",
    "qwen3-1.7b": "Qwen/Qwen3-1.7B-Base",
    "qwen3-4b": "Qwen/Qwen3-4B-Base",
    "smollm2-360m": "HuggingFaceTB/SmolLM2-360M",
    "smollm2-1.7b": "HuggingFaceTB/SmolLM2-1.7B",
}


def main():
    from huggingface_hub import snapshot_download
    names = sys.argv[1:] or ["qwen2.5-1.5b"]
    for name in names:
        repo = REPOS[name]
        target = MODELS / CATALOG[name]
        snapshot_download(repo, local_dir=target,
                          allow_patterns=["*.json", "*.safetensors", "merges.txt", "vocab.json", "tokenizer*"])
        print("fetched", repo, "->", target)


if __name__ == "__main__":
    main()
