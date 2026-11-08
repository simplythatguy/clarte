# Word Prediction

Clarte's one prediction engine: the next word when nothing is typed, the current word while letter groups
are typed, from the whole conversation, with gaze-slip correction, word tiers and every dictionary word
reachable. Local only. Contract: [CONTRACT.md](CONTRACT.md). Measurements: [RESULTS.md](RESULTS.md).

This folder is the single, current version. It merges what were separate prototypes: Word Prediction v0
(the `wordpred` package, its count and neural models and native build, now beside `engine/`; its README is
[docs/ENGINE-V0.md](docs/ENGINE-V0.md) and its benchmark `bench/v0/`), Word Prediction v1 (`engine/`,
`server.py`), and Autocomplete v0/v1 (PR 15's request ids and PR 16's two-choice idea, both folded into
the contract and the UI). New work goes here; there are no further versioned copies.

## Set up and run

One environment in this folder (`.venv`), the native build (`build/`) and the trained models in `models/`
(Git LFS):

```sh
cd main/engine
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -r requirements-gpu.txt && .venv/bin/python -m pip install --no-deps mlx-lm==0.32.2   # Apple Silicon: the GPU rescorer
.venv/bin/python build.py                                # native ARPA and assignment libraries into build/
git lfs pull                                             # models/ (count model, 4-gram, SmolLM2-135M fine-tune)
.venv/bin/python fetch_models.py                         # Qwen2.5-1.5B (3.1 GB) into models/, gitignored
.venv/bin/python server.py                               # http://127.0.0.1:8765, loads + warms first
```

Coming from the versioned folders: move the local, untracked pieces once, `mv v0/.venv .venv; mv v0/build
build; mv v1/models/Qwen* v1/models/SmolLM2-* models/`, then delete the empty `v0/` and `v1/`.

Options: `--port`, `--host`, `--model light` (no v0 neural prior), `--rescorer auto|qwen2.5-1.5b|qwen3-1.7b|qwen2.5-0.5b|smol135-ft|none`
(default `auto`: the first of `engine/neural.py PREFERENCE` whose weights are present), `--threads 4`,
`--params '{"top_k": 24}'` (any key of `engine/predictor.py DEFAULTS`, including the branch rule and
`"adapter": "models/adapters/..."` for a LoRA adapter). The port opens only after every model is
loaded and warmed (cold start in RESULTS.md). `GET /` serves a small test page. `s0` keeps working
through `POST /api/predict`.

The rescorer runs on the GPU through Apple's MLX (`engine/mlx_rescorer.py`); `fetch_models.py NAME...`
downloads any of `engine/mlx_rescorer.CATALOG` (Qwen2.5 0.5B/1.5B/3B, Qwen3 0.6B/1.7B/4B base,
SmolLM2 360M/1.7B; Llama-3.2 is gated and not fetched). Without any of them the server falls back to
round 1's rescorer, v0's fine-tuned SmolLM2-135M on torch, and without that it still starts
(`--model light`, no rescorer). `train_lora.py` adapts an MLX model on the allowed training data
(see RESULTS.md for whether that paid).

## Tests, coverage, adversarial, benchmarks

```sh
.venv/bin/python -m unittest discover -s tests -v          # contract + tiers + live HTTP (PREDICT_TESTS=fast skips the live engine)
.venv/bin/python adversarial.py                             # 100 hostile-demo cases (30 conversational), pass/fail per case
.venv/bin/python coverage.py --exact --sample 2000 --templates 3   # every-word reachability (+ chooser rank, tier order); context test on a sample
.venv/bin/python bench/latency.py [--pace 1.0 --complete-every 2]  # cold start, p50/p95 through HTTP, back-to-back or paced
.venv/bin/python bench/harness.py run --system v1 --name NAME       # frozen dev splits, both policies (+ per-k top-2 probabilities)
.venv/bin/python bench/harness.py compare v0_deployable NAME --metric ui
.venv/bin/python bench/branch_sim.py NAME                           # replay the UI on a run's records: branch-rule trade-off curve
.venv/bin/python train_lora.py prepare                              # LoRA data from the allowed training text (training: see RESULTS.md)
```

