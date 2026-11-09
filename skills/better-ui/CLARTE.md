# better-ui in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.** better-ui itself says a deliberate, consistent project convention is a preference, not a finding. Clarte's conventions are in `docs/design/BRIEF.md` (Visual direction) and `MOTION.md` (Craft rules), and they take precedence.

## Exact values that Clarte replaces on gaze screens

| better-ui rule | Clarte value |
| --- | --- |
| Press scales to `0.96` | No press scale on gaze tiles. Commit is the solid ring for 120 ms plus the bloom. The voice prototype may use 0.96. |
| Shadows for elevation | No shadows and no borders on tiles (BRIEF, MOTION). Hairlines `#D2D2D7` at 1 px where structure needs a line. Not a finding. |
| Stagger infrequent entrances by 100 ms with 4 px blur and 12 px rise | No stagger and no blur rise on gaze screens. A phase is one cross-fade in place. |
| Exits with blur and −12 px translate | Exits fade in place, 150–200 ms. Nothing translates across quadrants. |
| Icon cross-fade, scale 0.25 → 1 with blur | Opacity cross-fade only, 150 ms, and only after gaze has left the tile. A relabel never happens under an armed dwell. |
| Icon stroke tracks text weight (1.5 px at 400 to 2.5 px at 700) | One thin stroke on a 24 px grid with rounded caps, whatever the label weight. `MOTION.md` says 1.5 px and the BRIEF says 1.6 px; this is an open conflict, so match the style's existing value. |
| Hover effects behind `@media (hover: hover)` | On gaze screens, no hover styling on `data-action` elements, gated or not. The mouse is simulated gaze; focus comes from engine state. |

## Rules that apply as written

- Outer radius equals inner radius plus padding (`MOTION.md` asks for concentric radii; tile radius 32–40 px per BRIEF).
- Optical alignment: labels optically centred, baselines aligned across a row of tiles.
- Transitions, not keyframes, for interactive state. Name the exact properties.
- `will-change` only on the ring and the bloom.
- One SVG, recoloured per state with `currentColor`. Inline SVG only; no icon fonts (BRIEF).
- Suppress transitions on theme switch. Theme changes only when the person chooses (luminance rule).
- `overscroll-behavior: contain` on menus and sheets.
- Every animated state change leaves a static cue. Motion is never the only channel.

## Severity

Add one HIGH class: anything that changes a target's footprint or position while it can be armed.
