# Prediction v1 contract

The engine behind the conversation UI (`prototypes/UI/v0/s6`). It always returns a word: the next word when nothing is typed, and the current word's completion while letter groups are typed. Local only, no network calls at inference.

Server: `python server.py` in this folder, `http://127.0.0.1:8765`. It reuses `../v0` (its `wordpred` package, `models/`, `build/` and `.venv`). The model is loaded and warmed before the port opens, so the first request is as fast as the rest.

## `POST /api/v1/predict`

```json
{ "id": 17,
  "history": [["partner", "Where would you like to go for dinner?"], ["user", "Somewhere quiet"]],
  "message": ["i", "want", "to"],
  "groups": "34",
  "limit": 8, "offset": 0 }
```

- `id`: any integer, echoed back. The client drops a response whose `id` is not its latest request.
- `history`: earlier turns, oldest first, `"partner"` or `"user"`. The live partner transcript, while listening, is sent as the last partner turn.
- `message`: the words already accepted in the message being composed.
- `groups`: the typed group digits for the current word, `1` A–F, `2` G–N, `3` O–S, `4` T–Z. Empty means next-word prediction.
- `limit` (1–64, default 8) and `offset` (default 0) page through every matching word, so any word in the dictionary can be reached.

```json
{ "id": 17, "groups": "34",
  "words": [ { "word": "out", "p": 0.41, "complete": false }, { "word": "so", "p": 0.12, "complete": true } ],
  "total": 1873, "longer": 0.52, "ms": 9.4 }
```

- `words`: best first. `p` is the probability renormalised over all matching words. `complete` is true when the word's group code has exactly the typed length.
- `total`: how many dictionary words match `groups`.
- `longer`: summed `p` of matching words whose code is longer than `groups`.
- Every word matches `groups` exactly by prefix. No duplicates. Words are lower case; the UI capitalises `i` and sentence starts for display.
- Errors: `400 {"error": ...}` for a bad request, `500` for an engine failure. Never an empty list when `total > 0`.

## `POST /api/v1/commit`

`{ "word": "priya", "history": [...], "message": [...] }` → `{ "ok": true }`. Sent when the person accepts a word. The engine may learn from it (personal words, recency). It never changes a response already sent.

## `GET /api/v1/health`

`{ "ok": true, "model": "...", "vocabulary": 123456 }`.

## Compatibility

`POST /api/predict` keeps the v0 response shape for `s0`.

## v1 additions (compatible)

Added by the v1 engine; every field above keeps its meaning.

- `id` may be an integer or a string; it is echoed unchanged. A missing `id` echoes `null`.
- `history` and `message` may be `null` (treated as empty). The server keeps the last 200 turns and
  200 message items and reads at most 256 KiB per request. Longer `groups` than 128 digits are a `400`.
- `limit` must be an integer 1–64 and `offset` a non-negative integer. An `offset` past the end
  returns the last matching word, so `words` is never empty while `total > 0`.
- Words come from a 121,690-word lexicon (`data/lexicon.tsv.gz`) plus words the conversation
  introduced: a word the partner or user said, or a word sent to `commit`, is offered even when it
  is not in the lexicon. `total` counts those too.
- `total == 0` (nothing in the lexicon or the conversation matches `groups`): `words` may contain
  gaze-slip corrections, each marked `"corrected": true`. Their codes differ from `groups` in exactly
  one digit; they are ranked by probability and `p` is renormalised over the corrections shown.
  The UI may show them or ignore them.
  Without the flag, every word matches `groups` by prefix exactly.
- `POST /api/v1/commit` also accepts `history` and `message` (ignored except for validation) and
  returns `{ "ok": true, "ms": ... }`. The accepted word is learned for the server's lifetime.
- `GET /api/v1/health` adds `"rescorer"`: the name of the transformer that rescored candidates
  (`smol135-ft`, `qwen2.5-0.5b` or `none`).
- `POST /api/predict` returns `likely`, `choose`, `short`, `ghost`, `candidates` and `ms` as v0 did;
  `likely[0]` is the same word as `/api/v1/predict`'s first word.
- Requests are processed one at a time inside the server (one lock around the engine); concurrent
  clients queue. The server binds its port only after every model is loaded and warmed.

## Round 2 additions (compatible)

