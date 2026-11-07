# Style 2 · Corners: report

## What was built

A Vite + React 19 + TypeScript app in `prototypes/UI/v0/s2/`, importing the shared engine from `../shared/*.ts` unchanged. Plain CSS with tokens in `:root`, inline SVG icons, Satoshi from Fontshare. The owner's light direction (BRIEF "Visual direction", "Quality bar") is applied, built to MOTION.md.

- **Layout.** The letter groups own the four corners (A–F Q1, G–N Q4, O–S Q5, T–Z Q8). The conversation rests in Q2 + Q3, which hold no action in any state. Q6 is the primary: an ink card whose function changes with context (Listen, Stop, the candidate word, Speak, Say again). Q7 is Delete while letter groups are pending, One moment while listening, and Menu otherwise.
- **Full loop.**
  - Listening uses the browser's speech recognition when available. A fatal error or no recognition switches to a disclosed scripted partner.
  - Typing with the four corner groups shows the word in progress: typed glyphs in group ink plus ghost letters.
  - The candidate is accepted in Q6.
  - Other word, reached through Menu → Other word, reopens the last word at its next candidate.
  - Speak has a read-along driven by the speech engine's word boundaries, followed by Say again. A blocked speech attempt keeps the message and explains why.
  - One moment.
  - The Menu has five pages (Menu, More, Display, Selection, Demo) plus Phrases, with every setting in the brief: two dwell times, text size to 200%, theme (light, or an APCA-matched dark), sound, selection mode, word colours, gaze noise, repeat mode, partner source and the developer grid. Recalibrate and Clear are also in the Menu.
- **Calibration and first run.** Built to MOTION.md step by step and skippable with Escape: position ring, nine points with a travelling guide and the dwell arc, four check points, Ready.
- **Partner-visible state.** An 8 px band (none in Ready; red while listening, ink while writing a reply, magenta while speaking) plus the state in words. Earcons are synthesised with Web Audio: click, control, delete, phase, and an error tone delayed by 1 s.
- **Developer surface.** `window.clarteDebug = { phases, phase(), setPhase(name), validate(), engine }` with 17 phases. `?phase=<name>` opens a phase directly. The developer overlay is mounted in development and toggled with the backquote key.
- **Access.** Keyboard: digits 1–8, Space/Enter, Escape. Focus is visible (a 3 px ink outline), every control has an accessible name, and `prefers-reduced-motion` gives opacity-only motion. Text scales to 200% without overlap.

Run it:

```sh
cd prototypes/UI/v0/s2
npm install
npm run dev          # http://localhost:5102 (strict port)
npm run build        # type-check and production build
node ../shared/selftest.ts
node ../shared/check-layout.mjs http://localhost:5102 evidence/layout
node scripts/walk.mjs http://localhost:5102 evidence      # live path, stills, demo video, Q2/Q3 rest check
node scripts/regress.mjs http://localhost:5102            # every council-found defect
npx vite preview --port 5122 & node scripts/perf-dwell.mjs http://localhost:5122   # trace of a dwell
```

## Decisions beyond DESIGN.md's original text

All of them are recorded with reasons in DESIGN.md "Decisions while building". The main ones:

- **Centred cards.** The mock anchors its labels to the corners; this build centres them, because "label centred" is a brief non-negotiable (R-6 §3.7). The group letters are the only text on a group card. The two overlapping circles sit beneath them: an identity disc whose dice pips count 1–4, and the dwell ring.
- **Dwell indicator.** The arc is composited (rotating half-rings) rather than painted. It drains as one arc, blooms on commit, and goes solid while gaze stays. Reduced motion uses opacity steps.
- **Selection safety.**
  - No chaining into a new occupant of the same quadrant.
  - Re-dwell repeats letter groups only.
  - No no-op clicks.
  - Accept takes only the word shown.
  - Leaving the window cancels a dwell.
- **Q7 is Menu when nothing is pending.** The first Menu page holds Recalibrate, One moment, Other word and Listen.
- **Colour.** Listening is red rather than green, because G3's mint was too close. The dark theme uses deep group tints and a mid-grey primary, because it exists for light sensitivity.
- **Shared-engine workarounds, kept local** (proposals below): a 30 Hz pointer stream, a local microphone session, and speech with boundaries and an error outcome.

## Evidence

