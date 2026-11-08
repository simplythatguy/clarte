> Moved from `main/engine/v0/README.md` when the prediction prototypes were merged into one folder (`../README.md`). Paths below that say `main/engine/v0` now mean `main/engine`; its `server.py` is replaced by the merged `server.py`, which keeps `POST /api/predict`.

# Word Prediction v0

Local decoding of the tapped groups G1 ABCDEF, G2 GHIJKLMN, G3 OPQRS,
G4 TUVWXYZ, using earlier conversation turns and the already committed message.
This is a backend port with a plain HTML test page.

`wordpred.Predictor(model="deployable" | "light")` is the engine API. Light is
modified Kneser–Ney counts + the public ARPA 4-gram + causal history counts +
the top-64 optimal ghost composer. Deployable mixes that prior with the selected
fine-tuned SmolLM2-135M scorer, with neural share 0.875 when partner context exists
and 0.375 otherwise. Both run locally. There are no external inference calls,
SQLite score caches, Jev/POS rerankers, or experiment drivers. The numerical
position and transformer KV caches are retained to preserve the frozen outputs.

## Run

From the repository root, `./clarte predict` (Windows: `clarte predict`) does everything
below and opens the test page: it fetches the models when Git LFS is not installed,
creates `.venv`, builds the native libraries and starts the server. See the root README.

### Manual setup

Python 3.11+; the matching pinned research environment uses Python 3.14. `build.py`
compiles the native libraries with Zig's bundled clang (`ziglang` from
[`build-requirements.txt`](build-requirements.txt)) and the zlib sources vendored in
[`wordpred/native/zlib`](wordpred/native/zlib/), so no system compiler, SDK or zlib is
needed. Set `CXX` (and `CC` for zlib) to use another C++17 compiler instead; zlib is
still compiled in, so `-lz` is never needed.

