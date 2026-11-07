# animation-performance in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.**

## The busy main thread is Clarte's normal state

Upstream treats "the page is busy" as the rare case. In Clarte it is constant: the WebEyeTrack worker runs inference on every frame, the gaze engine updates, the decoder answers over the network to a local server, and speech recognition and synthesis run. Measure under those conditions:

- Profile with the real tracker running (`prototypes/Eye Tracking`), not only with the mouse simulator. A mouse-driven dwell proves very little.
- The reference device is the laptop the person uses, running camera, model and page together, not a mid-range phone. The voice service is CPU-bound while it synthesises (it defaults to CPU on Apple Silicon), so check voice screens during synthesis too.
- `MOTION.md` acceptance item 8 is the bar: during a dwell, no layout or paint beyond the ring's composite.

## Clarte specifics

- **The dwell arc.** `MOTION.md` drives it with a registered `--progress` custom property feeding `stroke-dashoffset` or a conic mask. Set the property on the ring element itself, never on the grid, the tile, or a parent. That is the inherited-variable trap in this skill, and it scales with the number of tiles. `stroke-dashoffset` repaints the small SVG each frame. That is acceptable only if the Performance panel shows the repaint confined to the ring.
- **Never drive dwell progress through React state.** No `setState` per frame from gaze samples. Write to the element, or let a CSS transition run from the engine's start and cancel events.
- **The bloom** animates `transform` and `opacity` on a pseudo-element; `will-change` belongs on the ring and the bloom only (`MOTION.md`).
- **No `filter: blur`** on large surfaces.
- **The developer overlay** (`shared/overlay.ts`) draws every gaze sample. Turn it off when you profile.

## Report

Add a column to the Phase 3 report: **with tracker** yes or no. A finding verified only with the simulator says so.
