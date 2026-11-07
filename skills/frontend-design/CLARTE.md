# frontend-design in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core**, for the process and the writing. The visual direction is not open.

## The direction is decided

The skill says: "Where the brief pins down a visual direction, follow it exactly." For the conversation UI, the owner pinned it on 2026-11-07 (`prototypes/UI/v0/BRIEF.md` § Visual direction):

- apple.com neutrals: canvas `#F5F5F7`, surfaces `#FFFFFF`, ink `#1D1D1F`
- Satoshi at 500 and 700
- pastel group faces with group inks
- one accent, `#0071E3`, for dwell progress only
- cards floating in canvas, oversized radii, thin outline icons
- no gradients and no shadows

The mock `prototypes/UI/v0/s0/static.html` (screenshot `reference/11-light-direction-mock-1440x900.png`) is the minimum quality bar. Don't propose a "distinctive" alternative, a new typeface, or a darker or warmer palette. Spend your judgement on proportion, whitespace and finish within that skin.

The voice prototype has its own look (Atkinson Hyperlegible Next, Clarte blue `#2152bf`, 64 px targets). Whether it adopts the UI v0 skin is the owner's call. Raise it; don't do it unasked.

## What to use from the skill

- **Two passes.** Plan tokens, review the plan against the brief, then build. On Clarte the plan states how the screen keeps one action per backend quadrant and where its rest zones are.
- **Restraint.** Spend boldness in one place, which here is usually the message. Remove one accessory before you finish.
- **Self-critique from screenshots** at 1440×900 and 1280×720, side by side with the mock.
- **Writing.** Its guidance matches Clarte's: name things by what people understand; one action keeps one name ("Speak" produces "Speaking"); errors say what is blocked and how to fix it; no "Oops" and no apology. Write for adults; never patronise or infer abilities from a diagnosis.

## What doesn't apply

Heroes, landing pages, display-type headlines, and "aesthetic risk". There is no marketing surface in scope. Onboarding copy and instructional empty states are also out: `minimal-ui` forbids text that explains the UI.
