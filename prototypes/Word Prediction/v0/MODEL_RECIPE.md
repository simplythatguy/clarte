# Model artifacts and exact upstream recipe

The selected models are committed in `models/` with Git LFS; `models/SHA256SUMS`
lists their hashes. This recipe is for rebuilding them. `setup_models.py` copies a
rebuild from the research workspace into `models/` (or `WORDPRED_MODELS`). It does not retrain, read test examples, or substitute the unfine-tuned base for
the selected checkpoint. Pickle counts must come from the trusted research
source or your own rebuild, since loading a pickle executes Python code.

The source snapshot is:

```
/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction
```

That scratch is not a git checkout. [PORT_PROVENANCE.json](PORT_PROVENANCE.json)
fingerprints the exact scripts; retain the source and its input receipts to
rebuild. The training tools remain in that research workspace; they are not
extra runtime code in this package.

## Public downloads

Setup fetches these if no local copy is available:

- `https://data.imagineville.org/imagine/lm_mix_top3_4gram_abs0.0.arpa.gz`
  (Vertanen & Kristensson, CC BY 4.0).
- `HuggingFaceTB/SmolLM2-135M`, revision
  `93efa2f097d58c2a74874c7e644dbc9b0cee75a2` (Apache-2.0), including tokenizer,
  config and base safetensors. It never requests a floating latest revision.

The selected counts, neural `vocabulary.json` and fine-tuned weights are derived
artifacts, not public model downloads in this package. Without the research
copies, rebuild them before prediction. Merely downloading the base model does
not produce Deployable.

## Count prior and neural vocabulary

Exact upstream source: `methods/ngram/train.py`; neural vocabulary recipe:
`methods/neural/prepare.py`. Run in the source workspace with its data prepared:

```sh
W='/Users/aamia/.t3/scratch/2026-11-06-build-and-fully-verify-an-e4b71fc3/research/four-zone-prediction'
cd "$W"
mkdir -p methods/ngram/artifacts methods/ngram/models methods/ngram/receipts
python3 -m venv methods/ngram/.venv
methods/ngram/.venv/bin/python -m pip install -r methods/ngram/requirements.txt
methods/ngram/.venv/bin/python -m methods.ngram.train --aac-vocabulary
methods/neural/.venv/bin/python -m methods.neural.prepare
```

The count recipe reads only the frozen 20k wordfreq list,
`../../brainstorm/grouping-sol/data/wordfreq-large_en.msgpack.gz`,
`data/raw/aac/unz/aac_comm/sent_train_aac.txt`,
`data/raw/aac/unz/aac_comm/vocab_aac_twitter.txt`, and
`data/raw/dailydialog/train.parquet`. Vocabulary is sorted union of the baseline,
all train words, common contractions, and supplied AAC/Twitter words. The output
is `methods/ngram/models/counts_aac63k.pkl`; its receipt is
`methods/ngram/artifacts/training_aac63k.json`. Train-only trigram counts include
two sentence starts and distinct-left-context lower-order continuation counts.

The neural vocabulary keeps the baseline frequencies and adds train words with
count >=2 at train-count/train-total mass, ordered by decreasing frequency then
word. It writes `methods/neural/vocabulary.json`. No dev or test text is used.

## Selected full fine-tune

Exact upstream implementation and recipe:
`methods/finetune/{README.md,train.py,data.py}`. From the prepared research root:

```sh
export PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=6 OPENBLAS_NUM_THREADS=1 TOKENIZERS_PARALLELISM=false
methods/neural/.venv/bin/python -m methods.finetune.verify
methods/neural/.venv/bin/python -m methods.finetune.check_copy
methods/neural/.venv/bin/python -m methods.finetune.train --name r4_ft_full135_v2 --mode full --steps 800
```

The upstream driver refuses to overwrite a completed run. On the existing source,
reuse the completed artifact instead of rerunning this command; a fresh experiment
must use a fresh run name and retain its own receipt. Copy its completed directory
to `checkpoints/r4_ft_full135_v2` in an independently selected model directory if
using the fixed runtime name. Independently retrained weights need not reproduce
the frozen bytes.

Selected settings, from `checkpoints/r4_ft_full135_v2/training.json`:

- Base revision above; seed 1717; full 134,515,008 parameter training, float32 MPS,
  SDPA, float16 safetensors export with tied embeddings stored once.
- AdamW, peak LR 2e-5, betas (0.9, 0.999), epsilon 1e-8, weight decay 0.01,
  gradient clipping 1; batch 8, accumulate 2; 800 maximum steps.
- 25% AAC / 75% DailyDialog examples; target blocks <=48 tokens within 128-token
  input context. Same `Partner:`/`Me:` prompt as inference; loss only on reply
  subwords, excluding role/history/padding/EOS labels.
- Warmup 40 steps, then cosine to 10% LR. Evaluate every 100 steps; patience 2;
  require loss improvement >=0.002. Best checkpoint was step 800.
- Train-only DailyDialog connected-component holdout: exact duplicates/shared
  normalized >=4-word turns stay together; SHA256 modulo 20 chooses holdout.
  First 256 target blocks by source-ID SHA form the probe. All 5,019 AAC lines
  remain training; no AAC worker split is asserted.
- Selected saved weight SHA256:
  `d2ff6483e502197a142255c4289f2f16987d3e9dbc3652f10f00258eb7b43a66`;
  269,060,456 bytes. Receipt source-config SHA256:
  `48b9b8459ec84b8737ef37a2e4e163b8bde306ec2f255b182e072fbd2e9d579e`.

Copy the completed checkpoint's model, receipt and training metadata. The runtime
requires nonzero training steps and verifies model bytes against the receipt
both at construction and before lazy loading. The historical baseline hash above
identifies the frozen source; the runtime trusts the supplied completed receipt
so a deliberate independent rebuild can be used.

After rebuilding, run this port's `setup_models.py --source "$W"` again, then
update `COUNTS_SHA256` in `wordpred/paths.py` and `models/SHA256SUMS`. The
loader uses CPU float32, two compute threads/one interop thread, last six dialogue
turns, 128-token prefix, eight multi-token roots, sixteen continuations, both case
variants, b=1 boundary approximation and float16 log-mass quantization, unchanged
from the selected recipe. A missing checkpoint causes a clear error for direct
`Predictor(model="deployable")`; the HTTP servers print a notice and try Light.
