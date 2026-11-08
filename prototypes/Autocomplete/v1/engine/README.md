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

Python 3.11+; the matching pinned research environment uses Python 3.14. A C++17
compiler and zlib headers/library are needed to build the native libraries on
macOS or Linux. Windows native builds are not supported by this script.

```sh
cd 'prototypes/Autocomplete/v1/engine'   # from the repo root
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python build.py
.venv/bin/python setup_models.py
.venv/bin/python server.py --port 8765
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

Large models are copied to `~/.cache/clarte-wordpred/v0`, outside this repository.
`WORDPRED_MODELS=/absolute/path` overrides that location for setup and both
runtimes. The folder `.gitignore` also excludes `models/`, `build/`, native
binaries and Python caches. No models or compiled libraries are distributed.

`setup_models.py --source /path/to/research/four-zone-prediction` copies counts,
ARPA, vocabulary, the completed fine-tuned checkpoint, and the pinned base
snapshot if present. Without them, it downloads the public ARPA and pinned base
model and explains which derived artifacts must be rebuilt. `--no-download`
limits setup to local copies. See [MODEL_RECIPE.md](MODEL_RECIPE.md) for the exact
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
and `candidates`, with the same ordering as research `ui/server.py`:

- `likely`: up to 12 matches in decreasing context probability, with stable ties.
- `choose`: the highest-probability guess, then exact keyed-length words, then
  longer completions, from the original top-200 probability shortlist; at most 12.
- `short`: up to 8 matches with keyed length from `max(typed,1)` through
  `max(typed,1)+2`.
- `ghost`: the optimal composer's first item, or `""` if there are no matches.
- `candidates`: the optimal composer's ranked words, up to 12.

`likely[0]` and `ghost` can differ. The composer minimizes modeled future
selections; its ghost is not necessarily the most probable completion. Earlier
ghosts remain accessible in the chooser (`exclude_accepted=false`).
`matching_probabilities(context, groups)` exposes decreasing `(word, probability)`
pairs normalized over **all** vocabulary words with that prefix, for the sibling
Autocomplete API. With no groups it returns next-word probabilities.
The optional noisy ring-slip adapter is not included in this port.

## HTTP API

For a single typed or pasted partner message, either endpoint also accepts
`context_text` as a string in place of `history`. Non-empty text becomes one
partner turn; empty or whitespace-only text becomes no history. Text is passed
to the existing predictor without guessing speaker labels. For multi-turn
conversation, send the ordered role-labelled `history` array instead. Supplying
both fields is an error. Context is request-local: clients manage their own
conversation history and resend it with each request. No accuracy improvement
has been measured for this intake convenience.

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
`setup_models.py` records copied model sources and SHA256 in the external cache's
`model-provenance.json`. No independent code licence is asserted for the research
code by this port.

| Artifact | Source / licence |
| --- | --- |
| wordfreq vocabulary/frequencies | [wordfreq](https://github.com/rspeer/wordfreq), data CC BY-SA 4.0 (its software is separately Apache-2.0) |
| AAC training corpus and ARPA LM | [Vertanen & Kristensson resources](https://data.imagineville.org/imagine/), CC BY 4.0; [4-gram](https://data.imagineville.org/imagine/lm_mix_top3_4gram_abs0.0.arpa.gz) |
| DailyDialog training text | [dataset card](https://huggingface.co/datasets/li2017dailydialog/daily_dialog/blob/main/README.md), CC BY-NC-SA 4.0 |
| Base SmolLM2-135M | [pinned model](https://huggingface.co/HuggingFaceTB/SmolLM2-135M/tree/93efa2f097d58c2a74874c7e644dbc9b0cee75a2), Apache-2.0 |
| Fine-tuned weights | Under the research rights policy, inherited DailyDialog CC BY-NC-SA 4.0 adaptation with Apache-2.0 base notices retained |

The count prior also includes DailyDialog-derived counts. Light does not remove
that noncommercial data restriction. This is a local research prototype.

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

## Caller-owned conversation context

`from wordpred import Conversation` provides UI-independent ordered history.
Create one instance per conversation; no history is shared between instances.
Typed and pasted text use the same explicit role and text arguments. Text is
preserved verbatim (including empty strings); speaker names inside prose are
never parsed. Only `partner` and `user` are valid roles.

```python
conversation = Conversation()
conversation.add("partner", "Would you like tea?")  # returns index 0
conversation.add("user", "Yes, please.")
conversation.replace(0, "partner", "Tea or coffee?")
conversation.remove(1)
body = {"history": conversation.history, "message": ["i", "want"], "groups": "4"}
# POST body to /api/predict or /api/complete
conversation.clear()
```

`replace(index, role, text)` replaces a whole turn; `remove(index)` deletes it
and shifts later indexes. Indexes are zero-based, nonnegative integers identifying
an existing turn. `replace_all(history)` replaces the entire history atomically;
`replace_all([])` and `clear()` explicitly clear it. Invalid roles, shapes or
text types raise `ValueError`; invalid indexes raise `IndexError`. Failed edits
leave existing history intact. Construction and the `history` property copy
turns so external mutation cannot change the stored conversation.

The current draft stays outside this object: `message` holds accepted words in
the current unsent utterance and `groups` holds the active word's group sequence.
Sending a prediction request never commits a turn. When the caller decides an
utterance is finished, it explicitly calls `add("user", finished_text)` and resets
its draft. Clearing history does not clear the caller's draft.

HTTP requests carry complete history snapshots, not incremental edits. Resend
all remaining turns after an edit; send `history: []` to clear context. Omitting
history also means empty context for that request, never reuse of a prior request.
There is no server conversation store or conversation-ID field. Retain separate
snapshots per conversation. The existing `context_text` shortcut is unchanged:
it trims surrounding whitespace and maps a nonblank string to one partner turn;
blank input maps to empty history. Use `history` to preserve raw text exactly.
Both fields together are rejected rather than choosing one and dropping context.
The shared HTTP request shape is unchanged for integration with agent 2.

Run the model-independent intake and HTTP adapter tests from the repository root:

```sh
python -m unittest discover -s "prototypes/Autocomplete/v1/engine" -p test_context_intake.py -v
```
