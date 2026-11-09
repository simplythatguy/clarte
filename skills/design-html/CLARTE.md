# design-html in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.** AGENTS.md names this skill for inline HTML design and design handoffs. Without the runtime there is no designer binary, Slop Gate, design lint or `gstack-render`. Say so, then build the page by hand following the rules below, and verify it with `lintapple-ui` and real screenshots.

## Inputs

- **DESIGN.md equivalent:** `docs/design/s0/DESIGN.md` (tokens and measured contrast) together with `BRIEF.md` § Visual direction and `MOTION.md` tokens. Step 1.4 reads these as the system-level overrides.
- **Approved reference:** `docs/design/s0/static.html` and `docs/design/reference/11-light-direction-mock-1440x900.png`, the owner's minimum quality bar.
- **Content:** real Clarte content only. Partner utterances, the six capabilities, the four letter groups printed in full, saved phrases. Never lorem ipsum, and never a made-up user quote or accuracy figure.

## Overrides

- **Surface classification:** always `Surface: other`. Clarte has no Persuade page in scope. Skip the persuade intake and archetypes.
- **Viewports:** gaze screens at 1440×900 and 1280×720, each at 200% text, not 375/768/1440. The voice prototype adds its narrow widths.
- **Targets:** replace "44px touch target" with the backend quadrant contract on gaze screens (one `data-action` per quadrant, inactive gutters of at least about 50 px at 1440×900, widest on the row boundary) and with 64 px on the voice prototype.
- **Doctrine** (`sections/doctrine.md`) is mostly right, with two exceptions. "Use conventions: logo top-left, persistent nav" gives way to `minimal-ui`: one major thing per screen, no logo, no nav bar, a location label only when it names the view. "When in doubt, apologize" gives way to Clarte's error voice: say what is blocked and how to fix it, without apology.
- **Craft floor motion:** use `MOTION.md` instead of the craft floor's curves and reveal rules. No scroll reveals, no staggers on repeated screens, and nothing moves while armed.
- **Pretext:** use it where text height drives layout: the message, the transcript, captions at 200%, and the longest candidate word. Use it to prove that text reflow never moves a target. The page still marks actions with `data-action` and must pass `validateLayout` in `shared/quadrants.ts`.
- **Refinement loop screenshots** open with `?onboarding=off` and the developer overlay (backquote key) showing zero violations.

## Hand-off

One page per invocation. When the target is a UI v0 style, the hand-off is the HTML plus the token diff for that style's `DESIGN.md`. The style's React build stays the deliverable.
