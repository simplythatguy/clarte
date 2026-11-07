# animation-vocabulary in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional.**

The upstream glossary stays authoritative for general terms. Clarte also has named moments of its own, defined in `prototypes/UI/v0/MOTION.md`. When someone describes one of these, answer with the Clarte name first, then the closest general term.

- **Intent delay**: the first 150 ms (groups) or 250 ms (controls) of a look, during which nothing changes. General: *Delay*.
- **Focus cue**: one static step when the intent delay ends; the tile face darkens one shade and the ring's track becomes opaque. Not a pulse.
- **Dwell arc**: the accent arc that fills clockwise from 12 o'clock over the remaining dwell, `linear`. General: *Hold to confirm*, driven by gaze.
- **Cancel drain**: the arc running back over 150 ms when gaze leaves, instead of snapping. General: *Interruptible animation*.
- **Commit cue**: the ring turns solid accent for 120 ms, on the same frame as the click.
- **Bloom**: a copy of the ring scaling from 1 to 2.4 while fading from 0.35 to 0 over 450 ms, on a pseudo-element. The one celebration. General: *Ripple*.
- **Re-arm**: the solid ring fading back to the track once gaze has left, allowing another selection.
- **Settle**: the typed glyphs going from group ink to plain ink over 180 ms when a word is accepted. General: colour *Crossfade*.
- **Ghost letters**: the rest of the predicted word in tertiary ink, cross-fading when the candidate changes.
- **Phase cross-fade**: Listen, Respond and Speak swapping in place (out 150 ms, in 300 ms starting at 100 ms). General: *Crossfade*; it is never a page transition with a slide.
- **Typed caption**: calibration captions typing at 32 ms per character. General: *Typewriter*.
- **Guide dot**: the calibration dot travelling between points with `--ease-move`.

Terms from the glossary that Clarte forbids on gaze screens: *Pulse*, *Float*, *Idle animation*, *Loop* on persistent elements, *Stagger* on repeated surfaces, *Parallax*, *Rubber-banding*, *Swipe to dismiss*, and *Hover effect* as a carrier of state. Name them if asked, and say they are not used here.
