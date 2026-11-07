# prototype in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core**, invoked explicitly.

## Clarte already has a picker for whole screens

To compare whole layouts, add a style to `prototypes/UI/v0/` and its switcher in `s_all/` (`node prototypes/UI/v0/s_all/serve.mjs`, port 5100). That is how s0–s5 were built. Use this skill's PICKER.md harness for a single piece within a screen, such as the dwell indicator or the word in progress.

## The picker on a gaze screen

PICKER.md says to copy the picker verbatim, at the bottom centre or the top. On a gaze screen both spots are inside backend quadrants (Q6/Q7 or Q2/Q3). Copy the picker's markup, styles and keys verbatim, but:

- Never give it a `data-action`, so gaze selection and `validateLayout` ignore it. Switch variants with its keyboard keys or `?v=`.
- Hide it while you record evidence. Screenshots and recordings show the variant alone.

The upstream exception for its highlight animation stays as written: it is chrome, not part of the design under test.

## Divergence axes that are real here

The skin is decided (BRIEF § Visual direction), so variants never differ only by colour or type. Real axes for Clarte:

- the quadrant map and where the rest zones are
- the selection method (dwell only, or dwell plus confirm)
- the dwell indicator form (contracting circle, filling ring, colour ramp; RESEARCH open question 4)
- how the partner sees state (band, earcon, companion)
- how many targets a phase shows

Every variant passes `selftest.ts` and `check-layout.mjs` in every phase, and uses the shared engine. Variants never edit `shared/`.

## Promote and clean up

Hard Rule 5 (delete the prototype surface after promotion) is suspended for UI v0. The team reviews all styles together, and none is deleted or committed without the owner (BRIEF deliverables).
