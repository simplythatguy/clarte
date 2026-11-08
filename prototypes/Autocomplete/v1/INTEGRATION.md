# Word-prediction integration handoff

Autocomplete v1 provides a suggestion contract and caller-owned conversation
context. It does not change model weights or establish improved prediction
accuracy. All files for this experiment live in `prototypes/Autocomplete/v1`.
Existing autocomplete, word-prediction, and UI prototypes remain unchanged.

## Test without model artifacts

From the repository root, with Python 3.11+ and NumPy available, and Node 24:

```sh
python -m unittest discover -s prototypes/Autocomplete/v1 -p test_contract.py -v
python -m unittest discover -s prototypes/Autocomplete/v1/engine -p test_context_intake.py -v
node --test prototypes/Autocomplete/v1/test_client.mjs prototypes/Autocomplete/v1/test_page.mjs
python prototypes/Autocomplete/v1/verify_snapshot.py
```

These 32 tests use controlled predictors and loopback HTTP. They do not download
models or call external inference services. The page test exercises its script
with a minimal DOM substitute, not a real browser or gaze tracker.

## Connect your predictor

From this folder, `complete_with(predictor, history, message, groups)` accepts an
existing predictor instance. The adapter requires two methods:

```python
predictor.context(history, message)
predictor.matching_probabilities(context, groups)
```

`context` receives ordered, explicitly labelled history and a separate draft.
`matching_probabilities` returns descending `(word, probability)` pairs whose
group codes start with `groups`. Empty groups mean next-word prediction.
Probabilities must be finite and normalized over the entire matching vocabulary,
not a shortlist. An empty result means no match. The adapter returns the first
word and up to three alternatives without reordering or renormalizing them.

```python
from autocomplete import complete_with
from wordpred import Conversation, Predictor

conversation = Conversation()
conversation.add('partner', 'Would you like to go outside?')
draft = ['i', 'want']
predictor = Predictor(model='light')  # requires local model artifacts
predictor.start_conversation('integration-check')
try:
	result = complete_with(predictor, conversation.history, draft, '3')
	print(result)
finally:
	predictor.close()
```

Use the copied engine as the integration reference, or pass your predictor
through the same two-method adapter. The bundled engine uses the Python package
name `wordpred`; it is a snapshot, not a separately namespaced installed package.
Keep experiments in a separate Python process or environment to avoid importing
two different `wordpred` packages into one interpreter.

For HTTP integration, `server.py` loads the bundled engine. Its `serve` call
shows how to wire `complete_with` to an injected predictor with correlation
enabled. The [contract reference](CONTRACT.md) specifies the complete request,
response, and client behavior. No v0 service needs changing.

The local test server runs with:

```sh
cd prototypes/Autocomplete/v1
python server.py --light --port 8766
```

This requires existing model artifacts and the native engine build. The copied
[model recipe](engine/MODEL_RECIPE.md) and [engine README](engine/README.md)
describe setup. No artifacts or compiled libraries are committed. The native
build script supports macOS and Linux; Windows real-model setup remains a gap.
Use separate ports if running both prototype versions.

## Check the integration with real inference

1. Compare the engine's ordered matching probabilities with `complete_with` for
   the same labelled history, draft, and groups. Confirm the winner and masses agree.
2. Exercise empty groups and progressively longer group prefixes, including a
   prefix with no vocabulary match.
3. Edit, replace, remove, and clear history turns. Confirm the next request uses
   the new history and retains the draft separately.
4. Delay a response, change history or groups, and confirm it cannot become
   acceptable. Repeat with an engine error and a retry.
5. Accept a current suggestion once. Confirm only the draft changes, groups
   clear, and nothing speaks or creates a committed history turn automatically.
6. Keep predictor instances serial or use one per worker. Check that resetting
   a conversation also resets any model-specific causal or personalization state.

The HTTP service is stateless about caller history, draft, and acceptance. Request
IDs identify attempts; they do not establish server-managed conversations.
`Conversation` keeps independent in-memory history snapshots. It does not provide
model-session routing, persistence, or multi-user model-state isolation.

## Limitations and next accuracy work

- The tests establish contract behavior, not prediction accuracy, communication
  speed, gaze usability, or clinical benefit. Real-model integration still needs
  testing on the coworker's supported machine and model artifacts.
- The copied model and ranking policy are unchanged. There is no new training,
  tuning, or measured accuracy gain in this version.
- Vocabulary is fixed. Personal names, unseen words, and a personal lexicon with
  an exact-spelling fallback remain future work.
- Structured history is preserved at intake, but the neural scorer still uses
  its existing last-six-turn and 128-token context limits. Long histories need
  real-model evaluation before changing those limits.
- The neural/ngram mixture uses fixed weights based on whether partner context
  exists. Compare component baselines and tune on development data before adopting
  a different mixture or model.
- Group input is strict. This version does not correct gaze classification or
  infer a word from a mistyped group sequence. Input-error handling needs separate
  evaluation and must preserve explicit acceptance.
- Probability is conditional model mass, not calibrated confidence about intent.
  Calibration needs held-out data; a high probability never authorizes acceptance.
- The first accuracy deliverable is a reproducible real-model benchmark: top-one
  accuracy, top-four recall, vocabulary coverage, and selections per word by group
  prefix length. Separate speakers and conversations across splits, tune only on
  development data, and retain a final untouched test set.
- Follow-up experiments should separate vocabulary failures, ranking failures,
  context failures, and input errors. Local personalization must learn from
  explicit accepted or committed text and support editing and clearing.
- Historical model recipes depend on external research artifacts and retain
  their source data licences, including noncommercial restrictions. The copied
  provenance and model notices remain in `engine/`; this PR does not change them.

The bundled engine is deliberately isolated for testing. A future shared engine
package should replace the snapshot only after both teams agree on its API and
versioning. Inference remains local throughout this work.