## Results in one paragraph

Full numbers, commands and CIs: [RESULTS.md](RESULTS.md). Round 2 rescores candidates with
Qwen2.5-1.5B on the GPU (MLX) instead of the fine-tuned SmolLM2-135M on the CPU. On this UI's policy
(accept when the top word, or the top two while typing, is the target; otherwise type the code and
page), it needs **2.4463 selections per word on full dev vs 2.5190 for round 1 and 2.5709 for v0**
(-2.9%, paired-bootstrap 95% CI [-0.088, -0.057]; -4.8% vs v0, CI [-0.141, -0.107]; 8,685 words, 0
contract errors). The gain is all on conversations with partner turns (dd_dev -6.4%, next-word top-1
38.9% vs 34.6%); single messages without history are unchanged. On the one-time test run:
**2.4661 vs 2.5381 (round 1) and 2.5851 (v0)** (-2.8%, CI [-0.086, -0.060]; -4.6% vs v0; 14,628 words,
0 errors), dd_test -6.2%. Through HTTP on an idle M5 Pro: typed groups p50 18 / p95 27 ms, next word
p50 76 / p95 126 ms, nothing over 150 ms, cold start 25 s. Branch rule (second word in Q4 from two
groups when p1/p0 >= 0.2): 2.774 selections/word in the UI replay vs 2.969 with Q4 always Delete,
hiding Delete on 25% of typed states. Adversarial suite 94/100 (round 1: 88), conversational cases
next-word top-1 21/30 (round 1: 16/30). Coverage: RESULTS.md round 2.

## Design

```
request ──► v0 prior (MKN counts + ARPA 4-gram + fine-tuned SmolLM2-135M, 66,501 words)
        ──► spread onto the 866,363-word lexicon (wordfreq backoff for the 54k extra words; round 4 adds
            745k English Wiktionary words as tier 2, each with a tiny prior)
        ──► pointer cache: words from the conversation (recency, speaker, IDF damping),
            out-of-lexicon words (names) join the candidate pool; committed words learned per session
        ──► candidates matching the typed groups, best 24 by prior + every context word
        ──► exact transformer rescoring on the GPU (MLX, Qwen2.5-1.5B): log P(word tokens | prompt)
            + log P(boundary | word), log-linear mix with the prior, floor at the best unrescored word
        ──► word tiers: tier-2 words (abbreviations, slang, names, rare short tokens) and tier-3 words
            (single letters other than a, i) are scaled below every tier-1 word, unless the conversation
            mentioned them (a partner or user turn, the message, a commit)
        ──► paged list (limit/offset), p renormalised over all matches, `complete`, `longer`, `branch`;
            `complete: true` requests page the whole words only (the "Other words" chooser)
```

- **Lexicon** (`build_lexicon.py` -> `data/lexicon.tsv.gz`, 120,961 words): v0's union vocabulary,
  wordfreq words with Zipf >= 2.0, Webster's `web2` words that wordfreq has seen, `propernames`, a
  contraction list; junk filters (roman numerals, repeated runs, low-frequency possessives and 1-3
  letter tokens, apostrophe tokens outside the contraction shapes; round 2 applies them to v0's
  vocabulary too, dropping 660 tokens such as `i'ii`, `doesn'twork`, `c'n`, `kd`). Every word carries
  a wordfreq probability; words outside v0's vocabulary share `extra_share` of the prior mass in
  proportion to it. The source column also tells the engine which words are first names and which
  are Webster's dictionary words (the sentence-initial name cue below).
