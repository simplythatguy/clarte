# Autocomplete v1

One completion: the matching word with the highest context probability, with its
conditional probability and up to three alternatives. No groups means next-word
prediction. A suggestion is committed only by Accept.

[The integration contract](CONTRACT.md) defines request identity, pending work,
stale responses, errors, and explicit acceptance for any UI. `client.mjs` implements
that behavior without DOM or layout dependencies. All inference stays local.

[The word-prediction handoff](INTEGRATION.md) covers predictor integration,
real-model checks, known limitations, and the next accuracy experiments.

## Dependency and run

`autocomplete.py` adds the copied local `engine` directory to
`sys.path`, resolved from its own file location. Keep this folder and its engine together.
The runtime imports the ported `wordpred` package, never the research workspace.
See [the engine README](engine/README.md) for model setup,
licences, benchmark results, and vocabulary limits. Models are shared in the user
cache; there is no second model copy here.

```sh
cd 'prototypes/Autocomplete/v1/engine'   # from the repo root
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python build.py
.venv/bin/python setup_models.py
cd '..'
'engine/.venv/bin/python' server.py --port 8766
```

Open `http://127.0.0.1:8766/`. The page is plain HTML with only layout CSS:
Partner said, editable draft Message, group buttons, one completion and its
probability, Accept and Delete. `--model light` (or `--light`) chooses the count
model; the default server prints a notice and falls back to Light when Deployable
artifacts are absent. `--host` overrides the loopback default.
`WORDPRED_MODELS` selects the same external model directory as the engine.

## Python API

```python
from autocomplete import complete

result = complete(
    history=[["partner", "Do you want to go outside for a bit? It is sunny."]],
    message=["i", "would", "love", "to", "go"],
    groups="3443",
)
print(result["word"], result["probability"])
```

`complete(history, message, groups)` lazily keeps one serial predictor. It uses
Deployable by default; set `WORDPRED_MODEL=light` before the first call to select
Light. Direct Python construction requires the selected artifacts; the automatic
fallback notice belongs to the servers. Use one instance per worker or serialize
calls, as in the engine.

```json
{"status":"suggestion","word":"outside","probability":0.9999327172460807,"probability_kind":"conditional_model_mass","alternatives":[{"word":"stupid","probability":0.00002284689039406619},{"word":"puts","probability":0.000007383077977486796},{"word":"outstanding","probability":0.000006917588835096911}]}
```

The example uses probabilities measured in v0, with the v1 metadata added.
The probability is defined as:

`probability(w) = P(w | history, message) / sum(P(v | history, message) for all v whose group code starts with groups)`.

The denominator covers **all** matching words, not the top 12 or four displayed
items. Alternatives are the next three `{word, probability}` entries, excluding
the winner. Empty groups include the full vocabulary. No matching words returns
`{"status":"no_match","word":"","probability":0.0,"probability_kind":"conditional_model_mass","alternatives":[]}`. This probability is model mass,
not calibrated confidence about what a person intends. It uses `likely`, not the
optimal-composer `ghost` policy.

## HTTP API

The shared HTTP boundary also accepts `context_text` in place of `history` for
one typed or pasted partner message. For multiple turns, send the role-labelled
`history` array. See the Word Prediction README for the input contract.

`POST /api/complete`, JSON; open CORS with GET/POST/OPTIONS. `GET /` serves the
plain test page. `GET /client.mjs` serves the reusable client. Input fields match
Word Prediction, with an additional required `request_id`:

```sh
curl -sS http://127.0.0.1:8766/api/complete \
  -H 'Content-Type: application/json' \
  -d '{"request_id":"example:1","history":[["partner","Did you sleep at all?"],["user","Not much. My back hurts"],["partner","Do you want to go outside for a bit? It is sunny."]],"message":["i","would","love","to","go"],"groups":"3443"}'
```

Returns the completion object above plus `request_id` and the validated
`input` snapshot. Request defaults and input validation are shared with Word
Prediction: empty history/message/groups are accepted, malformed JSON/types/groups
return 400, body limit is 64 KiB and group limit 128; unknown routes return 404.

This version snapshots the v0 prototypes without changing them. `engine/` contains
the prediction engine, context intake interface and tests. See
[engine context documentation](engine/README.md#caller-owned-conversation-context).
`COPY_PROVENANCE.json` records source paths, base commit, snapshot hashes and
deliberate adaptations. Model artifacts remain in the existing external cache.

Run model-free checks from this folder:

```sh
python -m unittest discover -s . -p test_contract.py -v
python -m unittest discover -s engine -p test_context_intake.py -v
node --test test_client.mjs test_page.mjs
python verify_snapshot.py
```
