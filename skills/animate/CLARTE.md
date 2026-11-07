# animate in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core** for building any state change.

## The gate, translated

Step 1's frequency table uses the Clarte tiers in [Skills for Clarte § Motion translated](../../docs/skills-for-clarte.md#motion-translated). Every gaze selection is the top tier. Its only motion is the in-place cue `MOTION.md` already defines. Add two questions before Step 2:

- **Can it move while a target is armed, or near where the person is looking?** Then it doesn't animate.
- **Does it change mean screen luminance?** Then it doesn't animate.

Step 2's "Explanation" and "Delight" purposes belong only to the rare tier (calibration complete, a voice made for the first time). Even there, keep to the one bloom; add no confetti and no new sequence.

## Ingredients

- **Tool:** CSS transitions, `@starting-style`, or WAAPI. UI v0 has no motion library and no UI kit (BRIEF deliverables), so don't install Motion. The dwell arc is a transition on a registered `--progress` custom property set on the ring itself (`MOTION.md`), so it drains back instead of snapping.
- **Properties:** `transform`, `opacity`, `color`, `background-color`, `stroke-dashoffset`, `clip-path` (the `MOTION.md` list). On gaze tiles, no `transform` that changes a tile's footprint: no press scale, no hover lift. The bloom scales a pseudo-element with `overflow: visible`, so layout never moves.
- **Easing and duration:** the `MOTION.md` tokens (`--ease-out`, `--ease-state`, `--ease-move`; `--dur-press` 120, `--dur-cue` 150, `--dur-settle` 180, `--dur-enter` 200, `--dur-phase` 300, `--dur-bloom` 450). The upstream `--ease-out` is the same curve. Don't add `--ease-drawer`. Progress is `linear`. Never `ease-in`, and never `transition: all`.
- **Springs:** none on gaze screens. A bounce is a target moving.
- **Hover gating:** irrelevant on gaze screens, where `:hover` must not carry any state (the mouse is simulated gaze). On the voice prototype, gate hover as upstream says.
- **Reduced motion:** `MOTION.md` specifies each fallback (arc as opacity steps, no bloom, cross-fades only).

## Voice prototype

Upstream rules apply, with its own tokens in `prototypes/Voice/src/styles.css`. Press feedback is fine for tremor users if it never shrinks the target below its 64 px floor. Recording state shows with colour, label and icon, never motion alone, and nothing runs on a timer.

## Output

Add one line to the upstream output: **Gaze check**, stating that nothing moves while armed and luminance is constant, or the reason it doesn't apply (not a gaze surface).
