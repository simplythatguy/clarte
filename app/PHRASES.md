# Personal phrases

## Learned follow-ups take precedence

When the person has completed phrase A followed by phrase B, B is an observed personal successor
of A. Matching observed successors stay first, in personal-regression order, both before and after
the recurrent model answers. The RNN ranks the remaining matching alternatives; it cannot replace
an observed personal follow-up with a generic short phrase. With no matching observed successor,
neural backoff and the existing frequency fallback continue to work. This is a retrieval/ranking
policy, not online retraining of the public-corpus GRU weights or a guarantee of intended wording.

The previous implementation replaced the whole personal ranking when the neural result arrived.
This caused the brief correct suggestion followed by a generic response. The recurrent model's
whole-utterance likelihood favors short phrases, making that overwrite particularly visible.

Personal phrase keys that differ only by apostrophes now share a learning family: for example,
I'm hungry and the punctuation-free Im hungry use the same personal context. Existing split
rows and their incoming/outgoing transitions are combined when reading a snapshot; new events
reuse an existing family key. No rows, counts, transition edges or event IDs are deleted or migrated.
Persistence remains local SQLite. Partner text is not added to this personal transition store.

`npm test` includes `scripts/test-phrase-learning.ts`: the reported sequence, delayed/adversarial
neural replacement, one/repeated observations, apostrophe aliases, historical split rows, retries,
reopening SQLite, prefix compatibility and explicit acceptance. An optional integration run is
`PHRASE_RNN_TEST_ORIGIN=http://127.0.0.1:8765 node scripts/test-phrase-learning.ts` (PowerShell:
set `$env:PHRASE_RNN_TEST_ORIGIN` first). The next-phrase browser regression supports the same
variable to verify that a real delayed neural answer does not remove the learned suggestion.

Phrase choices and accepted phrase drafts now omit punctuation and quote marks. Existing SQLite
records and model inputs are retained; presentation normalizes and deduplicates choices. Decimal
points are expressed as the word point so a number such as 1.5 does not become 15.
The suggested phrase itself is selectable: click it, focus it and press Enter, or use the existing
centre gaze target with sound confirmation. Selection fills the draft; Speak is still separate.
When a phrase is offered, the centre target accepts that phrase rather than a different word.
Individual word choices remain in Options. There is only one centre action across Q2/Q3, and its
wording freezes while the person looks at it. Without a phrase match, centre word selection works
as before. Archived fade-out previews are inert.

## If phrases are missing at http://localhost:5200/

Finish the normal Welcome/calibration/voice setup to reach the conversation. Phrase suggestions
are not displayed on those setup pages. In the conversation, check **Menu → Settings → Suggested
replies → On**. This existing preference currently controls both suggested replies and saved-phrase
recommendations; an older saved Off preference is retained across reloads. The top-right **Options**
button opens the phrase choices. A browser check of the exact root URL through Keyboard and mouse
and Not now reached three choices with this preference On; setting it Off suppresses phrases in
both idle and typing states. This does not establish the preference in another browser/profile.

While typing, only saved phrases matching the accepted words and pending groups appear. The GRU
re-ranks those candidates; it does not produce arbitrary new sentence completions.

Starter suggestions now appear on an empty conversation without requiring a previously spoken
phrase or partner turn. The top-right Options control opens the three phrase choices; choosing
one fills the draft and Speak remains separate. The same starter list is bundled locally, so
it remains available if the phrase database cannot load. Phrase API requests have a four-second
deadline; failed requests retain the current choices. Suggestions must be enabled in Settings.
During typing, this feature retrieves saved phrases matching the accepted words and pending
groups; it does not generate a new sentence for every arbitrary prefix. Earlier notes about
hiding unconditional suggestions on a fresh database are superseded by this visibility fix.

## Current model file map

- `phrase-store.mjs` persists personal phrase counts and transitions in local SQLite;
  `phrase-regression.mjs` supplies the baseline ranking through `phrase-api.mjs`.
- `src/phrases.ts` filters candidates and requests optional partner-context ranking;
  `src/useWords.ts` connects it to the app while preserving frozen Options choices.