All in `evidence/`, about 3.7 MB. I opened and inspected each file listed below; the video was inspected frame by frame.

| File | Shows |
| --- | --- |
| `side-by-side-mock.png` | This build's compose screen next to the owner's mock (reference/11) at 1440×900. |
| `calib-position.png`, `calib-points.png` | First run: the position ring with its typed caption pill; nine 30% outlines, the guide, the active ring filling. |
| `idle.png` | Ready: no band, Listen in Q6, Menu in Q7, the four letter cards. |
| `menu.png`, `menu-demo.png` | Menu page 1 and the Demo page (gaze noise on, partner Script) reached by gaze. |
| `listening.png` | Red band, "Listening to the script", the partner's words large, groups quiet, Stop and One moment. |
| `menu-with-message.png` | After accepting "was" with nothing pending, Q7 is Menu; Menu page 1 with Other word enabled. |
| `delete-reopen.png` | Menu → Other word reopened "was" at its next candidate: "Yes" in group inks, Q6 offers "yes". |
| `compose-pending.png` | The word in progress, "Yes **outs**ide": typed glyphs in group ink, ghost letters in tertiary; Q6 offers "outside". |
| `compose-nomatch.png` | No candidate: one dot per typed group; Q6 "No word", disabled. |
| `compose-words.png` | "Yes after lunch please", Speak in Q6, Menu in Q7, ink band. |
| `speaking.png` | Magenta band, "Speaking", the read-along underline on the current word, groups quiet, Stop. |
| `said.png` | After speaking: Say again in Q6, the sentence kept on screen. |
| `menu-display-dark.png`, `dark-idle.png`, `dark-compose.png` | The dark theme reached by gaze through the Menu: deep group tints, mid-grey primary. |
| `greyscale-compose.png` | `filter: grayscale(1)`: the groups read by letters and pip count, Z order intact. |
| `text-200-listening-1280.png`, `text-200-menu-1280.png`, `text-200-selection-1280.png` | 200% text at 1280×720 with the real setting: letters wrap 4 + 4; the transcript is clipped by whole words with a leading "…"; labels share one size and never break inside a word. |
| `calib-position-200-1280.png`, `calib-points-200-1280.png` | Calibration captions at 200%: whole pills, on screen, clear of every guide path. |
| `layout/` | The shared checker's screenshot for all 17 phases at 1280×720, and the 1440×900 phases the live path does not already show. |
| `demo-loop.webm` | 41 s, 720×450, mouse as gaze with noise on, final build, in this order: a click on the rest zone (one activation, so speech is allowed), listen, stop, a cancelled dwell on A–F (the arc drains as one arc, about 9.8 s), T–Z A–F O–S → "was", accept, Menu (commit cue and bloom survive the change to More, 18.0–18.3 s) → Other word → "yes", accept, A–F A–F T–Z A–F O–S → "after", accept, Speak with the read-along, Say again. |
| `perf-dwell.json`, `perf-baseline.json` | Chrome trace on the production build. During a dwell: 0 layout, 0.47 ms of paint (the 150 ms focus step; with the arc hidden it is the same, so the arc is compositor work), longest task 1.3 ms, 46 frames in 764 ms. Idle: 0 layout, 0 paint. |
| `regress.txt` | 27 regression checks, one or more for every council-found defect from rounds 1–4, all passing. |

T3 preview: the walk was run live in the T3 browser with hover as gaze (listen, stop, gaze typing with noise, accept, the freeze rule on Q6, speak). Two of its recordings timed out when the browser host disconnected. One T3 recording survives: `/Users/aamia/.t3/userdata/attachments/mcp-launch-fd79ff5558ba2b5cdf8c9375d04156a9a5c698a802a165da55ffb6aec37686bd-20e05e0c-ce1d-4838-b25c-6c256d019ef6-mp4.mp4`. It is of the pre-redo build and its sequence runs one step out because of the no-repeat latch, so it is not the demo. The demo above was recorded with the project's Playwright.

## Layout check

`node ../shared/check-layout.mjs http://localhost:5102 evidence/layout`: 34 of 34 ok.

