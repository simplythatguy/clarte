# ask-sonner in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: not in use.** Clarte has no Sonner dependency, and UI v0 allows no UI kit.

Toasts conflict with the gaze contract:

- They dismiss on a timer: "no time limit the person cannot change".
- They appear at an edge that is inside a backend quadrant, either adding an unplanned target or covering one.
- They put feedback away from the target, when it belongs on the target, in place.
- They stack several presentations of one operation, when there should be one authoritative presentation.

Put status where it belongs instead: on the target, in the state band, or as one inline line next to what it blocks, with a gaze-reachable next step (apple-hig-ui, Feedback and states).

If a pointer-only developer page ever needs toasts, use this skill as written there, and never on a screen the person uses by gaze.
