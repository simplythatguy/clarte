# Skills for Clarte

The skills in `skills/` were written for general web products: marketing pages, dashboards, phones, mice and touch. Clarte is a communication aid used by eye gaze, by people with dysarthria and motor disabilities, on a laptop webcam. Many generic defaults are wrong here, and some are harmful: a press animation that moves a target under an armed dwell, a toast that disappears on a timer, a hover tooltip nobody can reach by gaze.

Upstream skill files stay exact copies (hash-locked in `sources.lock.json`). Clarte's adaptation of each lives beside it in `skills/<name>/CLARTE.md`. This page is the contract every overlay builds on.

## How to use a skill here

1. Read `skills/<name>/SKILL.md` (upstream, unchanged).
2. Read `skills/<name>/CLARTE.md`. Where it disagrees with the upstream file, the overlay wins.
3. Where either disagrees with this page or the sources it cites, this page wins.

Precedence when rules collide, highest first:

1. The owner's newest explicit decision.
2. The owner's `minimal-ui` rules. They live in the owner's skill library, not in this repository. When they are not available, say so and do not reconstruct them. Repository documents cite them as: one major thing per screen, neutral surfaces with colour spent only on function, no text that explains the UI on routine screens, and a "Verify a screen" pass on real screenshots.
3. The backend quadrant contract: `prototypes/UI/v0/README.md`.
4. The surface's own brief: `prototypes/UI/v0/BRIEF.md` and `MOTION.md` for the gaze UI; `prototypes/Voice/README.md` and `docs/RESEARCH.md` for voice; `prototypes/Eye Tracking/README.md` and `docs/MINIMAL-FLOW.md` for tracking.
5. [apple-hig-ui](../skills/apple-hig-ui/SKILL.md), Apple's guidelines already adapted to Clarte.
6. The skill's `CLARTE.md` overlay.
7. The upstream `SKILL.md`.

## Surfaces and how people use them

| Surface | Where | Input | Who uses it |
| --- | --- | --- | --- |
| Conversation UI (listen, compose, speak) | `prototypes/UI/v0/` (`s0` to `s6`, `shared/`) | gaze classified into backend quadrants, dwell to select, optional blink or key confirm; the mouse and keys 1–8 only simulate gaze | the person with dysarthria, with a partner across the table |
| Eye tracking and calibration | `prototypes/Eye Tracking/` | webcam gaze: a steady look, then blinks to preview and confirm; mouse, touch and keys as alternates | the person; testers recording sessions |
| Making a voice | `prototypes/Voice/` | pointer, touch and keyboard (Space records) | the person or someone helping them; designed for tremor, fatigue and low vision |
| Prediction engines | `prototypes/Word Prediction/v0/`, `prototypes/Autocomplete/v0/` | Python API and plain test pages | developers |

A rule written for one input model does not transfer to another by default. Gaze surfaces have no hover and no press. The voice surface does have both, but it serves hands with tremor.

## The gaze contract

These hold on every gaze surface. Each comes from a document above. Check the source before you rely on the paraphrase.

- **Backend quadrants.** The fixed 2 × 4 grid (Q1–Q8, reading order) never changes. At most one actionable element (`data-action`) per quadrant. An element may span quadrants and then owns them all. Empty quadrants are rest zones. Selection is by quadrant, not by pixel. (README)
- **Nothing happens on its own.** No auto-commit, no auto-speak, no suggestion inserted without a selection, no time limit the person cannot change. Listening never stops on a timer. A late decoder result never commits or speaks. (BRIEF, apple-hig-ui)
- **Stillness.** Nothing moves while a target is armed. No idle motion: no breathing rings, pulsing dots, or caret blinking faster than 1 Hz. Phase changes are one cross-fade in place. Nothing slides across quadrants. Functions keep their quadrant in every state. (BRIEF, MOTION)
- **Constant luminance.** No dimming scrims, flashes or light-to-dark phase changes; pupil change shifts measured gaze by about 2.6°. Dark is an explicit option only. (BRIEF, RESEARCH §4)
- **Feedback on the target, in place.** Intent delay (150 ms groups, 250 ms controls), one static focus cue, a linear dwell arc, commit cue, cancel drain. No gaze cursor by default. Feedback never relies on colour or sound alone. (BRIEF, MOTION)
- **Words.** Verbs that name results (Speak, Delete, Listen). Letter tiles print every letter. No internal identifiers (AC, D, R1, Q6) in the UI or accessible names. No text that explains the UI. (BRIEF, apple-hig-ui)
- **Speech is confirmed** because it cannot be unheard. Reversible selections are not.