- `../engine/engine/dialogue_lm.py` defines the recurrent model;
  `../engine/train_dialogue.py` trains and evaluates it.
- `../engine/engine/predictor.py` loads the checkpoint and ranks phrases;
  `../engine/engine/http.py` exposes `POST /api/v1/phrases`.
- `../engine/models/dialogue/phrases.pt` and its `phrases.json` receipt are local,
  ignored artifacts. Their hashes must agree; do not publish them as source files.

For local use, run `npm run dev` here (http://localhost:5200) and, from
`main/engine`, `.venv/Scripts/python.exe server.py --model light --rescorer none`
on Windows (http://127.0.0.1:8765). Light disables the neural **word** rescorer;
the recurrent **phrase** model still loads automatically when its checkpoint exists.
The app discovers the backend automatically. Both services must remain running.

2026-11-08 verification: app tests/build, four recurrent-model tests and eight fast
HTTP/validation tests passed; twelve live word-engine tests were skipped. The local
checkpoint matches its receipt. Linear access is now available: context and results
are recorded in [the recurrent implementation topic](https://linear.app/nathacks/document/decoding-recurrent-partner-context-phrase-implementation-and-local-a56885a77d42).
Earlier access-failure notes below describe prior sessions.

The optional local recurrent dialogue model now re-ranks eligible saved phrases using both personal
and partner conversation turns. It interpolates an utterance GRU with a two-sided dialogue GRU;
see [training, runtime and limitations](../engine/DIALOGUE_PHRASES.md). The regression described
below remains the shortlist and fallback. Options snapshots and explicit Speak are preserved.
Earlier sections describing regression as the only model are historical implementation notes.

The Vite dev and preview servers create `data/phrases.sqlite` using Node 24's built-in SQLite support. This file contains personal speech and is ignored by Git. No prototype files or prediction models are changed. A deployment using another server must provide the same `GET /api/phrases` and `POST /api/phrases` endpoints; a static-only deployment cannot persist this database.

Eight English starter phrases have equal prior weights of 1. These are practical defaults, not measured global frequencies: Hello; How are you; I am fine; Thank you; Yes; No; Please help me; Can you repeat that.

After a newly composed utterance finishes speaking, its total count increases. A transition count records how often it follows the person's previous completed utterance. Partner speech, previews, acceptance into the draft, interrupted speech, floor-holders and replaying an existing turn do not train the database. Event IDs prevent duplicate counts on retries. The previous personal phrase persists across launches. The initial implementation is one personal database per app installation, not multiple user profiles.

After completed personal speech, the three highest-scoring saved phrases appear immediately, with no letter group required. During grouped typing, candidates must also match accepted words and the pending groups of the next word. Predictions use regularized multinomial logistic regression, with personal phrase frequency as the baseline and a one-hot feature for the previous personal phrase. No percentage is displayed. Normal word choices remain available after phrase choices while typing.

The first phrase is a lighter, read-only preview in the conversation. Options contains that phrase and its two alternatives when available. Opening Options freezes both the text and its meaning. Choosing a whole phrase replaces the matched draft; it does not speak. The person explicitly selects Speak afterwards. Continuing to enter groups updates matches and never inserts a phrase. There is no automatic phrase choice, and no extra actionable target in the conversation rest zone.

Between utterances, Q4 opens the three next-phrase choices and Q1 retains Menu. The next-phrase chooser offers Listen in Q8, keeping partner listening available. Letter groups remain available on the main screen. Existing-turn replay remains available through the conversation's replay buttons. Suggestions disabled restores the previous Listen/Say again controls. A fresh database does not offer unconditional next phrases until it has a personal context.

## Regression model and sequence repair

The original implementation gated phrases on pending groups in both `phraseChoices` and `wordsNow`; it stored transitions but did not surface them between utterances. Both gates are repaired. `phrase-regression.mjs` fits a multinomial softmax classifier over saved phrases. For candidate j, the logit is `log((uses_j + prior_j + 0.25) / total_mass) + context_weight_j`. Context weights minimise transition-count-weighted cross-entropy plus `0.1 / 2 * sum(weight_j²)`. Gradient descent runs at most 250 steps, stopping when every update is below 1e-7. With one-hot previous-phrase features, each context row is independent and can be fitted from its aggregate counts when requested. SQLite remains the durable training store; coefficients are reconstructed deterministically without changing the database schema or losing existing learning. Requests that record completed utterances are serialized in the client to preserve sequence order.

After `Hi → I am good → Hi`, `I am good` should rank highly without typing. After `I am good`, if no follow-up was observed, the model falls back to personal frequency and starter priors. It cannot infer an unseen personal routine or promise that any predicted phrase is intended. Scores sum to one but have not been calibrated against user data. This model uses the immediately previous personal phrase; it does not train on partner speech or use a multi-utterance neural context.

Implementation choice (authorized by the user's request for neural networks or regression): use local multinomial logistic regression. It learns from the existing aggregate counts, needs no new runtime or downloaded model, and can respond to a single observed pair. A neural model was not implemented; its training-data and runtime requirements were not evaluated with user data. Any accuracy comparison remains unverified. This choice and the sourced code findings are pending Linear sync: Start here was inaccessible and no Linear connector was available. No DEC identifier has been allocated and no Linear write is claimed.

People add personal phrases by composing and speaking them normally. The database retains phrase counts and adjacent-phrase counts, not a chronological transcript. Browser `?reset` clears browser settings but does not erase this separate file. With the app stopped, deleting `data/` resets personal phrase learning and restores starters on the next launch. Back up that directory only while the server is stopped, because SQLite may also use WAL sidecar files.

Run `npm test` for persistence, regression/context ranking, collisions, explicit acceptance and continued-input checks. `PLAYWRIGHT_CHANNEL=msedge node scripts/test-next-phrases-ui.mjs [origin]` checks `Hi → I am good → Hi` through real app speech completion and a temporary SQLite store, with only word decoding fixed by test fixtures. This does not write to the person's database. Use Node 24 (the repository launcher supplies it). Ordinary word typing still works if the phrase API is unavailable; that failure is logged in the browser console.

Validation for this change: typecheck, production build, database/reducer checks, existing Options browser regressions and phrase browser checks passed. Phrase checks cover both 1440×900 and 1280×720 at normal and 200% text, including all three phrase targets visible together, continuing input and returning from ordinary words. Screenshots were inspected. `scripts/test-phrases-ui.mjs` accepts `PLAYWRIGHT_CHANNEL=msedge`; optional `LINTAPPLE_MODULE` names the locally available Lint Apple module for audits without adding a dependency.

Lint Apple 0.1.24 audited light-theme preview and Options states at those four configurations. The temporary policy used Atkinson Hyperlegible Next, the app's type sizes and the existing 20px minimum; 29–37 findings per state remain, including fitted-size mismatches, content insets/clipping, label consistency and an unresolved axe contrast measurement. This is not a clean accessibility audit. Geometry was independently checked with the app's quadrant validator, and all 32 existing debug states passed. Audit JSON and inspected screenshots are in `.scratch/phrase-ui/`. Repository provenance validation also reports missing/changed upstream skill copies; no such copies were changed by this feature.

Sequence-regression validation: `npm test` and `npm run build` passed. The new browser test passed at both sizes and text scales with normal and reduced motion, including real timer-based speech completion, `Hi → I am good → Hi`, no-input predictions, explicit acceptance, continuing input, reload and Listen. Word Options regressions and all 32 existing debug layouts passed again with the phrase API isolated from personal data. Lint Apple 0.1.24 also inspected the new no-input preview/Options states; unresolved fitted typography, inset/clipping, contrast-measurement and accessible-label/tooltip findings remain (34–42 per state). Settled screenshots were inspected at normal and enlarged text. Current audit output is in `.scratch/next-phrases/`; this remains a partial accessibility audit, not evidence of prediction accuracy. The updated Linear instructions were followed as far as available access allowed: `skills/linear-research/SKILL.md` was read, but Start here could not be accessed; no shared research or Decision log check and no write-back was possible.