The models are in [`models/`](models/), stored with [Git LFS](https://git-lfs.com)
(about 850 MB). Install Git LFS before cloning, or run `git lfs pull` afterwards;
without it the model files are small pointer files and the server reports them
as missing (`clarte` fetches them itself into `.tools/models` and points
`WORDPRED_MODELS` there).

```sh
cd 'main/engine/v0'   # from the repo root
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r build-requirements.txt
.venv/bin/python build.py
.venv/bin/python server.py --port 8765
```

Intel Macs: torch 2.9.1 has no macOS x86_64 wheel, so install
[`requirements-light.txt`](requirements-light.txt) instead and run `--model light`;
`clarte` does this automatically there.

### Windows

Use 64-bit Python 3.14 from python.org; the default Zig build needs nothing else.
MinGW-w64 g++ still works through `CXX` (and `CC`), for example MSYS2's UCRT64
`mingw-w64-ucrt-x86_64-gcc` with `C:\msys64\ucrt64\bin` on `PATH`; `build.py` then
links the C++ runtime statically, so the DLLs load without MinGW on `PATH`.
MSVC is not supported. In PowerShell:

```powershell
cd 'prototypes\Word Prediction\v0'
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r build-requirements.txt
.venv\Scripts\python build.py
.venv\Scripts\python server.py --port 8765
```

Open `http://127.0.0.1:8765/`. The test page has Partner said, an editable
committed Message, four group buttons, Accept, Delete, and Choose. Accept uses
`likely[0]`; Choose lets you explicitly accept any of the returned chooser words.
It does not speak, record gaze, or copy the research UI.

`--model light` (or `--light`) runs without a neural model; only `numpy==2.3.5`
is needed for that runtime, plus counts, ARPA and the native build. For example,
install only that NumPy pin into a separate environment instead of the full
requirements. The default server prints a notice and falls back to Light if
Deployable artifacts are absent. Missing Light artifacts still fail clearly.
Corrupt checkpoint receipts/hashes are errors, not a silent fallback.

`WORDPRED_MODELS=/absolute/path` points both runtimes at another model folder.
[`models/SHA256SUMS`](models/SHA256SUMS) lists every model file's hash. The runtime
refuses a count model whose SHA256 differs from the pinned value, because loading
a pickle runs code, and it checks the checkpoint against its receipt. Compiled
libraries are not distributed; `build.py` makes them.

After a retrain, `setup_models.py --source /path/to/research/four-zone-prediction`
refreshes `models/` from the research workspace; update `COUNTS_SHA256` in
`wordpred/paths.py` and `models/SHA256SUMS` with it. See [MODEL_RECIPE.md](MODEL_RECIPE.md) for the exact
upstream training commands, required data, fingerprints and checkpoint receipt.
The runtime never imports from the research workspace.

## Python API

```python
from wordpred import Context, Predictor

predictor = Predictor(model="deployable")
predictor.start_conversation("example")
context = Context("example", (("partner", "Where would you like to go?"),), ("i", "want"))
words = predictor.rank(context, "34")  # frozen benchmark ordering, at most 12
predictor.commit(context, "out")     # confirmed word; supply updated context next
view = predictor.predict(list(context.history), list(context.message), "34")
predictor.close()
```

`Context` is immutable. `rank(context, groups)` follows the original benchmark
contract: no target word or future text is supplied; apostrophes use no group.
`start_conversation` resets causal state, and `commit` invalidates the current
position. A predictor instance is serial; use one per worker, or serialize
calls. The stdlib server processes requests serially.

`predict(history, message, groups)` returns `likely`, `choose`, `short`, `ghost`,
and `candidates`, using the two-choice product contract:

- `likely`: up to two matches in decreasing context probability, with stable ties.
- `choose`: the same two best matches as `likely`, in the same order.
- `short`: the subset of the two best matches with keyed length from `max(typed,1)` through
  `max(typed,1)+2`.
- `ghost`: the first probability-ranked match, or `""` if there are no matches.
- `candidates`: the same two best matches as `likely`.

The HTTP-facing view uses probability ranking consistently and does not run the
native optimal composer. The research `rank(context, groups)` API is unchanged:
it minimizes modeled future selections and can differ from `likely[0]`.
`matching_probabilities(context, groups)` exposes decreasing `(word, probability)`
pairs normalized over **all** vocabulary words with that prefix, for the sibling
Autocomplete API. With no groups it returns next-word probabilities.
The optional noisy ring-slip adapter is not included in this port.
See [bench/README.md](bench/README.md) for the new two-choice evaluation protocol.
The synthetic benchmark can explicitly call Claude; the application runtime
continues to run locally and does not read API keys or send conversations remotely.

## HTTP API

`POST /api/predict`, JSON, with open CORS (GET/POST/OPTIONS). `GET /` serves the
test page. The server defaults to loopback; `--host` overrides it.

```sh
curl -sS http://127.0.0.1:8765/api/predict \
  -H 'Content-Type: application/json' \
  -d '{"history":[["partner","Did you sleep at all?"],["user","Not much. My back hurts"],["partner","Do you want to go outside for a bit? It is sunny."]],"message":["i","would","love","to","go"],"groups":"3443"}'
```

Request fields default to empty arrays/empty groups. `history` contains
`["partner"|"user", text]` pairs; `message` contains committed strings;
`groups` is a string of digits 1–4, with one digit per letter. Text is tokenized
with the original English word/apostrophe regex. The HTTP boundary rejects
malformed JSON/types/groups with status 400, requests over 64 KiB, and group
strings over 128 digits. Unknown paths return 404. The response adds measured
`ms` to the Python view; for the example, `likely[0]` is `"outside"`.

## Provenance, rights, and limits

Adapted from the research final `Local` (Deployable) and `Light` paths.
[PORT_PROVENANCE.json](PORT_PROVENANCE.json) records the upstream paths, SHA256
fingerprints, and deliberate adaptations. Both C++ files are exact copies.
[`wordpred/native/zlib`](wordpred/native/zlib/) holds the unmodified zlib 1.4 sources that
`arpa_native` needs for `gzopen` (zlib licence, `LICENSE` there and
[`licenses/zlib-Zlib.txt`](../../../licenses/zlib-Zlib.txt)); its `PROVENANCE.json` records
the tarball and file hashes.
The model files were copied byte for byte from the research workspace on
2026-11-07; `models/SHA256SUMS` matches the research receipts. Provenance ships
with them: `models/PROVENANCE.json` (source path and SHA256 of each file),
`models/receipts/training_aac63k.json` (count-model inputs and hashes), and the
checkpoint's `receipt.json`, `MODEL_CARD.md`, training records and `source/`. No independent code licence is asserted for the research
code by this port.

### Model credits and licences

The files in `models/` are third-party works or adaptations of them,
redistributed here under their licences. No changes were made to the files
marked unmodified.

| File in `models/` | Credit | Licence |
| --- | --- | --- |
| `lm_mix_top3_4gram_abs0.0.arpa.gz` (unmodified) | Keith Vertanen and Per Ola Kristensson, 4-gram AAC language model from [The Imagination of Crowds: Conversational AAC Language Modeling using Crowdsourcing and Large Data Sources](https://aclanthology.org/D11-1065/), EMNLP 2011. [Download page](https://data.imagineville.org/imagine/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `base/` (unmodified) | Hugging Face, [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M/tree/93efa2f097d58c2a74874c7e644dbc9b0cee75a2), revision `93efa2f`; Loubna Ben Allal et al., [SmolLM2: When Smol Goes Big](https://arxiv.org/abs/2502.02737), 2025 | [Apache-2.0](models/base/LICENSE) |
| `checkpoints/r4_ft_full135_v2/` | Clarte fine-tune of SmolLM2-135M (above) on the AAC corpus from the same paper as the ARPA model and [DailyDialog](https://huggingface.co/datasets/li2017dailydialog/daily_dialog) by Yanran Li, Hui Su, Xiaoyu Shen, Wenjie Li, Ziqiang Cao and Shuzi Niu ([DailyDialog: A Manually Labelled Multi-turn Dialogue Dataset](https://aclanthology.org/I17-1099/), IJCNLP 2017). Training recipe in [MODEL_RECIPE.md](MODEL_RECIPE.md) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), inherited from DailyDialog; SmolLM2's Apache-2.0 notice applies to the base weights |
| `counts_aac63k.pkl` | Clarte n-gram counts built from the AAC corpus, DailyDialog (both credited above) and [wordfreq](https://github.com/rspeer/wordfreq) word frequencies by Robyn Speer | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), inherited from DailyDialog; wordfreq data is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `vocabulary.json` | Clarte vocabulary: the wordfreq list (above) joined with the words of the AAC corpus and DailyDialog | Includes wordfreq data, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and words from the corpora above |

Because of DailyDialog, the checkpoint and count model may be used for
noncommercial purposes only, and adaptations must keep the same licence. Light
uses the count model, so it carries the same restriction. This is a local
research prototype.

The source `decision.tsv` final one-time test reports **Light 3.983** and
**Deployable 3.545 selections per word**, split-macro means over 14,628 words.
These are existing source benchmark results; this port only reruns full **dev**
for byte equivalence. They are modeled costs, not human communication speed,
gaze accuracy, calibrated confidence, fatigue, or clinical benefit. The model
assumes that correct ghosts are noticed. Public pretraining contamination and
the original AAC-dev ARPA tuning caveat remain.

Vocabulary is fixed at **66,501 words** in the selected union. There is no personal
name entry/fallback yet ([NAT-12](https://linear.app/nathacks/issue/NAT-12)); a name
that happens to exist in the fixed vocabulary is not a personal lexicon. Unknown
words and unseen names need a separate exact-spelling/personal-word feature.
