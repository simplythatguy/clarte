# r4_ft_full135_v2

Base: HuggingFaceTB/SmolLM2-135M at `93efa2f097d58c2a74874c7e644dbc9b0cee75a2`.
Adaptation: full, seed 1717, selected step 800.
Supervised target tokens seen: 134630.
Weight bytes: 269060456; SHA256: `d2ff6483e502197a142255c4289f2f16987d3e9dbc3652f10f00258eb7b43a66`.

CC BY-NC-SA 4.0 adaptation; Apache-2.0 base notices retained.
See [source attributions and use terms](../../LICENCES.md).
Changes: normalized user replies and role-labelled masked partner context;
all weight optimization uses authorized TRAIN data only. No dev/test gradients.
The checkpoint is a merged full model in fp16; the scorer loads float32 on CPU.
The current inference prompt and all word-scoring approximations are inherited.

`recipe.json`, `train-manifest.json`, `curve.jsonl`, and `training.json` record
hyperparameters, data assignments, loss curves, tokens and memory. `source/`
archives the exact core source fingerprints recorded before this training run.
Public pretraining contamination and the AAC worker-ID gap remain disclosed.
No clinical, device, human-performance or production acceptance is claimed.
