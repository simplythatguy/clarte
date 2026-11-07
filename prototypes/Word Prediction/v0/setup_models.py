"""Refresh models/ from the research workspace, or fetch the pinned public pieces.

The models are committed in models/ (Git LFS), so normal use needs only git lfs pull.
This rebuilds that folder (or WORDPRED_MODELS) after a retrain; see MODEL_RECIPE.md.
"""
import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

from wordpred.paths import ARPA, BASE_REPO, BASE_REVISION, CHECKPOINT, models_dir

DEFAULT_SOURCE = Path('/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction')
ARPA_URL = 'https://data.imagineville.org/imagine/' + ARPA


def sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--no-download', action='store_true', help='Only use artifacts already on disk')
    args = parser.parse_args()
    root = models_dir()
    root.mkdir(parents=True, exist_ok=True)
    copied = {}

    def copy(source, target):
        if not source.is_file():
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = sha(source)
        if not target.is_file() or source.stat().st_size != target.stat().st_size or digest != sha(target):
            temp = target.with_name(target.name + '.partial')
            shutil.copyfile(source, temp)
            temp.replace(target)
        copied[str(target.relative_to(root))] = {'source': str(source), 'sha256': digest}
        print('Ready:', target, flush=True)

    copy(args.source / 'methods/ngram/models/counts_aac63k.pkl', root / 'counts_aac63k.pkl')
    copy(args.source / 'methods/ngram/models' / ARPA, root / ARPA)
    copy(args.source / 'methods/neural/vocabulary.json', root / 'vocabulary.json')
    checkpoint = args.source / 'methods/finetune/checkpoints' / CHECKPOINT
    if checkpoint.is_dir():
        for source in sorted(checkpoint.iterdir()):
            if source.is_file() and source.suffix in {'.json', '.jsonl', '.safetensors'}:
                copy(source, root / 'checkpoints' / CHECKPOINT / source.name)
    base = args.source / 'methods/neural/hf-cache/models--HuggingFaceTB--SmolLM2-135M/snapshots' / BASE_REVISION
    if base.is_dir():
        for source in sorted(base.iterdir()):
            if source.is_file() and (source.suffix in {'.json', '.txt', '.safetensors', '.md'} or source.name.startswith('LICENSE')):
                copy(source, root / 'base' / source.name)
    if not (root / ARPA).is_file() and not args.no_download:
        print('Downloading CC BY 4.0 ARPA:', ARPA_URL, flush=True)
        temp = (root / ARPA).with_name(ARPA + '.partial')
        urllib.request.urlretrieve(ARPA_URL, temp)
        temp.replace(root / ARPA)
        copied[ARPA] = {'source': ARPA_URL, 'sha256': sha(root / ARPA)}
    public_base = ('config.json', 'tokenizer.json', 'tokenizer_config.json', 'model.safetensors')
    if any(not (root / 'base' / name).is_file() for name in public_base) and not args.no_download:
        from huggingface_hub import snapshot_download
        downloaded = Path(snapshot_download(BASE_REPO, revision=BASE_REVISION,
                          allow_patterns=['*.json', 'merges.txt', 'model.safetensors', 'README.md', 'LICENSE*'], max_workers=2))
        for source in sorted(downloaded.iterdir()):
            if source.is_file():
                copy(source, root / 'base' / source.name)
    receipt = root / 'model-provenance.json'
    previous = json.loads(receipt.read_text()) if receipt.is_file() else {}
    previous.update(copied)
    receipt.write_text(json.dumps(previous, indent=2) + '\n')
    for name, artifact in [('count model', root / 'counts_aac63k.pkl'),
                           ('neural vocabulary', root / 'vocabulary.json'),
                           ('fine-tuned checkpoint', root / 'checkpoints' / CHECKPOINT / 'model.safetensors')]:
        if not artifact.is_file():
            print(f'MISSING {name}: {artifact}. Rebuild with the exact upstream recipe in MODEL_RECIPE.md.', flush=True)
    print('Model directory:', root)
    print('Run python build.py before starting a server.')


if __name__ == '__main__':
    main()
