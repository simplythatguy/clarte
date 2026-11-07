# pick-ui-library in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional**, invoked explicitly. On Clarte the usual answer is "none".

## Constraints that come before the list

- **UI v0 styles:** no UI kit and no CSS framework; plain CSS or CSS modules with tokens in `:root`; inline SVG only, no icon fonts (`prototypes/UI/v0/BRIEF.md` § Deliverables). base-ui, cmdk, Sonner, Motion, dnd kit, Leva, cva and next-themes are all out.
- **Gaze screens** can't use components built around hover, focus traps for pointer users, drag, or timed dismissal, even when accessible. Every actionable element must sit in one backend quadrant and carry `data-action`.
- **Voice prototype:** its only runtime dependencies are React and a self-hosted font. Adding one is a decision for the owner, not a default.
- **Everything is local.** No library may phone home, load from a CDN at runtime, or need an account. The eye-tracking CSP and request guard block it anyway.
- **Pin exact versions** and install with `npm ci --ignore-scripts`, as the prototypes do.

## Where the list can help

- **Dev-only evidence pages,** such as charts of tracker error by screen region from session replay reports. recharts is fine there, and Liveline for a live estimate trace, as long as nothing ships to the person.
- **State shared across styles:** the composer reducer in `shared/composer.ts` already plays zustand's role. Don't add zustand beside it.

Check the `package.json` of the prototype in question; each has its own.
