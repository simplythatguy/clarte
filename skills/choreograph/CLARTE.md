# choreograph in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.** `prototypes/UI/v0/MOTION.md` tells builders to cast every event with this skill's format before coding it.

## Start from what is already cast

`MOTION.md` § "Choreography of the frequent moments" already casts the frequent events: group committed, word accepted, delete, candidate changes, speak, listening starts or stops, phase or page change. Use those rows as given. Run the Step 1–5 method only for events that aren't in the table, and add the result to the style's `DESIGN.md`.

## Overrides

- **No stagger** on anything seen more than once a session. That covers every gaze screen except the calibration sequence. The upstream 30–80 ms product stagger does not apply.
- **No direction-aware slides.** Forward and back, menu and page changes are one cross-fade in place: outgoing 150 ms, incoming 300 ms starting at 100 ms. Nothing slides across quadrants. Step 5's slide rules apply only to the voice prototype.
- **No attention loops.** The "Attention Loops" section is banned on gaze screens: idle motion is forbidden, and nothing moves while no event is happening.
- **Static is the default role.** On a frequent event, every tile, the band and the transcript are Static except the one lead. A tile that is armed is always Static.
- **Carry is unused.** No shared-layout animation moves an element between quadrants.
- **Interruption** means gaze leaving mid-dwell: the arc drains over 150 ms. Also tracking lost mid-commit: suspend, never complete an old dwell on reacquisition. A late decoder result never retargets the word under an armed accept.
- **Reduced motion** follows `MOTION.md`: the arc becomes four opacity steps, there is no bloom, and the calibration guide dot jumps.

## The one real sequence

Calibration (`MOTION.md` § "The calibration sequence") is the only multi-beat sequence: the guide dot travels with `--ease-move`, the ring fills, blooms, then a beat. In v0 the product keeps the calibration flow in `prototypes/Eye Tracking/`. Choreograph changes there against its `docs/MINIMAL-FLOW.md`, not against the simulated sequences in the styles.

## Output

Use the upstream timeline table. Name the `MOTION.md` token for each duration and easing.
