# untangle-codebase in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional**, invoked explicitly. Scope it to **one folder per run** (`app/`, `engine/` or `voice/`), never "this codebase". They are deliberately separate parts with their own dependencies.

## Protected: not tangles, don't touch

- **`skills/`** upstream copies. They are hash-locked in `sources.lock.json`; changing them fails `scripts/validate.py`.
- **`app/src/eyes/core/`** and **`app/public/vendor/webeyetrack/`**, which are byte-identical copies listed with their hashes in `app/src/eyes/SOURCE.json`. A refactor there is a deliberate adaptation the owner must approve and the provenance docs must record.
- **`vendor/`** directories and the bundled Pretext.
- **`engine/`** numerical paths and the transformer KV caches. The README says they are retained to preserve frozen outputs.
- **`app/src/core/quadrants.ts`**, which enforces the backend quadrant contract in `docs/design/QUADRANTS.md`.

## Duplication that is intentional

s1–s5 repeat structure on purpose: they are parallel explorations of one brief, kept separate so they can be compared. Copies across styles are not "hidden links" to merge until the team has chosen a style. Prediction is one engine (`engine/`): the separate Word Prediction and Autocomplete versions were merged on 2026-11-08, so new prediction work goes there rather than into a new versioned copy.

## Proving "intended behaviour is the same"

- **UI v0:** `selftest.ts` and `check-layout.mjs` in every phase, before and after.
- **Eye Tracking:** the full Verify list, plus session replay results unchanged on the same recordings.
- **Word Prediction:** identical outputs on a fixed set of inputs for both Light and Deployable. The engine promises frozen outputs.
- **Voice:** `pytest` and `npm test`. The phrase cache and consent records must keep their on-disk shape, or existing voices break.

The "Tests" option must not delete the privacy and network checks (`check:privacy`, `check:import`) or the consent and deletion tests. They guard behaviour that matters even when it looks static.
