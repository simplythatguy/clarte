# remove-animations in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core** for subtraction passes on the prototypes.

## Gate additions

Before the upstream tree, delete on sight on any gaze screen:

- motion while a target is armed or under the gaze point (resize, lift, slide, relabel before gaze leaves)
- idle motion: breathing rings, pulsing dots, shimmer, looping indicators, a caret above 1 Hz
- anything that changes luminance: dimming scrims, flashes, theme cross-fades the person did not choose
- slides or scales that cross backend quadrants, and direction-aware page slides
- staggers on anything seen more than once a session
- motion on keyboard-triggered (simulator) actions
- `filter: blur` on large surfaces

## Keep: documented decisions

These exist by decision in `prototypes/UI/v0/MOTION.md` and `BRIEF.md`. Upstream Hard Rule 4 protects them.

- the dwell arc, its 150 ms drain, and its re-arm fade: removing them removes the selection feedback itself
- the intent-delay focus cue (one static step)
- the commit cue: solid ring for 120 ms, click, and the 450 ms bloom
- the glyph cross-fade (150 ms) and the settle to ink (180 ms)
- the phase cross-fade, and the recording dot appearing over 200 ms
- the speak highlight stepping word to word

If one of these is badly built, list it for `improve-animations`. Don't delete it.

## Hazards specific to Clarte

- **Engine timing.** `shared/gaze.ts` owns dwell timing. A transition removed from the ring must not change when a selection commits. The engine decides; CSS only renders it.
- **Layout checks.** After removing motion, re-run `selftest.ts` and `check-layout.mjs` in every phase. A removed bloom pseudo-element can change overflow.
- **Eye Tracking prototype.** Its runtime logic and tests are exact copies of a pinned source (`docs/IMPORT-SOURCE.json`). Removals there are a deliberate adaptation that must be recorded, not a cleanup.
