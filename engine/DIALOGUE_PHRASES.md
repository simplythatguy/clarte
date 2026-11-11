# Dialogue-conditioned personal phrases

Implements a local adaptation of Keith Vertanen's [ASSETS 2017 paper](https://doi.org/10.1145/3132525.3134814),
*Towards Improving Predictive AAC using Crowdsourced Dialogues and Partner Context*.

Two 250-unit GRU word language models learn individual personal-side utterances and two-sided
dialogues. Token probabilities are linearly interpolated; the interpolation weight and best
epochs are selected on development data. Whole saved phrases are ranked by their complete
utterance likelihood, including end-of-utterance. Scores normalize over supplied candidates;
they are not calibrated confidence. The vocabulary comes from training text only.

This is an adaptation, not an exact reproduction: full softmax/Adam replace the paper's NCE setup;
the standalone model uses user turns; the local experiment uses the author's small dialogue corpus
instead of the paper's large Twitter/movie corpora. No rare-keyword-specific Twitter model is
trained. The paper's perplexity and user-benefit claims do not describe this implementation.

## Data, training and evaluation

Run from `main/engine` with the existing Python environment (Windows: `.venv/Scripts/python.exe`).
The author download is `http://keithv.com/data/turk-dialogues.txt`; HTTPS www returned 403 during
this work. Obtain it separately into an ignored local directory. No runtime download occurs.
The downloaded bytes' SHA-256 was `7bd80a8a8fe1e3ee91158072b4adc198db691f96196b27acf28ea8335507dafb`.
Redistribution rights have not been established: data and derived weights stay local and ignored.

```sh
python train_dialogue.py prepare --input ../../.scratch/phrase-rnn/turk-dialogues.txt --output ../../.scratch/phrase-rnn
python train_dialogue.py train --train ../../.scratch/phrase-rnn/train.jsonl --valid ../../.scratch/phrase-rnn/dev.jsonl --output models/dialogue/phrases.pt --source http://keithv.com/data/turk-dialogues.txt --license "Redistribution unverified; local experiment only" --epochs 10
python train_dialogue.py evaluate --model models/dialogue/phrases.pt --test ../../.scratch/phrase-rnn/test.jsonl
```

The author labels retain 859 train, 280 dev and 280 test dialogues. Never select a model or weight
using test data. Training rejects exact train/dev dialogue overlap; independently check near
duplicates when using another corpus. For your own licensed data, each JSONL line has this shape:

```json
{"turns": [["partner", "Would you like tea?"], ["user", "Yes please."]]}
```

The checkpoint receipt records source/license declarations, input hashes, seed, selected weight,
development scores and checkpoint hash. License declarations are supplied metadata, not legal
verification. Evaluation reports user-turn token perplexity without partner turns and with partner
error probabilities 0, .1, .2, .4, .7 and 1. Corruption uses the paper's 80% substitution, 10%
insertion and 10% deletion mixture, sampling replacement vocabulary from the train-only lexicon.
EOS is scored and unknown-token counts are reported. This is not a real ASR or gaze-user study.

## Runtime

The engine automatically loads `models/dialogue/phrases.pt` if present and verifies its receipt hash.
Override with `--params '{"dialogue_model":"path/to/model.pt"}'`; an empty string disables loading.
Restart the engine after training. `POST /api/v1/phrases` accepts `id`, conversation `history`, and
1–64 literal `phrases`, and returns `id`, `available`, and ranked `{text, probability}` entries.
No model or a phrase longer than 128 tokens returns `available:false`.

The app sends its current conversation, including partner Listen text, to that local endpoint.
It first filters saved phrases against accepted words and pending groups, then submits up to 64
by the existing personal-regression ranking. Therefore lower-ranked phrases beyond that shortlist
cannot be recovered by the neural model. This ranks saved phrases; it does not generate new wording.
The response is held in a bounded context-keyed memory cache. New context cannot replace the
snapshot in an already-open Options chooser. Selection still only fills the draft; Speak remains
explicit. The endpoint does not persist partner speech or train on it.

Client fusion preserves matching observed personal successors ahead of the RNN's alternatives,
in personal-regression order. The generic model's response no longer replaces that evidence.
With no observed successor it supplies the existing contextual backoff. This local personalization
policy is Clarte's adaptation, not a result claimed by the cited paper. GRU weights are unchanged;
personal sequence learning remains in local SQLite, including combined apostrophe-spelling aliases.

On missing weights, older engine, errors, invalid responses or a four-second client deadline, the
existing personal regression remains available. Personal-learning POSTs still have the separate
delivery/normalization issues described in the prior review; this feature does not repair all of them.

## Verification

`npm test` and `npm run build` in `main/app`; `PREDICT_TESTS=fast python -m unittest discover -s tests
-p test_contract.py -v` and `python -m unittest discover -s tests -p test_dialogue_lm.py -v` in this
folder. Synthetic tests cover interpolation, partner ablation, checkpoint round-trip, noise,
HTTP validation, client partner-context requests, fallback and frozen Options. Training/evaluation
results are local experimental evidence, not communication accuracy or demonstrated speed gains.

## Local experiment · 2026-11-08

Trained both 250-unit GRUs for ten epochs with seed 0, selecting each best development epoch.
Development interpolation selected a dialogue weight of 0.75. Test was used only after selection.
Exact dialogue records were checked disjoint across all three splits; near duplicates were not audited.
Checkpoint SHA-256: `2840cc3f5ec617b94680eae5afbbdf2150b14b1eb4100b298263f7568e6a4cb5`.

| Test context | Token perplexity (lower is better) |
| --- | ---: |
| Without partner turns | 95.2279 |
| Partner turns, no corruption | 89.9108 |
| Partner error probability .1 | 90.0712 |
| Partner error probability .2 | 90.3722 |
| Partner error probability .4 | 90.6715 |
| Partner error probability .7 | 91.4785 |
| Partner error probability 1 | 92.1192 |

Each condition scores 9,049 user-side tokens including EOS, with 487 unknown lexical tokens.
These are corpus-language-model results, not saved-phrase ranking accuracy. Complete-utterance
likelihood can favor short phrases; no personal phrase accuracy or intended-user study was run.
An actual trained-model HTTP smoke test returned three supplied phrases in 23.7 ms on this
machine; this single measurement is not a latency benchmark. App tests/build, four GRU tests
and eight fast HTTP/validation tests passed (twelve unrelated live-model contract tests skipped).
Repository provenance validation still fails on missing/changed upstream skill copies; none were
edited here. The default Windows Python encoding also requires `python3 -X utf8 scripts/validate.py`.
The checkout initially lacked its native word-prediction DLLs. After `python build.py` succeeded,
a real `Engine(model='light', rescorer=None)` loaded the trained phrase model and passed both
phrase ranking and ordinary grouped-word prediction. Full lexicon startup was slow on this machine.
