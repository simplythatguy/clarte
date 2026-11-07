# emil-design-eng in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core** for craft review. Keep the required Before/After/Why table.

## Rows of the review checklist that change on gaze screens

| Upstream checklist row | In Clarte |
| --- | --- |
| No `:active` state → add `scale(0.97)` | Not on gaze tiles: there is no press, and scaling moves the tile during a dwell. The commit cue in `MOTION.md` replaces it. It is fine on the voice prototype. |
| Elements all appear at once → stagger 30–80 ms | Reversed: no stagger on anything seen more than once a session. |
| Popover `transform-origin: center` → trigger origin | Menus fade in place. Neither origin is used, because nothing scales across quadrants. |
| Hover animation without media query | On gaze screens, no `:hover` state at all. The simulator mouse is gaze. |
| Same enter and exit speed → make exit faster | Agrees with `MOTION.md`: every exit is shorter than its enter. |

## Sections that don't transfer

- **Tooltips** (skip-delay pattern): hover-only help cannot be reached by gaze and is not used on gaze screens.
- **Gestures and drag** (momentum dismissal, damping, pointer capture): gaze has no drag. On the voice prototype, every drag needs a discrete alternative (`apple-hig-ui`).
- **Blur to mask crossfades:** `MOTION.md` bans `filter: blur` on large surfaces. A 2 px blur on a small label cross-fade is fine.
- **Spring mouse tracking:** never attach anything to the gaze point. A cursor that follows the eye gets chased.

## What carries over unchanged

Taste and unseen details; custom curves (the same `--ease-out`); transitions over keyframes for interruptible state; reduced motion as "gentler, not zero"; reviewing in slow motion and again the next day. `MOTION.md` turns that last one into a rule: record each flow and scrub it at 10% speed.

## Sonner principles, translated

"Good defaults matter more than options." Clarte's defaults are dwell 600 ms for groups and 900 ms for controls, adjustable from 300 to 2000 ms; light theme; letters printed on tiles. "Handle edge cases invisibly." Pause dwell when the tab is hidden or tracking is lost, and never complete an old dwell on reacquisition.