- **Wiktionary** (round 4, `add_wiktionary.py`, 866,363 words in all): 745,410 English Wiktionary words
  the built lexicon lacks (polyphiloprogenitive, levothyroxine, apricity, doomscrolling), so any real
  word can be typed rather than spelled. Kept: headwords and inflected forms that are not names,
  abbreviations, symbols or affixes and not only misspellings, obsolete, archaic, nonstandard or eye
  dialect; never the bare contractions round 3 dropped, the junk list or new apostrophe words. They are
  tier 2 (below every common word) with their wordfreq probability when wordfreq has seen them, else a
  1e-12 floor scaled by a letter 4-gram's view of the spelling. Rebuild after `build_lexicon.py`:
  `curl -sSL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz | gunzip |
  python3 wiktionary_extract.py wiktionary-english.tsv && .venv/bin/python add_wiktionary.py
  wiktionary-english.tsv`. The prefix index is one sorted array (`engine/lexicon.py` `PrefixIndex`):
  the lexicon takes 196 MB and 3.2 s to load.
- **Word tiers** (round 3, the `tier` column; rules in `build_lexicon.py`): tier 1 is every word a real
  dictionary attests: the New Oxford American Dictionary through macOS DictionaryServices (headword,
  inflection of a noun/verb/adjective, or variant spelling; affix-only entries such as `ur-`, `im-`, `-let`
  are no evidence; abbreviations, symbols and acronyms only above Zipf 4.5, or 4.0 when the dictionary marks
  them informal: `pm`, `tv`, `idk` yes, `gm`, `nj`, `thx` no), plus the curated and valid-shape contractions,
  words that occur ten times or more as standalone tokens in the DailyDialog training text (its `don ’ t`
  split repaired), and words of four letters or more that `web2` lists (by inflection stem) or reach Zipf 3.5
  without any dictionary (modern words, frequent names). Tier 2 is everything else (`gm`, `thx`, `ll`, `ariz`,
  `tha`, `priya`, `o'brien`, `psg's`, roman numerals); tier 3 is the single letters other than `a` and `i`.
  Words the dictionary knows only as a contraction with an apostrophe (`dont`, `aint`, `theyre`, `spose`),
  bare forms of the curated contractions it does not list (`im`, `thats`, `hows`) and misspelled contractions
  (`arn't`, `your're`) are dropped; `cant`, `wont`, `ill`, `well`, `lets` stay because the dictionary lists
  them. `JUNK` holds the dictionary words that are misspellings in every sentence of the training text
  (`wat`). `Engine.demote` scales the mass of tier-2 and tier-3 matches below the smallest tier-1 match,
  keeping the ratios inside a tier, so the list and `p` stay consistent; a tier-2 word the pointer cache has
  seen counts as tier 1 for that request. The sources were chosen on the dev records (`bench/decision.tsv`
  rows `r3.*`: worst-case cost of each rule) and measured on full dev (RESULTS.md round 3).
