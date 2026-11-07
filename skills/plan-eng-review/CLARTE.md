# plan-eng-review in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.**

## Invariants every plan must keep

Trace each one the plan touches, in the test diagram and the failure modes.

- **No egress.** The eye-tracking CSP and request guard, the voice service bound to 127.0.0.1 with CORS limited to the page's origin, and the engines on loopback. A new dependency or call that reaches the network is a blocker until the owner approves it.
- **Nothing commits or speaks without a selection.** That includes a late decoder response, a reacquired gaze after loss, and a tab returning from the background.
- **Camera and microphone are released** on Stop, and never restarted on tab return.
- **Stored state stays bounded and versioned.** The calibration record (`still.local-calibration.v1`, at most 512,000 characters), the profiles record, each voice folder with its consent statement, and the phrase cache. A schema change needs a version bump and handling for old records.
- **Watermark and consent.** Every synthesised clip is Perth-watermarked. A voice exists only with its confirmed consent statement. Deleting a voice removes its folder.
- **Frozen outputs.** Word Prediction keeps its numerical paths to preserve frozen outputs; changes need an output comparison.

## Tests that count

- UI v0: `shared/selftest.ts` and `check-layout.mjs` (every phase, both viewports).
- Eye Tracking: unit, model, privacy and import checks, plus **session replay on recorded sessions** for any tracker change. Synthetic fixtures do not establish accuracy.
- Voice: `pytest` with the stub model and `npm test`, plus `scripts/evaluate.py` for quality claims.

"No test without a regression it would catch" stands.

## Ownership boundaries

`prototypes/UI/v0/shared/` belongs to the v0 brief; styles propose changes in their reports. `prototypes/Eye Tracking/` is imported from a pinned source; record changes against `docs/IMPORT-SOURCE.json`. `skills/` upstream files are hash-locked.

## Engineering preferences, translated

"New codepaths need logs, metrics or traces": local only. Development-build diagnostics and evidence files, no analytics. "Boring by default": the defaults so far (CPU synthesis on Apple Silicon, Light fallback) were chosen by measurement. Keep them unless new measurements say otherwise.
