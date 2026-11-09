# find-animation-opportunities in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.** Expect it mostly to reject candidates. On a gaze screen, "nothing survives" is the common and correct result.

## The gate, extended

Use the Clarte frequency tiers in [Skills for Clarte](../../docs/skills-for-clarte.md#motion-translated). Then add two questions after the upstream four:

5. **Gaze safety.** Could the motion happen while a target is armed, or in the person's line of sight while they read? Reject.
6. **Luminance.** Does it change mean screen luminance? Reject.

The "Delight" purpose exists only at the rare tier. Even there, the bloom in `MOTION.md` is the whole delight budget. Don't propose a second celebration.

## Where to hunt in Clarte

Real seams are teleporting state that would confuse someone reading slowly:

- the ghost letters of the word in progress swapping with no cross-fade
- a candidate replaced while the person reads it (the fix may be freezing it, not animating it)
- new partner words appended to the transcript, shifting text under the reader's gaze
- the listening band and recording dot changing state
- voice prototype: upload processing, voice build progress, a piece left out of or put back in the reference strip

## Values

Every suggested value comes from the `MOTION.md` tokens (or `app/src/styles.css` for the voice prototype), not from the upstream vocabulary. Upstream `--ease-out` is the same curve. Upstream `--ease-in-out` maps to `--ease-move`, which is reserved for the calibration guide dot. Nothing uses `--ease-drawer`.

## Rejected candidates to expect

- Press scale on gaze tiles: there is no press, and it moves the tile during selection.
- Hover transitions on gaze tiles: `:hover` is simulated gaze and must carry no state.
- Staggered group tiles or menu items: seen every session.
- Toasts for status: they time out and float over quadrants. Status lives in place.
