# Autocomplete integration contract

This contract belongs to Autocomplete v1 and its bundled engine. The v0 services
remain unchanged. Inference uses local model artifacts. The service makes no
external API calls and listens on `127.0.0.1` by default.

## Request

`POST /api/complete` accepts a JSON object:

```json
{
  "request_id": "composer-session:7",
  "history": [["partner", "Do you want to go outside?"]],
  "message": ["i", "want"],
  "groups": "3"
}
```

- `request_id` is a required nonblank string of at most 128 characters, echoed
  verbatim. Callers allocate a new ID for every attempt, including retries and
  edits back to a previously used input. IDs identify attempts, not conversations.
- `history` defaults to `[]`. It contains ordered `[role, text]` arrays with
  explicit `partner` or `user` roles. Text is preserved, including empty turns.
- `context_text` replaces `history` for one partner turn. Leading and trailing
  whitespace is trimmed. Blank text becomes empty history. Supplying both fields
  is invalid. Speaker labels are never inferred from prose.
- `message` defaults to `[]` and contains strings in the current draft. Accepting
  a word extends this draft. It does not create a committed conversation turn.
- `groups` defaults to `""` and contains at most 128 digits from `1` to `4`.
  Empty groups request a next word over the full vocabulary. Invalid characters
  cause rejection rather than silent filtering.

The body limit is 64 KiB. Every request supplies its full context. The service
does not retain a caller's draft, history edits, request order, or acceptance state.
The local predictor runs serially. Aborting a fetch does not guarantee that
inference already running on the server stops.

## Response

Successful inference returns HTTP 200 and one of two statuses. A suggestion has
this shape. The word and probability here are illustrative:

```json
{
  "request_id": "composer-session:7",
  "input": {
    "history": [["partner", "Do you want to go outside?"]],
    "message": ["i", "want"],
    "groups": "3"
  },
  "status": "suggestion",
  "word": "outside",
  "probability": 0.6,
  "probability_kind": "conditional_model_mass",
  "alternatives": []
}
```

`input` contains the validated `history`, `message`, and `groups` actually supplied
to the predictor. Defaults and `context_text` are expanded. `word` is the highest
ranked matching word. `alternatives` contains the next zero to three
`{word, probability}` entries, excluding the winner.

`probability` is model mass normalized over **all** words whose group codes start
with `groups`. It is not normalized over the displayed suggestions. It is not
calibrated confidence about the person's intended word. A sole match can have
probability 1 without establishing intent. There is no `confidence` field or
probability threshold that authorizes acceptance.

When the engine returns no positive matching mass, the response has
`status: "no_match"`, `word: ""`, `probability: 0.0`, and `alternatives: []`.
It still includes `request_id`, `input`, and `probability_kind`. No match is a
successful empty result, including when groups are empty.

## Errors

Invalid JSON or inputs return HTTP 400 with `status: "error"` and an `error`
string. A valid parsed `request_id` is echoed even when another field is invalid.
There is no `input` snapshot for rejected requests. An absent or invalid ID, or
an unreadable body, cannot be correlated by the service.

Engine exceptions and non-JSON model results return HTTP 500 with
`status: "error"`, a generic `error` string, the valid `request_id`, and the
validated `input`. Engine details stay in the local server log. Error responses
carry no suggestion. Failure does not commit or clear the caller's draft.
Unknown routes return HTTP 404. Network errors, malformed responses, and timeouts
are caller-side errors because no trustworthy service response is available.

## Reusable client

`client.mjs` exports `createAutocomplete({fetch, onChange, timeoutMs})`. The
defaults are the browser's `fetch`, a no-op callback, and 15 seconds. The client
uses a UUID per instance plus an increasing revision for request IDs. Modern
browsers on localhost and Node 24 support the required Web Crypto API.

```js
import {createAutocomplete} from './client.mjs';

const autocomplete = createAutocomplete({onChange: render});
await autocomplete.update({history: [], message: ['i'], groups: '3'});
// Capture this ID when a user begins activation, including a gaze dwell.
const displayedId = autocomplete.state.requestId;
// Only the user's explicit activation invokes acceptance.
const accepted = autocomplete.accept(displayedId);
if (accepted) {
	setDraft(accepted.message);
	setGroups(accepted.groups);
	await autocomplete.update(accepted);
}
```

