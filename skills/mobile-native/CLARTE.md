# mobile-native in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: not in use.** Clarte runs on a laptop with a webcam. The voice service binds to 127.0.0.1, so a phone can't reach it as built. Use this skill only if a surface moves to a phone or tablet, for example a partner companion display (`prototypes/UI/v0/RESEARCH.md` §12, open question 8).

A few items matter on the laptop today:

- **Never disable zoom** (Hard Rule 4). Clarte needs 200% text.
- **`overscroll-behavior`** on the full-screen gaze page, so no rubber-band moves the grid under the person's gaze.
- **`user-select: none`** on gaze controls, so a dwell on a label never starts a text selection. Keep message and transcript text selectable for keyboard and screen-reader users.
- **`100dvh`** for the full-screen layout, so the lower row of backend quadrants is fully visible. Verify this rather than assume it (apple-hig-ui, Layout).

Hover gating here is about touch. On gaze screens the stricter rule applies: no `:hover` state at all on actionable elements.