```
ok   1440x900 idle: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 listening: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 compose-pending: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 compose-nomatch: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 compose-words: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 speaking: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 said: 6 actions [G1, G2, G3, primary, second, G4]
ok   1440x900 menu: 6 actions [recalibrate, one-moment, other-word, done, next, listen]
ok   1440x900 menu-more: 4 actions [phrases, clear, done, next]
ok   1440x900 menu-display: 6 actions [text-size, theme, sound, done, next, word-colours]
ok   1440x900 menu-selection: 6 actions [letter-dwell, control-dwell, selection, done, next, repeat]
ok   1440x900 menu-demo: 5 actions [noise, partner, grid, done, next]
ok   1440x900 menu-phrases: 6 actions [phrase-0, phrase-1, phrase-2, done, next, phrase-3]
ok   1440x900 calib-position / calib-points / calib-validate: 0 actions
ok   1440x900 calib-ready: 2 actions [start, again]
… the same 17 phases at 1280x720, all ok
layout ok in every phase
```

The checker lists every rendered `[data-action]`, including disabled ones. The engine excludes disabled cards, so in listening and speaking the groups are rest zones too. `scripts/walk.mjs` separately confirms that **Q2 and Q3 hold no enabled action in all 17 phases**.

## Checks run on my own build

### minimal-ui "Verify a screen" (all screenshots, both viewports, 200%)

- **Major thing:** one per state. Compose: the message. Listening: the partner's words. Speaking: the sentence. Menu: its cards under one title.
- **Text:** nothing sits above a title and no text explains the UI. The status line is state, not instruction. "No word" and the blocked-speech line are blocked reasons, which minimal-ui allows.
- **Colour:** used only for the groups, the state, the dwell accent and errors.
- **Surfaces:** cards only, with no box inside a box. I removed a resting outlined circle in an early pass because it was a box inside a box.
- **Squint test:** the eye goes first to the message, then to the ink primary.
- **Capability:** see "Open questions" for the pending-groups gap.

### Apple HIG "Verify a screen"

- **Targets:** rounded, label centred, in fixed positions.
- **Card states:** targeting, progress, commit, latched, disabled and held each look different in place.
- **Errors:** a blocked action says what is blocked and how to fix it.
- **Accessible names:** current, and containing the visible label.
- **Speech:** nothing commits or speaks on its own.
- **Exceptions:** see "Open questions".

### better-ui "Before you finish"

No `transition: all`. No keyframe animation on toggled state: the dwell arc and drain are transitions, and the bloom is a one-shot WAAPI animation. No hover styles, no press scale (nothing moves while armed: research wins), and no `will-change` beyond the arc halves and the bloom. Icons use `currentColor` at 1.6 px. Theme switches suppress transitions.

### review-animations, on my build

| Before | After | Why |
| --- | --- | --- |
| Arc via `stroke-dashoffset` on a registered property transition (main-thread paint every frame) | Two half-rings rotating inside overflow-clipped halves (`transform` only) | GPU-only properties; trace shows no paint for the arc |
| `rotate` property plus `transform` on the halves, `opacity: 0` parent at animation start | One `transform` per half, parent always visible | The transitions failed to composite (trace `compositeFailed`) |
| Both halves drained together | Second half first, then the first (75 + 75 ms, `--ease-out`) | A cancel should read as one arc returning, not two segments |
| Cross-fade added `xf-in` to existing layers on any re-render | Only layers created by a change animate | Every label replayed its fade on the first gaze move |
| Rest zone swapped instantly on conversation ↔ menu; per-card 150 ms fades | One phase cross-fade: out 150 ms, in 300 ms from 100 ms | MOTION acceptance 5 |
| Disabled cards dimmed instantly | `opacity` over 300 ms, `--ease-state` | MOTION: tiles quiet or wake over 300 ms |
| Reduced motion still rotated the arc | Four opacity steps on a stationary ring; opacity-only cancel | Reduced motion keeps information, not movement |
| `new AudioContext()` on the frame of the first commit (95 ms task) | Created during idle at startup | The bloom dropped frames on first use |
| Motion on keyboard-triggered selections | `html[data-instant]` zeroes durations for keyboard input | Never animate keyboard-initiated actions |
| A latched ring unwound when gaze left after a commit | Fades to the track over 150 ms | Unwinding reads as "cancelled", the wrong signal after a success (MOTION "Re-arm") |
| Label cross-fade: both labels legible at once ("SaStopain") | Out 100 ms; in from 60 ms | Swap labels without a double image |
| Bloom inside the label layer, unmounted by a screen change | Drawn on the card itself and removed when finished | The one celebration must survive the selections that matter most |

