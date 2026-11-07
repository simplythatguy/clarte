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

For `design-html` work, derive tokens and layout rules from the approved design and inspect the rendered HTML. Read [upstream details](references/upstream-readme.md) for supported checks, annotation examples, policy configuration, and coverage limits. Consult the current installed API if it differs from this pinned reference.