- Request `"complete": true` returns only words whose group code has exactly the typed length (the person has finished typing the word). `total`, `offset` and `limit` then count and page those words only. Used by the UI's "Other words" chooser so any dictionary word is a few pages away at most.
- Response `"branch": true | false`. True means the UI should offer `words[1]` as a second choice in Q4 instead of Delete, because the two words are close enough that showing both saves selections. The engine decides with a rule tuned on the benchmark's dev splits under the UI policy, and only when `groups` is non-empty. The UI follows it; its local fallback keeps its own rule.
- Clarifications from the round-2 engine: with `"complete": true`, `p` is renormalised over the complete
  words, `longer` still sums the whole match set's longer words, `branch` is the same value the
  unfiltered request would return, and a code that matches nothing returns `total: 0` with an empty
  `words` (no slip corrections on the chooser page). `branch` is always `false` when `groups` is empty.

## Round 3 additions (compatible)

- **Tiers.** "Best first" now means: tier-1 words (words the New Oxford American Dictionary or the DailyDialog
  conversations attest, `build_lexicon.py`) before tier-2 words (abbreviations nobody says, typing artefacts,
  rare names, foreign words) before tier-3 words (single letters other than `a` and `i`), each tier ordered by
  the model's probability; `p` is scaled so it stays non-increasing down the list. A tier-2 or tier-3 word the
  conversation mentioned (a partner or user turn, the message, or a `commit`) ranks as tier 1 for that request.
  Paging still reaches every word.
- **Lexicon.** 120,953 words (`data/lexicon.tsv.gz`, four columns: word, wordfreq probability, sources, tier).
  Bare forms of contractions (`dont`, `im`, `ive`, `thats`, `hows`) and misspelled contractions (`arn't`) are
  gone; `cant`, `wont`, `ill`, `well`, `lets` and the other bare forms that are words of their own stay.
- **`display`.** Each word may carry `"display"`: how the UI should show and speak it when that differs from
  `word`: `"I"`, `"I'm"`, names as the conversation wrote them (`"Priya"`), a committed word as it was sent,
  first names that are not common words (`"Nkechi"`). Absent means show `word` as is (the UI still capitalises
  sentence starts).
- **Corrections while typing.** With `groups` non-empty, `offset` 0 and `total > 0`, the first page may contain
  words marked `"corrected": true` whose code differs from `groups` in one digit (a probable gaze slip: the best
  exact match is improbable and a word one digit away is far more likely). They are ranked with the exact words
  by probability and `p` is renormalised over the page. They are extra: the page keeps all `limit` exact words, so it
  may hold up to `limit + 3` words, and `offset` paging is unchanged. `branch` is `false` on such a page. Complete-only pages
  (`complete: true`) never carry corrections. The UI should show a corrected word where it would show the word
  (Q1 when it is first) and may mark it; a UI that filters `corrected` words out, as `s6` does today, loses
  nothing but the suggestion.
- **`branch`.** True only when `words[0]` and `words[1]` are both complete for the typed code, `p[1] / p[0] >= 0.3`
  and `p[0] >= 0.2`; otherwise Q4 keeps Delete. Chosen on the round-2 dev records (RESULTS.md round 3).
- **Next word.** With empty `groups`, the last word of `message` is never `words[0]`, and words among the last
  three message words are discounted unless the language model itself expects the repeat.
- **`commit`.** Learns only words the lexicon does not know (new names and words that look like words), for the
  server's lifetime with a weight that fades with later commits. Lexicon words, junk tokens and profanity are
  accepted and ignored.
- **Server.** The listen backlog is 64 (was 5), so 20 concurrent clients no longer see connection resets.

## Round 4 additions (compatible)

- **Lexicon.** 866,363 words: round 3's 120,953 plus 745,410 English Wiktionary words (`add_wiktionary.py`,
  sources `k`, CC BY-SA 4.0). They are tier 2, so every common word of a code still comes first; `total`
  counts them, and `complete: true` chooser pages are longer for short codes. `GET /api/v1/health`
  reports the new `vocabulary`.
- **`rare`.** A word may carry `"rare": true`: it is tier 2 or 3 (an abbreviation, a rare name or token, a
  Wiktionary word, a single letter) and the conversation has not mentioned it. Absent means a common word or
  one the conversation introduced.
