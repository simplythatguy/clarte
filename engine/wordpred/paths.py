"""Artifact locations; the models ship in this folder's models/ (Git LFS)."""
import os
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
BASE_REVISION = "93efa2f097d58c2a74874c7e644dbc9b0cee75a2"
BASE_REPO = "HuggingFaceTB/SmolLM2-135M"
CHECKPOINT = "r4_ft_full135_v2"
ARPA = "lm_mix_top3_4gram_abs0.0.arpa.gz"
# Unpickling runs code, so the count model must be the research build byte for byte.
COUNTS_SHA256 = "9a0534eb23a7c505e79a4047389b95512668dbdd871870bbbdf8574ecea5bf4b"
LIBRARY_SUFFIX = {"darwin": ".dylib", "win32": ".dll"}.get(sys.platform, ".so")


def models_dir():
    return Path(os.environ.get("WORDPRED_MODELS", PACKAGE_ROOT / "models")).expanduser().resolve()


def library(name):
    path = PACKAGE_ROOT / "build" / (name + LIBRARY_SUFFIX)
    if not path.is_file():
        raise FileNotFoundError(f"Missing native library {path}. Run python build.py in {PACKAGE_ROOT}.")
    return path


def require_models(model):
    root = models_dir()
    if model == "deployable":
        checkpoint = root / "checkpoints" / CHECKPOINT
        needed = [checkpoint / f for f in ("model.safetensors", "receipt.json", "training.json")]
        if any(not p.is_file() for p in needed):
            raise FileNotFoundError(f"Deployable needs the completed fine-tuned checkpoint {checkpoint}. "
                                    "Run git lfs pull, or rebuild using MODEL_RECIPE.md. "
                                    "Use model='light' until then.")
        needed += [root / "vocabulary.json", root / "base" / "model.safetensors",
                   root / "base" / "config.json", root / "base" / "tokenizer.json"]
    else:
        needed = []
    needed += [root / "counts_aac63k.pkl", root / ARPA]
    missing = [str(p) for p in needed if not p.is_file()]
    if missing:
        raise FileNotFoundError("Missing model artifacts: " + ", ".join(missing) + ". Run setup_models.py; see MODEL_RECIPE.md.")
    return root
