# Autocomplete v0

One completion: the matching word with the highest context probability, with its
conditional probability and up to three alternatives. No groups means next-word
prediction. A suggestion is committed only by Accept.

## Dependency and run

`autocomplete.py` adds the sibling `../../Word Prediction/v0` directory to
`sys.path`, resolved from its own file location. Keep both folders together.
The runtime imports the ported `wordpred` package, never the research workspace.
See [the engine README](../../Word%20Prediction/v0/README.md) for model setup,
licences, benchmark results, and vocabulary limits. Models are shared from the engine's
`models/` folder (Git LFS); there is no second model copy here.

```sh
cd 'prototypes/Word Prediction/v0'   # from the repo root
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python build.py
cd '../../Autocomplete/v0'
'../../Word Prediction/v0/.venv/bin/python' server.py --port 8766
```

On Windows, set up the engine as its README's Windows section describes, then run
`& '..\..\Word Prediction\v0\.venv\Scripts\python' server.py --port 8766` from this folder.

Open `http://127.0.0.1:8766/`. The page is plain HTML with only layout CSS:
Partner said, editable committed Message, group buttons, one completion and its
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
{"word":"outside","probability":0.9999327172460807,"alternatives":[{"word":"stupid","probability":0.00002284689039406619},{"word":"puts","probability":0.000007383077977486796},{"word":"outstanding","probability":0.000006917588835096911}]}
```

The example is the measured response to the full-history HTTP request below. The probability is defined as:

`probability(w) = P(w | history, message) / sum(P(v | history, message) for all v whose group code starts with groups)`.

The denominator covers **all** matching words, not the top 12 or four displayed
items. Alternatives are the next three `{word, probability}` entries, excluding
the winner. Empty groups include the full vocabulary. No matching words returns
`{"word":"","probability":0.0,"alternatives":[]}`. This probability is model mass,
not calibrated confidence about what a person intends. It uses `likely`, not the
optimal-composer `ghost` policy.

## HTTP API

`POST /api/complete`, JSON; open CORS with GET/POST/OPTIONS. `GET /` serves the
plain test page. Same request as Word Prediction:

```sh
curl -sS http://127.0.0.1:8766/api/complete \
  -H 'Content-Type: application/json' \
  -d '{"history":[["partner","Did you sleep at all?"],["user","Not much. My back hurts"],["partner","Do you want to go outside for a bit? It is sunny."]],"message":["i","would","love","to","go"],"groups":"3443"}'
```

Returns the completion object above, with the real probability and up to three
alternatives. Request defaults and HTTP validation are shared with Word
Prediction: empty history/message/groups are accepted, malformed JSON/types/groups
return 400, body limit is 64 KiB and group limit 128; unknown routes return 404.
