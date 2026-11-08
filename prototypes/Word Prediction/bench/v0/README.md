# Two-choice benchmark, version 1

Freeze this protocol before tuning. This suite is synthetic engineering evidence,
not a clinical or real-user accuracy estimate. No private transcripts are used.

Primary metric: exact intended word in the first two distinct suggestions (top-2
recall), separately for no groups, two groups, and the full group signature.
Also report top-1, no-result rate, vocabulary coverage, invalid suggestions,
latency p50/p95 and API failures. Empty output and failures count as misses.
Never normalize away negation, synonyms, names, or spelling differences.

Target: at least 98% top-2 on an independently collected, untouched evaluation
set, zero group violations, at most two results, no automatic acceptance, and
p95 under 1 second locally (under 2 seconds for optional remote experiments).
Report a Wilson 95% interval: a small perfect fixture set cannot establish 98%.
No-group prediction is inherently ambiguous; report it separately rather than
claiming that every next word is knowable. Do not combine it with full-code scores.

Use dev for workflow selection. Evaluate the chosen workflow on held-out test
once; do not tune to its misses. A new iteration after test requires new held-out
data. The checked-in synthetic test is public and is only a regression set.
Production acceptance needs independent consented evaluation and a usable exact
spelling/personal vocabulary recovery path. Out-of-vocabulary cases remain misses.

Workflows: frequency-only, recent-context lexical boost, Light, Deployable,
Claude generation, Claude constrained reranking, and a hybrid that reranks the
Light top-64 plus explicitly supplied context words (including unseen names).
The first two are ablations,
not substitutes for the trained model. Missing artifacts are reported as blocked.
Constrained reranking cannot recover a target absent from its candidate pool.
Remote experiments are opt-in and send only this synthetic suite. Never import
session recordings, voice material or partner transcripts into this harness.

Run from the repository root:

```powershell
python 'prototypes/Word Prediction/v0/bench/run.py' --vocabulary PATH --split dev --output .scratch/prediction-dev.json
# Explicit opt-in, using one of the two verified configurations:
python 'prototypes/Word Prediction/v0/bench/run.py' --vocabulary PATH --split dev --claude-model MODEL --output .scratch/prediction-claude-dev.json
```

`MODEL` must be `claude-haiku-5-5` or `claude-sonnet-5-5`. Other model names are
rejected before loading models or making API calls. Haiku uses `disabled` thinking;
Sonnet uses `between_tools`, its documented way to disable up-front thinking.
API availability alone does not verify a model's request configuration.

The vocabulary can be the model cache's vocabulary.json, or the unchanged file
from PR #10 (70879fdee15c375d5d1494f94ab7e71eb78b7d42). Its existing provenance
and noncommercial data restrictions still apply. Results record the corpus and
vocabulary SHA256 and model identifier. API errors are recorded by status only;
keys and provider response bodies are never logged. Root .env is ignored by Git.
Jev is excluded at the owner's request; no substitute provider is used.

For a separate existing Windows engine snapshot, pass `--engine-root PATH`;
models must be in its `models/` subdirectory. This does not modify the engine
under test. Benchmark probability ranking is equivalent across the compared
PR #7/#10/#13 code; their packaging differences affect availability.

Claude uses schema-constrained output as documented in
[Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Up-front thinking is disabled so the small word-output budget is not consumed
by automatic reasoning. Group validity and shortlist membership are still checked
locally; malformed or truncated replies count as failures.

Reported prediction latencies exclude process startup and model loading. Hybrid
latency includes local shortlist generation and the remote request. Skipped calls
after a fatal API error count as misses but are excluded from latency percentiles.
Use `--workflows claude-hybrid` to test only a workflow selected on dev. Do not
reinterpret perfect scores on 12 synthetic cases as a release-level success rate.
