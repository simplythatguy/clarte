# Council brief, round 4 (final round): Clarte UI v0, Style 2 · Corners

You are one of two council members reviewing one UI prototype. Your review is **read-only**: do not edit, create or delete any file in the repository, do not run git commands that change anything, write any scratch files only to your own temporary directory, and never message other threads or agents. Report only through your own task output. Do not delegate further.

## Workflow context

Read `/Users/aamia/.codex/skills/t3-workflow/SKILL.md` and its `references/routes.md`, and follow the "Code review" route (`/Users/aamia/.agents/skill-libraries/mattpocock/skills/engineering/code-review/SKILL.md`) plus the UI layer (`/Users/aamia/.codex/skills/t3-workflow/references/ui-quality.md`). Library roots: `/Users/aamia/.agents/skill-libraries/pstack/skills/`, `/Users/aamia/.agents/skill-libraries/mattpocock/skills/`, `/Users/aamia/.agents/skills/`. Apply: `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` (the owner's rules; run "Verify a screen" on the screenshots), `/Users/aamia/clarte/skills/review-animations/SKILL.md` with its `STANDARDS.md` (the review-animations standards), `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md` (its "Verify a screen"), and `/Users/aamia/clarte/skills/better-ui/SKILL.md`. End with a short "Methods used" receipt of the files you actually read.

## What this is

Clarte is an eye-tracking communication aid for people with dysarthria and motor disabilities. A webcam gaze tracker classifies each look into one of eight fixed backend quadrants (2 × 4); the person types with four letter groups, a language model decodes words, and the message is spoken. Five styles are prototyped in parallel; this is style 2. The deliverable is this one style, not a product.

Read, in order (all under `/Users/aamia/clarte/prototypes/UI/v0/`):
1. `README.md` (backend quadrants, letter groups)
2. `BRIEF.md` (non-negotiables, Visual direction, Quality bar, Council: two scores)
3. `MOTION.md` (the motion and craft bar and its ten-point acceptance list)
4. `RESEARCH.md` (evidence; R-n citations)
5. `s2/DESIGN.md` (the style brief, then "Decisions while building": every decision and deviation with its reason, including the changes after round 1)
6. `reference/11-light-direction-mock-1440x900.png` (the owner's minimum visual bar, a mock of this style's compose screen; note the owner's later correction: group cards show their letters, never a range like "A–F")

Source under `s2/`: `src/App.tsx`, `src/model.ts`, `src/gaze.ts` (dwell painter, pointer stream), `src/parts.tsx` (cards, ring, cross-fade), `src/Rest.tsx` (rest zone, word in progress), `src/Calibration.tsx`, `src/readAlong.ts`, `src/earcons.ts`, `src/icons.tsx`, `src/styles.css`; scripts `scripts/walk.mjs` (scripted user path) and `scripts/perf-dwell.mjs` (trace of a dwell). Shared engine (read-only for everyone): `shared/*.ts`.

## Evidence (open and look at the images yourself)

Under `s2/evidence/`:
- `side-by-side-mock.png`: this build's compose screen next to the owner's mock at 1440×900. **Give a verdict: does the build match or beat the mock on whitespace, type scale, radius, colour restraint and finish?**
- Live path at 1440×900, mouse as gaze with noise on: `calib-position.png`, `calib-points.png`, `idle.png`, `menu.png`, `menu-demo.png`, `listening.png`, `menu-with-message.png` (after accepting "was": Q7 is Menu), `delete-reopen.png` (Menu → Other word reopened "was" at "yes"), `compose-words.png`, `speaking.png`, `said.png`, `menu-display-dark.png`, `dark-idle.png`.
- 200% and calibration stills on this build: `text-200-listening-1280.png`, `text-200-menu-1280.png`, `text-200-selection-1280.png`, `calib-points-200-1280.png`, `calib-position-200-1280.png`.
- Stills: `compose-pending.png` (word in progress with ghost letters), `compose-nomatch.png`, `greyscale-compose.png`, `dark-compose.png`, `text-200-*-1280.png` (200% text at 1280×720).
- `layout/`: the shared layout checker's screenshots at 1280×720 for all 17 phases, plus the 1440×900 phases the live path does not cover.
- `demo-loop.webm` (41 s, 720×450, 25 fps): the core loop with mouse as gaze and noise on: a click on the rest zone (browsers need one activation for speech), listen, stop, a cancelled dwell on A–F, T–Z A–F O–S → "was", accept, Menu → Other word → "yes", accept, A–F A–F T–Z A–F O–S → "after", speak with the read-along, Say again. **Scrub it frame by frame against MOTION.md's acceptance list.** If your tools cannot decode webm frames, Playwright's Chromium in `s2/node_modules` can (draw `<video>` frames to a canvas at chosen times).
- `regress.txt`: the regression checks for every round-2 defect.
- `perf-dwell.json` and `perf-baseline.json`: Chrome trace counts over a dwell window and an idle window on the production build (method in `scripts/perf-dwell.mjs`).
- The live app is served at `http://localhost:5102` (dev) and `http://localhost:5122` (production build). `?phase=<name>` opens any phase: idle, listening, compose-pending, compose-nomatch, compose-words, speaking, said, menu, menu-more, menu-display, menu-selection, menu-demo, menu-phrases, calib-position, calib-points, calib-validate, calib-ready.

## Verified by the builder

- `npm run build` and `node ../shared/selftest.ts` pass; the layout check is zero violations in 17 phases at both viewports; Q2 and Q3 hold no enabled action in any phase.
- The walk (mouse as gaze with noise; keys only) completes; no card overflows at 100, 150 or 200% text in any phase at either viewport; no page errors.
- Dwell trace on the production build: 0 layout, 0.42 ms paint (the 150 ms focus step), longest task 1.3 ms; idle: 0 layout, 0 paint.

## Rounds so far and what changed

- Round 1 (before the owner's redo): Opus 7/10, Sol 6/10, both blocked. Fixed then; the visual layer was then redone to the owner's direction.
- Round 2: Opus 7 (design) / 6 (craft), Sol 7 / 6, both blocked. Changes since, each in DESIGN.md "Decisions while building" with "(round 2)":
  - stale "selected" ring after action replacement (cards now clear dwell state when their action changes; the painter clears untracked cards);
  - 200% message never shrank (size declared at `:root`); 200% labels overflowed in Menu at 1280 (labels now enlarge to a card-width cap, then wrap or hyphenate; checked with the real setting by rendered text bounds);
  - failed speech reported as spoken (message restored, red status says what is blocked and how to fix it, error tone after 1 s);
  - stale armed candidate committed raw ids (accept commits only the word shown);
  - microphone transcript duplicated, session end hidden, fallback without recognition undisclosed, "One moment" transcribable (local mic session: cumulative, restarts, pauses, discloses);
  - identity disc hid the last third of the arc; cancel drained as two arcs; accent seams at rest; reduced motion rotated (now opacity steps);
  - rest zone cut on conversation ↔ menu; per-card fades instead of one phase cross-fade; cards dimmed instantly;
  - phrases could not be deleted (Menu Q5 reads "Delete word" for a phrase);
  - calibration captions grew while typing and sat on the guide's path; non-dwell keywords used the accent;
  - dark primary was the brightest card;
  - Lint Apple: letters/candidate size caps, glyph tops clipped at the message box edge, group accessible names vs visible letters, `aria-label` on a plain span.
- Round 3: Opus 7 / 7, Sol 8 / 7, both blocked. Changes since (DESIGN.md "(round 3)"; each has a check in `scripts/regress.mjs`):
  - microphone silence restarted forever and never falls back to the script; only fatal errors do;
  - One moment shares Speak's outcome: holding always released, the microphone always resumes, a blocked or silent attempt says so with the delayed error tone;
  - no mid-word breaks at 200%: each label word is unbreakable and the label size fits its widest word to the card (`FitText`); check: no label word has more than one line box;
  - calibration captions sit in bands no guide path crosses (under the position ring; points at 72vw/35vh; check at top centre), wrap within the screen at 200%; check: every leg of both paths sampled against the caption, both viewports, 100% and 200%;
  - the listening transcript is clipped by whole words, and a tail starts with "…";
  - a latched ring after a commit fades instead of unwinding; the label cross-fade is staggered (out 100 ms, in from 60 ms); a dwelt white card steps to `#E8E8ED`; the stale microphone paragraph in DESIGN.md removed; the always-true regression check replaced.
- Declined, with reasons in DESIGN.md: moving Delete into the Menu while groups are pending (Sol); restructuring the menu so Clear/Phrases are two looks (Opus) — the claim in DESIGN.md is corrected instead.
- `scripts/regress.mjs` now checks each round-2 defect; its output is `evidence/regress.txt`.
- The recording (`demo-loop.webm`, about 41 s, re-recorded on this build) shows a cancelled dwell (about 7–8 s), the menu round trip, Speaking with the read-along and Say again (about 35–39 s).

## What to check

1. The backend quadrant rule in every phase; Q2 and Q3 rest in every state.
2. Every non-negotiable in BRIEF.md, the owner's Visual direction and Quality bar.
3. MOTION.md's ten acceptance points, scrubbed on the recording and checked in code; the review-animations standards.
4. minimal-ui and the Apple HIG "Verify a screen" on the screenshots; better-ui values on the code.
5. The side-by-side verdict against the mock.
6. Correctness bugs in the user path.

Keep scope: no new screens, features or libraries beyond the brief.

## Output

1. **Two scores out of 10**: (a) design and interaction; (b) craft and motion against MOTION.md's acceptance list.
2. The side-by-side verdict (matches / beats / falls short, per criterion).
3. Findings, most severe first: file/line or screenshot/frame time, what is wrong, the smallest fix; mark each defect, brief violation, or polish.
4. Disagreements with the builder's recorded decisions.
5. Satisfied (yes/no) and what would make you satisfied.
6. Methods used.