- **Round-3 behaviour** (hostile review): with empty `groups` the last message word is never first and words
  among the last three message words keep 10% of their mass unless the rescorer alone expects the repeat
  (`repeat_discount`, `repeat_lm_floor`); `commit` learns only words outside the lexicon that look like words
  (no profanity), fading 3% per later commit; when the best exact match for a typed code is improbable
  (`slip_floor`) and a word one digit away is far likelier (`slip_prior`), the correction joins the first page
  marked `corrected`; every word may carry `display` (I, I'm, Priya, Zorvella); the branch rule asks for two
  complete, likely words (`branch_complete` 2, ratio 0.3, `branch_p0_min` 0.2); both rescorers reuse the keys
  and values of the longest shared token prefix when the prompt changes in the middle (a growing partner
  transcript); the HTTP backlog is 64.
- **Pointer cache** (`engine/cache.py`): a continuous-cache distribution (Grave et al. 2016; Merity
  et al. 2016) over words in the history, decaying per turn of age, partner turns weighted above the
  user's, words already in the message weighted low, frequent words damped by `idf_floor / p(w)`.
  Possessives contribute their stem (`Nkechi's` -> `nkechi`). Capitalised uncommon words that do not
  start a sentence count double (a name cue); a sentence-initial one counts double only when it is a
  known first name, outside the lexicon, or not a Webster's word ("Marcus called.", not "Yesterday ...").
  Words not in the lexicon are offered from this cache alone; `commit` adds to a per-session counter
  that feeds the same cache.
- **Exact rescoring** (`engine/mlx_rescorer.py` on the GPU; `engine/neural.py` is the torch fallback):
  the prompt (`Partner: ...\nMe: ...`) is encoded once and its keys/values are kept; when the next
  request's prompt extends it, only the new tokens run. All candidate spellings (lower and
  Capitalised) are laid out as a token-trie forest in one sequence; a boolean attention mask lets
  each trie node see the prompt and its own ancestors only, so every distinct prefix is computed once
  and the prompt is never copied per candidate. The MLX pass walks the decoder blocks itself: the
  nodes sit on the batch axis for the rotary embedding so each gets its own position (prompt length
  + depth), then attend over the cached prompt keys plus the node keys. It is exact against scoring
  each word as a plain sequence (max abs diff 0.006 in bf16, identical order). Each candidate's
  score adds the probability that the next token starts a new word (a space-initial token,
  punctuation, EOS), so "rest" and "restaurant" are compared fairly. A word learned from `commit`
  that the prompt never mentions gets the mean neural score instead of an unknown-name penalty.
- **Branch rule** (`Engine.branch`): `branch` is true when `groups` is non-empty, `k >= branch_min_k`,
  `p(words[1]) / p(words[0]) >= branch_ratio` and the completeness condition holds; the values in
  `DEFAULTS` were chosen on the dev splits by `bench/branch_sim.py` (trade-off curve in RESULTS.md).
- **Server** (`engine/http.py`, `server.py`): validation from v0, request ids from PR 15, one lock
  around the engine, `ThreadingHTTPServer` so slow clients do not block parsing, warm-up before bind.

### What came from PR 15, PR 16 and the paper

- PR 15 (isolated autocomplete contract): request ids echoed so the client can drop stale
  responses, explicit `[role, text]` history validation, defaults for missing fields, and the stance
  that the server never mutates the caller's draft. Taken. Its `context_text` convenience and the
  larger status/alternatives response shape were not needed by CONTRACT.md and were not taken.
- PR 16 (two-choice backend + Claude reranker): the two-choice API makes most words unreachable, so
  it was not taken; its benchmark (24 synthetic prompts, remote model, p95 2.4-2.9 s) does not
  support a product claim. Its one good idea, adding words present in the conversation to the
  candidate pool so names outside the dictionary can be chosen, is the pointer cache here, measured
  on the dev splits and in the adversarial suite.
- "Attention Is All You Need" (Vaswani et al. 2017): the rescorer runs a decoder-only descendant of
  the paper's architecture. Ideas used directly: the causal mask (setting illegal connections to
  -inf before the softmax) is what the trie-forest mask generalises, so one pass scores many
  candidate continuations; the autoregressive property (position i depends only on positions < i)
  is why the prompt's keys and values can be cached and extended across requests; scaled
  dot-product attention and multi-head attention are what SDPA executes inside the model;
  the shared input/output embedding is why word scoring can take the logits straight from the
  hidden state. Not applicable: the encoder-decoder split (no source sequence), sinusoidal position
  encodings (these models use rotary embeddings), label smoothing, dropout and the training schedule
  (nothing is trained here), and beam search (the task ranks a fixed candidate set, it does not
  generate).

## Limits

See RESULTS.md. The models inherit v0's licences (DailyDialog: non-commercial). The lexicon includes
rare and foreign-looking words from wordfreq; the paging contract makes them reachable, the prior
keeps them out of the way. The rows added from Wiktionary (sources `k`) come from Wiktionary, the free
dictionary (https://en.wiktionary.org), via the kaikki.org extract, under CC BY-SA 4.0; a copy or
derivative of `data/lexicon.tsv.gz` must keep that attribution and licence.
