# Prediction investigation and review

## Source comparison

Inspected PRs [#7](https://github.com/simplythatguy/clarte/pull/7),
[#10](https://github.com/simplythatguy/clarte/pull/10), and
[#13](https://github.com/simplythatguy/clarte/pull/13), all by simplythatguy.
The local checkout began clean apart from unrelated `.agents/`, on main at
`ca8aa54339a8ffd6519f5638403520cb69c436c6`, identical to origin/main.
This comparison records the investigation snapshot. By PR preparation, #10 and
#13 had merged; the backend PR was rebased onto current main so those upstream
setup and UI changes are not part of its diff.

| Version | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| Local/main and merged #7 | Contextual n-gram plus optional fine-tuned SmolLM2; local inference; established research ranking | Fixed vocabulary, absent local model artifacts, unsupported local Windows build; up to 12 choices | Preserve probability model and research rank; change product API to two choices |
| Open #10, `70879fdee15c375d5d1494f94ab7e71eb78b7d42` | Redistributes pinned model artifacts and adds Windows support | Same ranking algorithm; model size, licensing and LFS costs; compiler setup | Reuse its verified artifact provenance for experiments |
| Open #13, `bab98dbacf962eaf7979c6194b2f9e3a36e7c040` | Cross-platform provisioning and Zig/zlib build; same contextual model | Setup improvement rather than an accuracy improvement; large download and cold startup | Best available Windows runtime base, tested in ignored scratch without merging the PR |
| Experimental Light + context-word pool + Claude | Local group validation, contextual ranking, names from explicitly supplied context even outside the fixed dictionary | Remote inference, network latency, shortlist misses, public synthetic evidence only | Evaluate separately; not enabled in the application |

There was no better uncommitted local prediction implementation to combine with
GitHub. Layout demos s1 onward still use a small stand-in decoder; s0 calls the
actual backend. The changes here target the backend and its Python autocomplete
client, not those layout demos. Jev was excluded at the owner's request.

## Changes and experiment method

`predict` exposes one consistent pair across likely, choose, candidates and ghost;
short contains only qualifying words from that pair. Autocomplete exposes a
winner plus at most one alternative. Probability denominators still include all
matching vocabulary words. Research `rank` is unchanged.

The protocol was written before running experiments. It separates no-group,
two-group, and full-code exact top-two success, counts failures as misses, and
sets a 98% independent-evaluation target plus latency and validity requirements.
The 24 authored synthetic examples are split into 12 dev and 12 test prompts.
They are small regression fixtures, not an independent user study.

Tested frequency, recent-context boost, Light, Claude generation, Claude
frequency/context shortlist reranking, and a Light/context/Claude hybrid. Tested
Haiku 5.5 and Sonnet 5.5. Deployable could not be evaluated because its base and
fine-tuned model weights were not downloaded; no superiority claim over it is
supported. The Light counts and ARPA downloads were verified against their
Git LFS SHA256 pointers. The PR13 Windows native build succeeded.

Development integration failures were retained in `.scratch/prediction/`:
small output budgets were consumed by default thinking; free generation violated
groups; unsupported thinking/schema configurations produced HTTP 400. The final
hybrid supplies an enumerated, already validated candidate pool. It contains the
Light top-64 plus words present in the provided context. The model ranks rather
than computes group codes. No target or future message is sent to it.

The final workflow was selected before test using equal-weight macro dev top-two
success across the three stages, breaking ties by fewer errors and then local
execution. Latency remains a separate release requirement. No tuning to test
misses is permitted by this protocol. All API calls used synthetic examples;
application inference remains local. Keys live only in ignored root `.env`.

## Measured results

| Stage | Light dev top-2 | Hybrid dev top-2 | Frozen hybrid test top-2 | Test top-1 | Test p95 |
| --- | --- | --- | --- | --- | --- |
| No groups / next word | 4/12 | 11/12 | 10/12 (83.3%) | 8/12 | 2.47 s |
| Two groups | 10/12 | 12/12 | 12/12 (100%) | 11/12 | 2.40 s |
| Full groups | 11/12 | 12/12 | 12/12 (100%) | 11/12 | 2.86 s |

The hybrid is Light top-64 + explicit context words + Claude Sonnet 5.5 reranking.
All final dev/test calls returned valid outputs; no API failures or empty results.
The synthetic unseen-name cases succeeded through context-word augmentation.
The selected workflow was frozen before test. Raw reproducible evidence:
[dev](results/dev-selected.json), [test](results/test-selected.json),
[selection](results/selection.json). Both runs use the same corpus/vocabulary
hashes. Later allow-list and reporting changes do not alter the selected prompt,
candidate policy, model or scoring.

The release benchmark is **not met**. There is no independent real-user evaluation;
12/12 has a Wilson 95% interval of approximately 75.7–100%, and 10/12 has an
interval of 55.2–95.3%. No-group prediction remains ambiguous. Remote p95 exceeds
the two-second target. The test cases are now consumed for selection purposes;
further tuning must use new dev examples and a fresh independent evaluation set.
Do not market these numbers as 100% English-language accuracy.

The production improvement delivered here is the backend two-choice contract.
The strongest remote workflow is a runnable benchmark prototype, not a silently
enabled product feature. Fixed-dictionary words absent from supplied context can
still be unrecoverable; exact spelling/personal vocabulary remains necessary.

## Sol review ledger

One round with GPT-6.1 Sol, high effort. Verdict: CHANGES, with one finding.

| ID | Severity | Outcome |
| --- | --- | --- |
| S1 | should | Fixed: only verified Haiku 5.5 and Sonnet 5.5 configurations accepted; unsupported models rejected by CLI and callable adapter before setup/network. Regression test added. |

No findings declined. Five contract tests pass. Changed Python modules parse;
`git diff --check` passes. A live Light call through the changed predictor returned
outside first and respected the two-choice contract. Sol found no ordering/caller
regressions and confirmed the research rank was unchanged. No second reviewer was
started for this small fix; this is not a claim of a final APPROVE verdict. Review
usage was not supplied. The tracked diff was 31 insertions / 27 deletions at review
and 32 insertions / 28 deletions after the final documentation correction;
benchmark files and `.env.example` are additional untracked
files. No commit or push was made during the investigation; the backend PR was
prepared afterward at the owner's request.

`python -X utf8 scripts/validate.py` pre-fails on 135 vendored-file hashes in this
Windows checkout. All 135 match their locked hashes when read from Git objects,
consistent with checkout line-ending conversion. No upstream copies were edited.
Plain Python without UTF-8 mode also encounters the pre-existing Windows text
decoding issue in that validator. No camera, microphone or UI layout changed.
