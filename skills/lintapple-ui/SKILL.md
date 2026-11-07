---
name: lintapple-ui
description: Check an implemented web UI with Lint Apple against the project's design policy, assess findings, and verify fixes. Use after UI implementation or for a rendered-page UI audit.
---

# Check rendered UI with Lint Apple

Source: https://lintapple.vercel.app/ and https://github.com/gholtzap/lintapple.
This is Clarte's integration skill for the Node/browser checker. It requires a rendered web page; it measures the rendered page rather than HTML source or screenshots.

1. Read the project's UI rules, tokens, existing `ui-policy.json`, package scripts, and installed Lint Apple version. Keep deliberate design choices. Match the policy to the actual design; stock defaults are not the product specification. Use the installed version's README/schema for policy fields; do not invent options.
2. Reuse the project's existing runner. For a requested new integration, upstream documents Node.js 22+ and `npm install -D lintapple@0.1.24`, followed by `npx lintapple init`. Use the project's package manager, inspect generated changes, and set the real app URL. Do not initialize or change dependencies for an audit unless requested; an ad hoc run may use `npx --yes lintapple@0.1.24 <url> --config <policy-path> --json` with a temporary project-derived policy. The version was checked against npm when this skill was written; prefer a compatible existing pin over changing it.
3. Make sure the intended page and state loaded. A fresh CLI browser does not inherit authentication, dialogs, or the user's tab. Use an established authenticated Playwright fixture where needed; never export secrets into reports. For async pages use the documented `--ready '<visible-selector>'` option.
4. Run the relevant configured viewports, themes, and interaction states. In an existing Playwright test, upstream supports `import { expectUI } from 'lintapple/playwright'` and `await expectUI(page, testInfo)`. `checkPage` and `expectUI` are passive: open the state first. Check accessible child frames separately with `checkPage(frame)` when applicable.
5. Read the actual findings and coverage, not just the exit status. Exit 0 means the executed checks passed; 1 means findings including unresolved checks; 2 means incomplete execution. Font, contrast, control size, and screen bounds checks need no added markup. Layout checks may require `data-ui-stack`, `data-ui-actions`, `data-ui-container`, `data-ui-content`, alignment/radius markers, or configured selectors. Missing annotations, omitted frames, native controls, and unmeasured content are coverage limits.
6. Confirm each finding against the rendered page and design contract. Fix actual causes when edits are authorized. Correct an incorrect policy rather than changing an intentional design, but never weaken accessibility or add broad exceptions to hide defects. Rerun affected checks after fixes.
7. Personally inspect screenshots and exercise the user flow, keyboard/focus behavior, and changed normal/reduced motion. A linter pass does not establish visual taste, backend success, or full interaction correctness. Report page/state, version, policy, viewports/themes, findings, unresolved coverage, and the inspected evidence.

## Clarte policy

Derive `ui-policy.json` from the surface's spec, not from Lint Apple's stock defaults. [Skills for Clarte](../../docs/skills-for-clarte.md) lists the specs.

- **Gaze screens (`prototypes/UI/v0`):**
  - Viewports: 1440×900 and 1280×720, each also at 200% text. Light theme, plus dark where the style offers it.
  - Text: nothing below 20 px.
  - Contrast: the message at APCA Lc 90 (at least 7:1), labels at Lc 75, and state marks, dwell rings and group marks at 3:1 against what they sit on (`BRIEF.md` § Type and contrast).
  - Control size: the hit region is the backend quadrant, not the drawn tile. Don't fail a tile on a 44 px default. Check that each `data-action` element stays inside one backend quadrant with `shared/quadrants.ts` (`validateLayout`, `check-layout.mjs`), which Lint Apple cannot measure.
  - States: open each phase with `window.clarteDebug.setPhase(name)` and load with `?onboarding=off` before checking.
- **Voice screens (`prototypes/Voice`):** 64 px minimum targets, 20 px body text (`src/styles.css`), and every screen state, including recording, offline service and building.
- **Eye Tracking navigation:** the eight blank named targets must keep their geometry between the preview and confirmed states.

For `design-html` work, derive tokens and layout rules from the approved design and inspect the rendered HTML. Read [upstream details](references/upstream-readme.md) for supported checks, annotation examples, policy configuration, and coverage limits. Consult the current installed API if it differs from this pinned reference.