## Motion translated

Emil Kowalski's skills grade motion by how often people see it. In Clarte, map the tiers like this:

| Upstream tier | Clarte surfaces | What is allowed |
| --- | --- | --- |
| 100+ a day, or keyboard-triggered | every gaze selection (group, accept, delete), candidate updates, the simulator keys | only the in-place cues in `MOTION.md` (≤150 ms opacity or colour; the dwell arc; the commit cue) |
| Tens a day | Listen, Respond and Speak phase changes, opening Menu, Say again | one 250–400 ms cross-fade in place, exits 150–200 ms |
| Occasional | settings sheets, recalibration, voice build progress | fade in place; nothing slides |
| Rare | calibration complete, a voice ready for the first time | the one bloom, or the calibration sequence in `MOTION.md`; still no luminance change |

Use the tokens in `MOTION.md`. Emil's `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) is the same curve. His `--ease-in-out` (`cubic-bezier(0.77, 0, 0.175, 1)`) is `MOTION.md`'s `--ease-move`, used only by the calibration guide dot. `--ease-drawer` has no use here because nothing slides. The voice prototype keeps its own tokens in `prototypes/Voice/src/styles.css`.

Durations over 300 ms that are deliberate and must not be flagged: dwell progress (600 ms groups, 900 ms controls, linear because it encodes time), the 450 ms commit bloom, phase cross-fades, caption typing, and the calibration guide dot's travel and settle.

## Privacy and evidence

- Everything runs locally. No accounts, uploads, analytics or remote inference. Don't add a dependency or a call that sends data off the machine. The eye-tracking CSP and the voice service's 127.0.0.1 binding and CORS enforce this.
- Face video, eye crops, test sessions, voice recordings, cloned speech and partner transcripts identify people. Never put them in PRs, issues, diagrams, design tools, screenshots for review, or prompts to outside models. Test sessions live in git-ignored `sessions/`, and voices live in `~/.clarte/voices`.
- A voice is made only with the confirmed consent statement it stores. Every clip carries the Perth watermark. Deleting a voice removes its folder.
- Accuracy claims need evidence. A gaze accuracy claim needs recorded sessions replayed through the build (`npm run test:sessions`). Synthetic fixtures prove the plumbing, not accuracy. Voice metrics from synthetic impairment show identity and rate, not intelligibility.
- Never claim "on-device", "private" or an accuracy number that the code and evidence don't support.

## Checks per surface

| Surface | Run |
| --- | --- |
| Skills and provenance | `python3 scripts/validate.py` |
| UI v0 | `node prototypes/UI/v0/shared/selftest.ts`; `node prototypes/UI/v0/shared/check-layout.mjs http://localhost:PORT out-dir` at 1440×900 and 1280×720, zero violations in every phase; preview all styles with `node prototypes/UI/v0/s_all/serve.mjs` |
| Eye Tracking | the Verify list in `prototypes/Eye Tracking/README.md` (`npm test`, `typecheck`, `build`, `check:privacy`, `check:import`, `check:model`, `scripts/fingerprint.mjs --verify`), plus session replay for any tracker change |
| Voice | `npm test && npm run typecheck`; `server/.venv/bin/python -m pytest -q tests`; `scripts/evaluate.py` for similarity, rate and WER |
| Word Prediction, Autocomplete | the run and check steps in their READMEs; Light must work without neural artifacts |

Screenshots are opened and looked at before they are reported. Gaze screens are checked at 1440×900 and 1280×720 and at 200% text, with `?onboarding=off`.

## Open conflicts in the sources

Don't settle these silently. Follow the newer document if you must proceed, and say so.

- Icon and ring stroke: `BRIEF.md` (visual direction) says 1.6 px; `MOTION.md` (the later quality bar) says 1.5 px.
- Letter-tile type: "Letter groups show their letters" in `BRIEF.md` says 28–36 px; its "Type and contrast" paragraph still says 22 px letters under a range label that is no longer shown.
- Skins: the voice prototype (Atkinson Hyperlegible Next, Clarte blue `#2152bf`, 64 px targets) and UI v0 (Satoshi, `#F5F5F7` canvas, accent `#0071E3`) look different. Whether they converge is the owner's call.
- `BRIEF.md` asks for a council from `skills/council`, which is not in this repository; `sol-loop` is the review loop that is.