The client accepts canonical `history`, `message`, and `groups`, with the defaults
above. `context_text` is an HTTP convenience. Its equivalent client input is
`history: text.trim() ? [['partner', text.trim()]] : []`.

The client exposes an immutable `state` and invokes `onChange(state)` after each
state change. States have `status`, `input`, `requestId`, `result`, and `error`.
`result` exists only in `ready`; `error` exists only in `error`. Other values are
`null` when unavailable. The state never edits the DOM.

- `idle` is the initial, cancelled, or accepted state.
- `pending` starts synchronously on `update(input)`. The previous suggestion is
  cleared immediately, and acceptance is unavailable. The input is detached from
  caller-owned arrays. Changing history, draft, or groups requires `update`
  immediately, before any debounce or asynchronous work in a UI.
- `ready` contains a validated suggestion for the current ID and exact input.
- `no_match` exposes no acceptable word. A caller can offer group deletion or
  context editing. Empty groups need a next-word empty state rather than an
  instruction to delete a nonexistent group.
- `error` exposes no acceptable word. Retrying is another `update` with a new ID.
  The draft and context remain available in `input`.

Each update invalidates the previous attempt and aborts its fetch. Revision
checks discard every old success or failure, even if transport ignores abort or
the input changes from A to B and back to A. The response ID and input must also
match. A timeout settles pending work even when the transport ignores abort.
`cancel()` clears the suggestion and invalidates pending work without changing
the draft. Aborted transport work cannot restore an old suggestion.

`accept(requestId)` returns `null` unless the current state is `ready` for that
exact ID. Successful acceptance returns a detached, immutable input with the
suggested word appended to `message` and `groups` cleared. It consumes the
suggestion once and changes state to `idle`. It does not request another word,
edit history, call the predictor's `commit`, or speak. The caller applies the
returned draft and decides when to request again.

Changing focus, observing a word, reaching a high probability, and completing a
request never accept a word. A UI retains the displayed request ID when activation
begins and passes that ID on completion. Reading a newer ID at the end of an old
dwell would allow that dwell to accept a different suggestion.

`update` resolves to the client's state at settlement. A superseded call can
resolve to a newer state. Callers render through `onChange` or read `state`;
they do not treat an awaited return value as the response to an older request.
Callbacks are synchronous and must not throw.

## Python boundary and compatibility

`complete_with(predictor, history, message, groups)` uses the same input validation
as HTTP and returns the suggestion or no-match fields. It neither accepts words
nor mutates input lists. Validation raises `ValueError`; engine errors propagate
to the caller. Controlled predictors need only `context(history, message)` and
`matching_probabilities(context, groups)`. No model files are needed for tests.

`complete(history, message, groups)` lazily loads one local model and uses the
same completion function. It is synchronous and requires serial calls. Python
callers that schedule it asynchronously retain their own request ID and input
snapshot around the call and apply the same stale-response rules.

The copied HTTP helper enables correlation only with `serve(..., correlate=True)`.
Autocomplete's server enables it and registers `/client.mjs` explicitly. The
copied prediction server retains its existing success request and response shape.
Compared with v0 autocomplete, HTTP clients must now send `request_id` and handle
the additional status, identity, input, and probability metadata fields.

## Verification

From the repository root:

```sh
python -m unittest discover -s prototypes/Autocomplete/v1 -p test_contract.py -v
python -m unittest discover -s prototypes/Autocomplete/v1/engine -p test_context_intake.py -v
node --test prototypes/Autocomplete/v1/test_client.mjs prototypes/Autocomplete/v1/test_page.mjs
```

Tests use controlled predictors and loopback HTTP. They cover context forwarding,
model mass, strict groups, empty groups, no matches, correlated engine failures,
validation, recovery, request races, changed inputs, cancellation, timeout,
response mismatch, immutable snapshots, and explicit single-use acceptance.