Verdict: **Approve.** Remaining motion over 300 ms is deliberate: the 450 ms bloom (MOTION's one celebration, on its own layer) and the calibration guide's 1200 ms pursuit (the brief's pace).

### break-ui, on my build (worst case entered through the app's own controls)

| # | Severity | Field | Worst case | What happened | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Broken (fixed) | word in progress | 12 typed groups with no candidate ("conversation" is not in the stand-in vocabulary) | The dot row ran off the rest zone's right edge (`nowrap`) | `overflow-wrap: anywhere` on the word in progress |
| 2 | Ugly (fixed) | message | five saved phrases | A phrase is one span across lines; the whole-line clipper hid its visible half, leaving a hole | Phrases render one span per word |
| 3 | Ugly (fixed) | control labels at 200% | "One moment", "Recalibrate" at 1280×720 | A third line ran out of the card, then words broke without hyphens | Words are unbreakable; the label fits its widest word; same-role labels share one size |
| 4 | Broken (fixed, round 4) | accepted word at 200% | "uncomfortable" | Ran 134 px past the message box | The message fit also checks width |
| 5 | Fragile (open) | partner transcript | a very long turn | Shows its last lines only (by design: the end of a turn usually carries the question) | Full transcript is a product decision |

Held up: an empty partner (no rule drawn), single-letter typing, no candidate, 200% in every phase, the dark theme, greyscale.

### Lint Apple 0.1.24 (ad hoc, project-derived policy: Satoshi; sizes 20, 22, 26, 32, 36, 40, 44, 52; 50 px control gap; 1440×900 and 1280×720)

The final run on the final build has 0 failed findings in compose-pending, menu and said (and, in the previous build's run, in listening, menu-display and compose-nomatch). One reasoned exception: the letter rows are 30.5 px at 1280×720, because eight letters must fit one row of a 256 px card; this is inside the brief's 28–36 px. Text contrast where layers overlap could not be measured automatically, so I measured it by hand:

- group ink on face: 5.6–6.5:1
- ink on canvas: 15.5:1
- secondary on canvas: 4.7:1
- accent on faces: 3.8–4.1:1, on white 4.7:1, on ink 3.6:1
- listening red: 4.9:1; speaking magenta: 5.3:1

## Council

Members as the user named them: Claude Opus 5.5 at effort high, and GPT-6.1 Sol at reasoningEffort max with serviceTier priority. Each round was a fresh, read-only `delegate_task` with the brief in `COUNCIL-BRIEF.md`.

| Delegate | Round 1 (pre-redo) | Round 2 (design / craft) | Round 3 (design / craft) |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 7/10 | 7 / 6 | 7 / 7 |
| GPT-6.1 Sol | 6/10 | 7 / 6 | 8 / 7 |

| Delegate | Round 4 (design / craft) | Satisfied after round 4 |
| --- | --- | --- |
| Claude Opus 5.5 | 8 / 7 | No, "close": satisfied once the commit cue survives a screen change and Space acts on the label shown |
| GPT-6.1 Sol | 8 / 8 | No: satisfied once the message fit is width-aware and the dwelt primary keeps the arc at 3:1 |

Rounds: 4, the brief's maximum. Neither member was satisfied after round 4. Their remaining blocking findings, and every smaller finding I agreed with, were fixed in a final pass after round 4. Each is verified by a check in `scripts/regress.mjs` (`evidence/regress.txt`) and by a frame scrub of the re-recorded demo. Those fixes have **not** been re-reviewed by the council, because the brief caps the council at four rounds.

Side-by-side verdict against the mock:

- **Round 2:** both members found the build matched the mock on whitespace, type scale, radius and colour restraint, and fell short on finish. Opus cited the stale ring, the accent seams and the disc covering the arc. Sol cited false selection cues and incomplete phase choreography.
- **Round 3:** both members found it matched on every criterion. Opus said it matched but did not beat the mock on finish, because the mock's corner-anchored labels have more presence.
- **Round 4:** Sol: matches on all five criteria. Opus: matches on whitespace, type scale, radius and finish, and **beats** the mock on colour restraint (no accent anywhere at rest; the mock shows a blue ring at rest on G–N, plus "Accept" and "Last group" captions).
- **My verdict:** matches the mock on whitespace, type scale (allowing for the owner's letters-only correction), radius and finish, and beats it on colour restraint. It does not beat the mock on typographic presence on the group cards: the 36 px letter row is the brief's ceiling, against the mock's 64 px range label, which the owner later ruled out.

**After round 1** (both blocked):

- unresolved decodes committed raw ids
- Q7 became Menu when nothing is pending, with the first Menu page rebuilt
- re-dwell limited to letter groups
- no-op selections give no cue
- leaving the window cancels a dwell
- the microphone no longer falls back silently
- the read-along follows the speech engine
- the Ready band differs from the composing band
- smaller ring
- uncapped labels
- contrast re-measured on the real surfaces

Then the owner's direction replaced the visual layer entirely: skin, letters on cards, word in progress, MOTION.md choreography and calibration.

**During the redo, found by my own checks:**

- the arc repainted every frame (rebuilt as composited half-rings)
- a 95 ms AudioContext stall on the first commit
- label fades replayed on the first re-render
- the whole-line clipper hid glyphs that overhang a tight line box
- selection chaining into the next occupant of a quadrant (found in the T3 recording)
- a solid ring left under a changed label

**After round 2** (both blocked; full list in COUNCIL-BRIEF.md and DESIGN.md "(round 2)"):

- stale selected ring after an action change
- the message never shrank at 200%, and labels overflowed at 200%
- failed speech reported as spoken
- a stale armed candidate could commit ids
- microphone duplication, hidden session end, undisclosed fallback, and "One moment" transcribed as the partner
- disc covering the arc; two-arc drain; accent seams; reduced-motion rotation
- rest-zone cut, missing phase cross-fade, instant dimming
- phrases could not be deleted
- calibration caption growth, placement and colour
- the dark primary was the brightest card
- Lint Apple items

Declined, with reasons:

- **Moving Delete into the Menu while groups are pending** (Sol, round 2). Deleting a mistyped group is the most frequent repair, and doubling its cost to reach rare functions mid-word is the wrong trade. Recorded below as a non-negotiable not fully met.
- **Restructuring the Menu so Clear and Phrases are two looks** (Opus, round 2). I corrected the claim in DESIGN.md instead.

**After round 3** (both blocked; each has a regression check):

- microphone silence fell back to the script after a while; now only fatal errors do
- One moment bypassed the failed-speech handling; it now shares Speak's outcome and always releases
- mid-word breaks at 200% (`FitText`)
- calibration captions crossed the guide's path and clipped at 200%; they now sit in bands that are checked leg by leg
- fragments of clipped transcript lines; the transcript is now clipped by whole words with a leading "…"
- a latched ring unwound like a cancel; it now fades
- "SaStopain" during the label cross-fade; the fade is now staggered
- a dwelt white card vanished into the canvas
- an always-true regression check

**After round 4** (final pass, not re-reviewed):

- the commit cue and bloom are drawn on the card itself, so they survive a screen change (verified in the demo at 18.00–18.32 s)
- only digit keys are direct input; Space confirms the label shown
- "Delete word" after a reopen
- control labels on one screen share one size
- the disabled "No word" stays readable (60%)
- the message fit is width-aware (a 13-letter word at 200% now fits at both viewports)
- the dwelt primary keeps the accent at 3:1 or better (3.05 light, 3.03 dark)
- setting cards drop the dot that read like a radio button

## Open questions and what the brief asks that this style does not fully satisfy

1. **Capability while letter groups are pending.** Q7 is Delete, so Recalibrate, One moment and settings need the pending groups deleted first. That breaks "within two selections" mid-word. Kept deliberately (see Council); the team should test the trade with users.
2. **Menu depth.** Clear and Phrases take three looks, and changing a setting takes four. The six capabilities themselves are within two.
3. **Speech in a browser needs one user activation.** A gaze-only person needs one click from a helper; the app says so when it happens. An installed product would not have this limit.
4. **Pastel faces are 1.06–1.13:1 against the canvas** (the brief's known limit). The extent of a card is found by hue; the dwelt card's ring and face step carry the focus. My choice is recorded in DESIGN.md.
5. **The brief's numbers versus measurement.** Group ink on the canvas measures 5.9–7.4:1, not "above 7:1" for every group.
6. **Calibration runs about 45 s.** MOTION.md says about 40 and the brief about 30; the brief's pace (1200 ms move, 1800 ms settle × 9) alone is 27 s.
7. **Spell** is designed in DESIGN.md, not built.
8. **The Say-again window** is a fixed 6 s (from the brief). Listen stays reachable through the Menu during it.
9. **200% Menu at 1280×720 stays at 40 px.** Same-role labels share one size, and "Recalibrate" (the brief's word) is the widest; it reaches 47 px at 1440×900. Renaming it to "Calibrate" would let the Menu enlarge further.
10. **MOTION acceptance not fully verified:** point 4's audible click synchronisation (the recordings have no audio track) and point 10's ten-loop real-time viewing were not independently established by the council.
11. **Not verified on hardware:** a real webcam tracker, a real microphone with real speech, and human gaze usability. Microphone behaviour was tested with a simulated recognition source.

### Proposals for `shared/` (not edited)

- `gaze.ts attachPointer`: stream the last pointer position at a fixed rate, and stream empty samples after `pointerleave`. Without this, a still mouse goes stale at 600 ms and no dwell longer than that completes, and leaving the window does not cancel promptly.
- `gaze.ts`: a per-quadrant re-arm. After a selection, hold the quadrant until gaze leaves, even if a different action now occupies it, so screen changes cannot chain selections.
- `gaze.ts`: per-action dwell times and repeat rules, instead of one `dwellMs` that styles retune on the fly.
- `speech.ts speak`: word-boundary callbacks and an outcome that distinguishes "spoken" from "blocked".
- `speech.ts listen`: tell a final result from session end, report errors, restart on end, and support pause.
- `composer.ts accept`: refuse when no candidate exists, rather than committing `G4·G4·G4`.

## Methods used

Read and applied, with absolute paths:

- **Workflow:** `/Users/aamia/.codex/skills/t3-workflow/SKILL.md`; `references/routes.md` (the "Feature or substantive implementation" route); `references/ui-quality.md`; `references/visual-evidence.md`; `references/orchestration.md`. pstack: `/Users/aamia/.agents/skill-libraries/pstack/skills/poteto-mode/playbooks/feature.md`. Matt Pocock: `/Users/aamia/.agents/skill-libraries/mattpocock/skills/engineering/code-review/SKILL.md`, as the reviewers' route in the council briefs.
- **The owner's rules:** `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` ("Verify a screen", run above).
- **Repository design skills:**
  - `/Users/aamia/clarte/skills/frontend-design/SKILL.md`
  - `/Users/aamia/clarte/skills/better-ui/SKILL.md` with `animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md`, `performance.md`
  - `/Users/aamia/clarte/skills/lintapple-ui/SKILL.md` (ad hoc run above)
  - `/Users/aamia/clarte/skills/design-html/sections/doctrine.md`, `craft.md`
  - `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md` ("Verify a screen")
  - `/Users/aamia/clarte/skills/review-animations/SKILL.md` with `STANDARDS.md` (table above)
  - `/Users/aamia/clarte/skills/choreograph/SKILL.md` (phase timing; one entrance per container)
  - `/Users/aamia/clarte/skills/animation-performance/SKILL.md` (the trace method, the composite-only arc, the AudioContext stall)
  - `/Users/aamia/clarte/skills/emil-design-eng/SKILL.md`
  - `/Users/aamia/clarte/skills/apple-design/SKILL.md`
  - `/Users/aamia/clarte/skills/break-ui/SKILL.md` (table above; `CATALOG.md` skimmed)
  - `/Users/aamia/clarte/skills/find-animation-opportunities/SKILL.md`, `/Users/aamia/clarte/skills/remove-animations/SKILL.md`, `/Users/aamia/clarte/skills/animation-vocabulary/SKILL.md`
- **Council:** `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/council/SKILL.md`.
- **Project:** `/Users/aamia/clarte/AGENTS.md`; `prototypes/UI/v0/README.md`, `BRIEF.md`, `MOTION.md`, `RESEARCH.md` with `research/lane6-motion-feedback-ux.md` §3; `s2/DESIGN.md`; `reference/` (every image and the calibration frames; `light-direction/CLARTE-LIGHT-DIRECTION.md` and `clarte-light.html`, rendered).
- **Not available:** the gstack design runtime (not installed, not attempted). The T3 preview browser host disconnected several times; evidence capture fell back to the project's Playwright, as stated above. The t3-workflow maintenance check reported local drift; I left it unchanged.