## The skills

| Skill | Use in Clarte | Status |
| --- | --- | --- |
| [apple-hig-ui](../skills/apple-hig-ui/SKILL.md) | every screen, state, label and colour decision | Clarte-authored, core |
| [lintapple-ui](../skills/lintapple-ui/SKILL.md) | measuring rendered pages against Clarte's policy | Clarte-authored, core |
| [review-animations](../skills/review-animations/CLARTE.md) | required on every UI v0 build; tables go in `REPORT.md` | core |
| [break-ui](../skills/break-ui/CLARTE.md) | required on every UI v0 build; also the voice screens | core |
| [choreograph](../skills/choreograph/CLARTE.md) | casting and timing every event before coding it | core |
| [animate](../skills/animate/CLARTE.md) | building a state change within the motion contract | core |
| [remove-animations](../skills/remove-animations/CLARTE.md) | cutting motion that breaks stillness | core |
| [find-animation-opportunities](../skills/find-animation-opportunities/CLARTE.md) | finding teleporting state, mostly to reject | core |
| [animation-performance](../skills/animation-performance/CLARTE.md) | keeping the dwell arc smooth while the tracker runs | core |
| [improve-animations](../skills/improve-animations/CLARTE.md) | audit and plans for a whole prototype | core |
| [emil-design-eng](../skills/emil-design-eng/CLARTE.md) | craft review in Before/After tables | core |
| [better-ui](../skills/better-ui/CLARTE.md) | surface and icon polish, values filtered by Clarte | core |
| [frontend-design](../skills/frontend-design/CLARTE.md) | process and writing; the visual direction is already decided | core |
| [prototype](../skills/prototype/CLARTE.md) | divergent layout variants behind a picker | core |
| [pr](../skills/pr/CLARTE.md) | PR bodies in Clarte's vocabulary, with privacy-safe evidence | core |
| [sol-loop](../skills/sol-loop/CLARTE.md) | outside review before a PR | core |
| [apple-design](../skills/apple-design/CLARTE.md) | principles, type and reduced motion; not its gesture physics | occasional |
| [animation-vocabulary](../skills/animation-vocabulary/CLARTE.md) | naming an effect, plus Clarte's motion terms | occasional |
| [untangle-codebase](../skills/untangle-codebase/CLARTE.md) | one prototype at a time, with protected areas | occasional |
| [pick-ui-library](../skills/pick-ui-library/CLARTE.md) | mostly to say no; dev pages and the voice app only | occasional |
| [setup-matt-pocock-skills](../skills/setup-matt-pocock-skills/CLARTE.md) | not run yet; answers prepared | occasional |
| [teach](../skills/teach/CLARTE.md) | learning a topic over several sessions, in a workspace outside the repository | occasional, only when asked |
| [design-html](../skills/design-html/CLARTE.md) | inline HTML design and handoffs | needs the gstack runtime |
| [diagram](../skills/diagram/CLARTE.md) | Clarte's standard diagrams | needs the gstack runtime |
| [office-hours](../skills/office-hours/CLARTE.md) | problem framing before a new capability | needs the gstack runtime |
| [autoplan](../skills/autoplan/CLARTE.md) | the full review pipeline | needs the gstack runtime |
| [plan-ceo-review](../skills/plan-ceo-review/CLARTE.md) | scope and failure modes | needs the gstack runtime |
| [plan-eng-review](../skills/plan-eng-review/CLARTE.md) | architecture, tests, privacy invariants | needs the gstack runtime |
| [plan-design-review](../skills/plan-design-review/CLARTE.md) | gaze states, journeys, accessibility | needs the gstack runtime |
| [plan-devex-review](../skills/plan-devex-review/CLARTE.md) | the engines' APIs, the voice service, run instructions | needs the gstack runtime |
| [mobile-native](../skills/mobile-native/CLARTE.md) | only if a surface moves to a phone | not in use |
| [ask-sonner](../skills/ask-sonner/CLARTE.md) | toasts conflict with the gaze contract | not in use |
| [animate-expo](../skills/animate-expo/CLARTE.md) | no React Native app | not in use |
| [write-swift](../skills/write-swift/CLARTE.md) | no Swift code | not in use |

The gstack skills need the full pinned runtime (see `docs/dependencies.md`). Check for `~/.claude/skills/gstack` before you use them. Without it, apply the principles in the overlay by hand, and say that the skill itself did not run.
