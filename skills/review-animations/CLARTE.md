# review-animations in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.** `prototypes/UI/v0/BRIEF.md` requires this review on every style's own build, with its tables in that style's `REPORT.md`.

## What changes

The upstream bar assumes a pointer and a touch screen. Clarte's gaze screens add stillness and luminance rules, and they deliberately use some patterns the upstream escalation list flags. Review against `prototypes/UI/v0/MOTION.md` as the house standard: it is a documented decision, so findings that contradict it are not findings (upstream Guideline "don't re-litigate").

Add three standards to the ten:

11. **Gaze stillness.** Nothing moves, resizes or relabels while a target is armed or under the gaze point. A relabel waits until gaze has left the tile. No idle motion anywhere: breathing rings, pulsing dots, a caret above 1 Hz, shimmer, looping indicators.
12. **Constant luminance.** No dimming overlay, flash, or light-to-dark phase change. Theme changes only when the person chooses.
13. **MOTION.md acceptance.** The ten-point list at the end of `MOTION.md`, checked on a recording scrubbed frame by frame, not from code.

## Upstream rules that read differently here

| Upstream | In Clarte |
| --- | --- |
| Escalation: "pure-fade entrances with no initial transform" | Required. Menus, sheets and phases fade in place; nothing slides or scales across quadrants. Don't flag a fade. |
| Standard 5: popovers scale from their trigger | Not used. Menus fade in place. Flag any scale or slide that crosses into another backend quadrant. |
| Escalation: "everything-at-once entrance where a stagger belongs" | Reversed. Staggers are banned on anything seen more than once a session. Flag the stagger. |
| Standard 4: UI under 300 ms | Don't flag the dwell arc (600 / 900 ms, linear because it encodes time), the 450 ms commit bloom, phase cross-fades within 250–400 ms, caption typing, or calibration travel. Flag anything else over budget. |
| Standard 8: gate `:hover` motion | On gaze screens the mouse simulates gaze, so `:hover` must not drive gaze feedback at all. Focus, dwell and commit states come from the engine's state, not CSS hover. Flag any `:hover` style on a `data-action` element. |
| Press scale (`scale(0.97)` on `:active`) | Gaze has no press. Flag press scale on gaze tiles: it moves the tile's edge during selection. The commit cue is the solid ring for 120 ms plus the bloom on a pseudo-element. |
| Standard 2: no motion on keyboard actions | Keys 1–8, Space, Enter and Escape are simulator input. Keyboard-triggered actions get no motion (MOTION.md says so too). |

The voice prototype is a pointer and keyboard surface. Review it with the upstream standards, plus two: nothing on a timer, and recording state is never shown by motion alone.

## Verdict

Block also on: anything moving while armed, any luminance change, idle motion, or a `:hover`-driven gaze state. Cite `file:line` and the `MOTION.md` rule or acceptance item it breaks.
