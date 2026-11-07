# Style 3 · Stages: report

One screen per phase of the conversation: Listen, Compose, Speak (with Speaking), Spoken, Menu and Spell, plus the first-run calibration. Each screen has the fewest and largest targets it needs and a real rest zone; moving between screens is the mode. Built twice: a first visual layer (warm paper, Atkinson) that went through council round 1, then a full redo of the visual and motion layer on the owner's shared light skin and MOTION.md, keeping the stage machine, quadrant map and interaction decisions.

## Run it

```sh
cd prototypes/UI/v0/s3
npm install
npm run dev          # http://localhost:5103 (strict port)
```

- First run opens calibration; Escape skips it. Keys 1–8 select the action in Q1–Q8, Space/Enter confirms a preview or presses the focused tile, Escape cancels a dwell, the backquote key toggles the shared developer overlay. The mouse held still is a steady look.
- `?phase=<name>` opens any screen (`window.clarteDebug.phases` lists them); `?partner=script` uses the scripted partner instead of the microphone; `?data=worst` swaps in worst-case content (break-ui).
- Checks: `node ../shared/selftest.ts`, `npm run build`, `node ../shared/check-layout.mjs http://localhost:5103 <dir>`, and the scripts in `scripts/`: `walk.mjs` (the user path, 41 checks), `demo.mjs` (recording plus a frame-by-frame transition trace), `frames.mjs` (contact sheets from the recording), `luminance.mjs`, `perf.mjs` (trace of one dwell), `motion.mjs` (calibration, cancel, ten letters, reduced motion, slow reduced recalibration), `loops.mjs` (ten compose loops), `compare.mjs` (side by side with the mock), `worst.mjs` (break-ui sweep).

## What was built

- The stage machine in `src/model.ts` (one tile table per stage; the renderer, keyboard map and layout check all read it) and `src/App.tsx` (selection logic, engine wiring, listening, speaking, the lockout and the fresh-look guard, the layered cross-fade).
- `src/Screen.tsx`: one layer per screen (rest zone plus tiles); `src/arc.ts` and `src/dwell.ts`: the compositor-only dwell ring; `src/Calibration.tsx`: the MOTION calibration sequence; `src/listen.ts` and `src/voice.ts`: listening that keeps listening, speech with word boundaries and honest failure, earcons; `src/icons.tsx`; `src/debug.ts`: fixtures for every screen and the worst case; `src/styles.css`: tokens and everything visual.
- All six capabilities: Listen/Respond (Q1 Listen, Done listening), Autocomplete (Q1 candidate), Delete with reopen (Q4), Speak with word highlighting then Say again in the same slot, One moment (Speak Q1 and Menu root Q1), Menu (settings for both dwell speeds, select-by mode, letter repeat, gaze noise, text size to 200%, theme, sound, word colours, partner source; recalibrate; clear; three saved phrases; Spell, implemented).
- The shared engine is imported unchanged. Two local adapters work around it (proposals below).

## Decisions beyond DESIGN.md's original text

All are written into DESIGN.md: D1–D21 from the first build (those about layout and interaction still hold) and R1–R16 for the redo. The ones most worth a reviewer's attention:

- **R3 centred composition.** The mock puts the motif top-left and the label bottom-left; the brief's hit-region rule asks for a centred label and the progress cue centred on the tile, so cards stack mark then label on the centre line.
- **R6/R15 compositor arc.** The arc is two rotating half-ring blades driven by the Web Animations API, so it draws without layout or paint, drains by playing backwards, and completes with `finish()`.
- **R7 nothing relabels under a look**, **R8 a true opacity cross-fade (both layers 300 ms from the same frame) with the outgoing element kept**, **R9 one ink primary per screen** (Back on Menu, Stop while speaking) so mean luminance stays within 5.9% across every screen (Spell's letters page is the exception: no ink card; its 5% step cross-fades).
- **D4 fresh-look guard**: after a look-driven stage change, every quadrant of the deciding tile stays inert until gaze has left for 200 ms. With noise on, 0 stray groups in 3 trials.
- **D3 Speak/Spoken share one layout** (Q1 forward or One moment, Q2–Q3 sentence, Q4 Menu, Q5 back to Compose, Q7–Q8 the voice).
- **D12 listening**: the microphone keeps listening (restarts after Chrome's silence timeout) and never invents words; Script is an explicit setting.

## Evidence

All media below were opened and inspected. Captured with Playwright (Chromium 1248) at 1440 × 900 unless named otherwise, because the T3 preview browser's screenshot and recording tools timed out in this session (four snapshot attempts, including on example.com, and two recording attempts; the preview host dropped in between). The T3 preview tab was closed.

| File | Shows |
| --- | --- |
| `evidence/compare-compose-vs-mock.png` | Compose next to the light-direction mock at 1440 × 900 (verdict below) |
| `evidence/walk-01-calibration-points.png` | Calibration, nine points, first target done, caption "Follow the dot." |
| `evidence/walk-02-listen-transcript.png` | Listen with the scripted partner's words, red band, Done card |
| `evidence/walk-03-compose-pending.png` | Compose with the word in progress "Was" in group inks, candidate on Q1 |
| `evidence/walk-04-compose-decoded-crossfade.png` | After accepting "Yes": the ring solid on Q1 while the look stays, label cross-fading to Done |
| `evidence/walk-06-speak.png`, `walk-07-speaking.png`, `walk-08-spoken.png` | Speak; Speaking with the current word underlined and the rest in tertiary; Spoken |
| `evidence/walk-09-menu.png` | Menu root, Back as the ink primary |
| `evidence/walk-11-compose-200pct.png`, `walk-13-1280-200pct-tokens.png` | 200% text at 1440 × 900 and 1280 × 720 |
| `evidence/walk-12-speech-failed.png` | A speech failure shown in the rest zone, Speak still there to retry |
| `evidence/dark-compose-pending.png` | The optional dark theme |
| `evidence/layout/*.png` | Every screen at 1440 × 900 from the layout check, four at 1280 × 720 (the rest deleted to keep the folder near 3 MB; all passed) |
| `evidence/worst/*.png` | break-ui worst case at both viewports and 200% |
| `evidence/demo-loop.webm` | 32 s recording, mouse as gaze: Compose → Listen (transition 1), partner speaks, Done → Compose (transition 2), type "yes" by gaze, accept "Was", Delete reopens at "Yes", accept, Done → Speak (transition 3), Speak, Spoken |
| `evidence/demo-contact-sheet.png` | 16 frames across the recording |
| `evidence/demo-scrub-transition.png` | Frames every 30 ms through transition 1 (the slow-motion scrub): one cross-fade in place, the band turns red first |
| `evidence/demo-transition.txt` | Per-frame opacity of both layers through transition 1; transform/translate/scale none on layers, tiles and text; tile boxes constant |
| `evidence/flash.txt` | Mean luminance on every painted frame through three gaze-driven stage changes (screencast) |
| `evidence/motion.webm` | 141 s recording at real speed (segment times in `motion.txt`): the whole first-run calibration (position, nine points, check, Ready, Start by gaze); a dwell cancelled at half, then completed; ten letters in a row; a cancel and a commit under reduced motion; then, under reduced motion with Controls at Slowest, a whole recalibration |
| `evidence/motion-calibration.png`, `motion-cancel.png`, `motion-reduced.png`, `motion-reduced-calibration.png` | Sheets from that recording: calibration across its steps, with captions beside each target travelling with the dot; the cancel every 100 ms, cropped to G–N (the arc grows to about half, pauses, then drains; nothing is selected); the reduced-motion cancel every 100 ms, cropped to O–S; reduced-motion calibration every 120 ms around the first target's completion (the ring turns accent on completion, then releases; the caption moves to the next target at once and never travels) |
| `evidence/motion.txt` | Segment times in the recording; the click-to-ring offset for the ten letters (24 ms each, the audio device's output latency; the click is scheduled on the commit frame); every calibration fill's duration, one entry per target (13 × 650 ms at default speed, 13 × 1750 ms under reduced motion at Slowest, equal to the app's ring at those speeds); both cancels are asserted ("nothing selected: true") |
| `evidence/loops.webm`, `loops.txt`, `loops-contact-sheet.png` | MOTION acceptance 10: the compose loop ten times in a row at real speed (217 s, 720 × 450). Each loop: the partner speaks, Done, type "are" or "body" by gaze while the decoder changes its candidate (A → Do → Are → Body), accept, Done, Speak, Spoken, Listen. All ten completed with no stall. |
| `evidence/loops-scrub-wip.png` | Frames every 30 ms through a candidate change in the word in progress ("Do" → "Are"): the old letters fade out under the new ones in place, with no blank frame |
| `evidence/walk-14-1280-200pct-speak.png` | Speak at 200% on 1280 × 720: the partner line gives its room to the message; whole lines; the last word in view; a tertiary "…" in the margin marks the earlier lines above |
| `evidence/luminance.txt`, `evidence/perf-dwell.txt`, `evidence/worst-case.txt`, `evidence/walk.txt`, `evidence/layout-check.txt` | Measurements and check logs |

I also scrubbed a dwell and commit frame by frame (12.3–13.8 s of the recording): no change for the intent delay, a single focus step, an even arc, the solid ring and bloom on the commit frame with the glyph appearing in the word, the face returning to rest while the ring stays solid. That sheet was not kept (size); `scripts/frames.mjs` regenerates it.

### Against the mock (BRIEF "Visual direction")

`evidence/compare-compose-vs-mock.png`. Whitespace: matches (cards float with 80 px gutters and a 128 px row gap; the mock's are 56 and 76). Radius: matches (40 px). Colour restraint: matches (one ink primary, pastel groups, accent only on the dwell arc; the mock spends three tokens of chroma in the message where this build spends the glyph colours the brief now requires). Finish: matches (one icon set, aligned marks and baselines, the motif drawn at the same weight). Type scale: matches within the brief's revised sizes (letters 32 px, labels 38–44 px, message 52 px); the mock's 64 px range label carried more drama and is no longer allowed. My verdict: it matches the mock; it does not clearly beat it. Council round 2: Sol said yes on all five criteria (matches, does not clearly beat); Opus said yes on whitespace, radius and colour restraint and no on type scale and finish (cramped G–N row, heavy motif, off-grid voice card), all three of which were then changed (R2, R4 and R6 revisions). Rounds 3, 4 and 5: both members said yes on all five criteria and that it matches without clearly beating it. **Plain answer: it matches the mock on whitespace, type scale, radius, colour restraint and finish; it does not beat it.**

### Layout check

```
ok  1440x900 and 1280x720 for every one of 17 phases (calibrate ×4, listen, compose ×3, speak, speaking, spoken, spell ×2, menu ×4)
layout ok in every phase
```

Full output: `evidence/layout-check.txt`. `node ../shared/selftest.ts`: all checks passed. `npm run build`: passes.

### Walkthrough (`evidence/walk.txt`, 41 checks, all ok)

Includes: first run opens on calibration, Escape skips; dwell opens Listen; partner words arrive; Done ends listening; the look that pressed Done types nothing; Listen reopened appends; three gaze looks type three glyphs; Delete reopens "Was" at "Yes"; keys type "Yes I would love that"; One moment shows Speaking and leaves the message; Speak, Spoken; Menu root with One moment in Q1; Selection page directly; noise on; Back twice; Add more; a group typed by gaze with noise on; noisy gaze held on Done types nothing (3 trials); Start and end-of-speech guarded; lockout 413–414 ms every time; leaving the window cancels a dwell; a semantic click works; a phrase renders 7 spoken words; failed speech is shown; Recalibrate; 200% at both viewports holds.

### Luminance (`evidence/luminance.txt`)

Every screen including calibration: 0.818–0.869, within 5.9% (calibration sits on a luminance-matched `#EBEBEF`). Dark theme, every screen: 0.017–0.035 (calibration on `#2A2A2C`; the dark primary is a raised grey, not a light patch). That is 0.018 in absolute terms but 51% of the brightest dark screen, measured the way the light theme's 5.9% is. The optional dark theme does not meet the brief's 10% rule; it is a known limit (below). Before round 3 it spanned 0.008–0.071. Through stage changes (`evidence/flash.txt`): never brighter than either end state; at most a 3.7% dip for about 150 ms (gamma-space blending of the two ink cards).

### Performance during a dwell (`evidence/perf-dwell.txt`, MOTION acceptance 8)

Chromium trace of one look at G–N held through commit: no layout and no paint while the arc draws (400–700 ms); the focus step and the track change are composited opacity, and the arc layer is promoted ahead of time (`will-change: opacity`); the frame where the focus begins now shows no layout and two paints. Over 1400 ms there are 4 layouts and 25 paints, all at the focus step and the commit. The commit lays out and paints because content changes: the new glyph, the decoded letters cross-fading where the candidate changed (since round 4; it was 11 paints at the commit before that), the label cross-fade and the bloom. Style recalculation ticks every frame because the gaze sampler runs `requestAnimationFrame` continuously; a bare test div shows the same ticks inside the app and none on a blank page, so they are not the ring's cost.

### Lint Apple 0.1.24 (ad hoc, project-derived policy)

Policy: fonts Satoshi; sizes 20, 26, 28, 32, 34, 38, 44, 52, 64; minimum control 144 px (the hit region is the whole quadrant; the wide cards are 144 px tall); minimum gap 48. All 17 screens pass at 1440 × 900 and 1280 × 720 after fixes. Findings it caught and I fixed: off-scale sizes from width caps binding at 100%, 4 px ascender clipping in text windows, `aria-label` on role-less spans and paragraphs, keyword contrast 3.86:1 in captions, status text at 4.45:1 mid-fade, letter rows within 8 px of the card edge. Coverage limits: no interaction plans, no `data-ui-*` layout annotations, light theme only, stock reduced-motion run.

### review-animations (self-review, Emil Kowalski standards)

| Before | After | Why |
| --- | --- | --- |
| Outgoing layer mounted as a new element already at `opacity: 0` | Same React key, the element stays and transitions 1 → 0 over 150 ms `--ease-out` | The exit was missing: the old screen vanished instead of leaving (found in the frame trace) |
| Stage cross-fade, label swap and glyph fade also ran on key and click actions | `:root[data-input="key"]` turns those transitions off; state changes at once | Keyboard-initiated actions get no animation (Standard 2; MOTION) |
| Arc drawn with a transitioned `stroke-dashoffset` on a registered `--progress` | Two half-ring blades rotated with WAAPI `transform`; drain by `playbackRate`, commit by `finish()` | GPU-only properties (Standard 7); interruptible from the current value (Standard 6) |
| New label faded in while the old one vanished (one blank frame) | Old and new stacked in one grid cell, old fades out as new fades in, 150 ms | A crossfade, not a gap |
| Calibration guide moved with `left`/`top` | `translate` on `--ease-move` | GPU-only; on-screen movement uses ease-in-out |
| Arc blades visible as hairline slivers at rest | Arc hidden unless focus, drain, done or release | No idle artefacts |
| Staggered exit 150 ms / enter 300 ms from 100 ms | Both layers 300 ms `--ease-state` from the same frame | The stagger dipped through canvas: +10% luminance per stage change (council round 2) |
| Space confirming an armed look bloomed | Counted as a key action: no bloom | Keyboard actions get no motion |
| Face step as a `background-color` transition; track opacity on an SVG circle | Overlay opacity and SVG-element opacity, both `will-change: opacity` | Composited, no paint while dwelling |
| Caption pill grew with each character | The pill reserves the full line from the first frame | Nothing changes geometry while typing, also under reduced motion |
| Reduced motion: commit was only the last opacity step; release snapped | Commit turns the track accent; release fades over 150 ms | Commit distinguishable from progress without movement |
| Drain rate fixed at the full run (a half arc emptied in 75 ms) | Reverse rate from the arc's current time: empty in 150 ms from any fill (measured 233 → 0 in 150 ms) | MOTION's 150 ms drain (council round 3) |
| Arc kept filling ~300 ms after the look left (engine hold and grace) | Arc runs through the engine's hold (the engine can still commit there) and pauses for its grace | Never fills on a tile the engine has left, never pauses before a commit (council round 3) |
| Calibration caption fixed below the centre | Beside the active target on the side with room, travelling with the dot on `--ease-move` | MOTION "Captions": 24 px from the active target (council round 3) |
| A decoded letter that changed vanished and the new one faded in from 0 | Per-position cells: the old letter fades out on top while the new fades in, 150 ms | Cohesion on the most frequent event; nothing blinks (council round 4) |
| Calibration ring filled, then sat full ~1.1 s before the bloom | Fill ends on the bloom frame, as a commit does in the app | Calibration teaches the app's own commit (council round 4) |
| Reduced motion: the calibration caption still travelled 1200 ms | The caption moves at once | No movement under reduced motion (council round 4) |
| Band and status dot faded 300 ms on a key action | No transition on key actions | Keyboard-initiated actions get no animation (council round 4) |
| Spell's swap moved the Q1 node (face snapped) and blanked letter rows | Tiles in quadrant order; letter rows in the stacked label cross-fade | Page change in place is one cross-fade (council round 5) |
| Outgoing label on `--ease-out`, incoming on `--ease-state` | Both on `--ease-out` | One curve per cross-fade; the stack no longer dips (council round 5) |
| Face overlay, ring and arc still transitioned on key actions | Covered by the key-action rule | Keyboard-initiated actions get no animation (council round 5) |
| Reduced-motion calibration had no completion cue | Accent ring on the completion frame, released at the beat | Same information without movement (council round 5) |

Kept and justified: the 450 ms bloom (MOTION's one celebration; it runs after the target has committed, never while armed, transform and opacity only); the 150 ms glyph fade on each group (MOTION's choreography for the lead of the most frequent event); `will-change` on the blades and the bloom only (MOTION allows exactly these). Verdict: **Approve**: no `ease-in`, no `transition: all`, no `scale(0)`, every exit shorter than its enter, reduced motion handled, no hover motion.

### break-ui (worst case, `?data=worst`)

| # | Severity | Field | Worst-case value | What happened | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Broken | candidate on Q1 | "uncomfortable" at 1280 × 720 | Label wider than the 240 px card | Labels size to their longest word (`--chars`, `Screen.tsx` LabelSwap) |
| 2 | Broken | group letters | 200% text | Balanced wrapping made three rows and left the card | Explicit two halves; size capped by card height (`styles.css` letter rules) |
| 3 | Broken | word in progress | "uncomfortable" at 200% | `nowrap` run wider than the reading column | Wraps at large text (`:root[data-text="large"] .wip`) |
| 4 | Ugly | control labels and setting values | 200% at 1280 × 720 | "One moment" and values below the card's bottom | Height-aware caps (`cqh`) and centred clusters above 100% |
| 5 | Ugly | every rest-zone text | Satoshi at 52 px | 4 px of ascenders clipped | 8 px padding inside the text window clip |

Decision for the owner: on a 720 px-tall screen at 200% the reading column fits one line, so a long word in progress shows only its last line. Held: a 34-word partner turn (two-line clamp with a leading ellipsis), a 16-word reply on Speak, every Menu page at 200%, a long spelled name.

### minimal-ui "Verify a screen" (on the screenshots above)

1. Major thing: Listen, the partner's words; Compose, the message; Speak/Speaking/Spoken, the sentence; Menu, its entries (the title says where you are). One per screen.
2. Elements: cards, the status field, partner line and hairline on Compose. No element marked "remove". The 4 px band appears only for Listening and Speaking.
3. Words: no explanatory text on working screens. Allowed exceptions: calibration captions (the brief requires them), the status field (partner-facing state, the brief requires it), the problem line (an error and how to fix it).
4. Colour: group faces and inks (tell groups apart), the ink primary (the one action), the accent arc (dwell progress), red band and dot (recording), orange dot (error). Each has a job.
5. Containers: one card per action, no box inside a box (the ring is an instrument, not a surface), no cards around text.
6. Squint: the message and the ink primary land first, then the groups.
7. Capability: everything in the six capabilities reachable; One moment is three selections with a word pending (documented limit, D3).

## Council

Members: Claude Opus 5.5 (effort high) and GPT-6.1 Sol (reasoningEffort max, serviceTier priority), started in parallel with `delegate_task`, read-only, a fresh task per round.

| Member | Round | Score |
| --- | --- | --- |
| Claude Opus 5.5 | 1 (first build) | 6.5 / 10 |
| GPT-6.1 Sol | 1 (first build) | 6.5 / 10 |

Changes after round 1 (both members): the fresh-look guard covers every quadrant of the deciding tile, releases after 200 ms outside, and applies to calibration Start and the end of speech; keys and clicks carry no guard; lockout toggles a class with `inert` (450–890 ms became 413 ms); letter repeat only for letters; Speak/Spoken share one layout with fixed homes; Menu became a root with direct categories; speed shown in words; Q1 quiet instead of "No match"; Spoken's label "Ready"; listening restarts after silence and never substitutes the script; looking off screen feeds missing samples so the dwell cancels; semantic clicks work; phrase highlighting counts spoken words; speech failure is shown with retry; 200% text keeps whole lines; Space/Enter prefer the armed look; focus returns to the same quadrant after a stage change. Declined: a pale chroma tint for the primary (Opus; the hue families are taken, and the brief now asks for ink anyway); a Compose quadrant for One moment (both; it would cost the reading zone).

After the owner's redo the council scores two things (design and interaction; craft and motion against MOTION.md):

| Member | Round | Design and interaction | Craft and motion |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 2 (after redo) | 7.5 / 10 | 7 / 10 |
| GPT-6.1 Sol | 2 (after redo) | 7 / 10 | 6.5 / 10 |
| Claude Opus 5.5 | 3 | 8 / 10 | 7.5 / 10 |
| GPT-6.1 Sol | 3 | 7.5 / 10 | 7.5 / 10 |
| Claude Opus 5.5 | 4 | 8 / 10 | 8 / 10 |
| GPT-6.1 Sol | 4 | 8.5 / 10 | 8 / 10 |
| Claude Opus 5.5 | 5 (last) | 8.5 / 10 | 8.5 / 10 |
| GPT-6.1 Sol | 5 (last) | 8.5 / 10 | 8.5 / 10 |

Changes after round 2 (DESIGN.md "Changes after council round 2"): the voice action became a wide card that visibly owns Q7–Q8 (Opus measured a look at blank canvas firing Speak); a true cross-fade replaced MOTION's stagger (Opus measured a +10% flash); composited focus step and track; no face step on the primary (arc contrast 2.5 → 3.6:1, Sol); reduced-motion commit in accent and a fading release (Opus); repeat countdown (Sol); quiet Q1 hides its ring and icon (Opus); band in every state and no status above Menu titles (Opus); motif dot 36 px, ring 56 px, letters 30 px (Opus); Accept commits the frozen candidate and late recognition results no longer change context (Sol); leaving the window cancels at once (Sol); dark-theme text inks (Sol); 200% enlargement bounded only by the longest word and the card height (Sol); whole word in progress visible at 200% on 720 px (Sol); calibration backdrop matched to working luminance (both); fixed-size caption pills (Sol); Space-confirm is a key action (Sol); Composer layout effect has dependencies and the root input attribute is written only on change (Opus). Declined: a Compose quadrant for One moment (both; documented limit); regenerating the quadrant-map SVGs (they are written by `shared/layout-map.ts`, outside this folder).

Round 3 verdicts on the mock: both said yes on whitespace, type scale, radius, colour restraint and finish; both said it matches without clearly beating it. Both confirmed every round-2 change.

Changes after round 3 (DESIGN.md "Changes after council round 3"):
- The arc follows the engine when the look leaves: it fills through the engine's 150 ms hold, because the engine can still commit there, and pauses through the 150 ms grace (Opus found it filling for about 300 ms). A drain always takes 150 ms (Sol found it scaling with the fill).
- The message sits at one height across Compose, Speak and Spoken (Opus found a 92 px jump). One shared fitting rule gives the partner line's room to the message when it does not fit, and refits on resize (Sol found Speak unreadable at 200% on 1280 × 720).
- A ghost letter becomes its typed glyph in place, and a second Delete fades the whole reopened word (Opus).
- Quiet Q1 shows its check at 35% (Opus).
- The dark theme gets dark-tinted faces (Opus), a grey primary, a lighter accent that keeps the arc at 3:1 or more and the caption keyword at 4.5:1 or more, and a luminance-matched calibration backdrop (Sol).
- The calibration ring fills over the app's real control ring time (Opus, Sol).
- Captions sit beside the active target and travel with the dot (Sol).
- `will-change` on the arc: focus onset now costs no layout and two paints (Opus).
- A gauge icon for the speeds and count dots at 0.9 (Opus).
- A new recording covers calibration, cancel, ten consecutive letters with the click timing, and reduced motion (Sol asked for it).

Not changed:
- The wide-card canvas at the left of Q5 is the owner's floating-card trade-off.
- The status label is for the user (Opus asked).
- The bloom on letters is MOTION's one celebration (both accepted it).

Round 4 verdicts on the mock: both said yes on all five criteria, matching it without clearly beating it. Both confirmed every round-3 change (Opus probed the arc frame by frame; Sol reproduced the perf trace).

Changes after round 4 (DESIGN.md "Changes after council round 4"):
- Decoded letters cross-fade in place instead of blinking (Opus).
- Predicted letters do not flash a group colour on accept (Opus).
- Calibration blooms on ring completion, and its settle stretches for slow Controls settings (Opus, Sol).
- The reduced-motion caption jumps instead of travelling (Sol).
- Band and status change at once on key actions (Sol).
- A "…" marks earlier lines hidden above a reading window (Opus).
- Spell swaps groups and letters in place (Opus).
- Letters speed has its own icon (Opus).
- New evidence:
  - ten compose loops in a row;
  - a 30 ms scrub of a candidate change;
  - a reduced-motion recalibration at Slowest, with every fill's duration logged.

Recorded as limits:
- the dark theme's 51% relative spread;
- the shared G2–G4 inks at about Lc 72–73;
- the wide cards' reach into Q5 and Q8.

Round 5 was the fourth and last round after the redo. Neither member reached craft 9. Both are satisfied with the design, and both confirmed every round-4 change. On the mock, both said yes on all five criteria: it matches the mock, but does not clearly beat it.

What kept craft below 9 in round 5:
- the recorded "cancels" were really commits;
- Spell's swap snapped Q1 and blanked the labels;
- the two sides of a label swap used different curves;
- reduced-motion calibration had no commit cue;
- a hidden line's descender showed at 200%;
- the face, ring and arc still animated on keyboard actions.

All of these were fixed after the round and verified (DESIGN.md "Changes after council round 5"). No sixth round was run, because the brief allowed four rounds after the redo. The council has not re-scored the fixes.

How the round-5 fixes were verified:
- **Cancel recordings:** the cancel clip now drains with nothing selected, and the motion script asserts that nothing was selected.
- **Spell swap:** probed frame by frame. Q1 fades over about 120 ms, and no label drops below 0.56 visibility.
- **Reduced-motion calibration:** `motion-reduced-calibration.png` shows the accent ring on completion.
- **Hidden line:** `worst/1280x720-200-speak.png` shows no descender above the first visible line.
- **Checks:** walk (41), layout, selftest and build all pass.

Not changed: the bottom-row mark offset between a single card and the wide voice card on Speak and Spoken (a known misalignment, explained in DESIGN.md).

## Proposals for `shared/` (not edited)

1. `attachPointer` should keep sampling a held pointer and emit missing samples while the pointer is outside the window; today a still mouse goes stale after `staleMs` and a 900 ms dwell can never finish, and leaving the window does not cancel a dwell until `staleMs` (D13).
2. Per-action dwell and repeat (two dwell classes are a brief rule but the engine has one `dwellMs` and one `repeat`; D14).
3. `trackActionables` should observe `inert` in its attribute filter, so a lockout ends exactly on time (D4).
4. The quadrant dead band should not block the first quadrant when none is current; a wide tile's label sits on an internal grid line and a cold, still look there never registers.
5. `speak` should report word boundaries and distinguish ended, cancelled and failed; `listen` should restart after the browser's silence timeout and report refusal (D11, D12, D19).
6. A dwell's progress keeps running through the 150 ms quadrant hold and 150 ms grace after the look leaves, so any arc driven by `progress` keeps filling on a tile the person has left. The snapshot should expose whether the raw look is on the action (or freeze `progress` while `awaySince` is set). This style works around it with the engine's own view of the look: the arc keeps filling through the hold, where the engine can still commit, and pauses through the grace (DESIGN "Changes after council round 3"). The arc still grows by about 40% of the ring after the look leaves at the default letter speed, because the hold can still commit.

## Open questions and limits

- The T3 preview browser could not capture screenshots or recordings in this session; all media are Playwright captures of the same running app.
- Linear (the team's research memory) needs authorisation in this session, so I could not read or write it. Council round 1's Sol member read it from its own lane.
- Group faces sit at about 1.06:1 against the canvas (BRIEF known limit); the dwelt tile deepens one shade. Not tested with low-vision users.
- With a word pending, One moment is three selections (D3).
- Calibration takes about 52 s at MOTION's timings (0.9 → 54.8 s in `evidence/motion.txt`), against the brief's "about 30 s"; slower Controls settings lengthen each settle to fit the ring.
- Mean luminance is within 5.9% across every screen; a stage change can dip up to 3.7% for about 150 ms. The optional dark theme spans 0.017–0.035 (51% relative), outside the 10% rule.
- The brief's group inks for G2–G4 measure about Lc 72–73 against their faces, below the literal Lc 75 label rule (Sol, round 4). This is a conflict inside the shared tokens; this style uses them as given.
- The wide Done and Start cards own Q5–Q8 and reach about 24 px into Q5 and Q8, so the left 336 px of Q5 select a card drawn further right. The README rule allows this; with a real tracker it is the riskiest hit region (Opus, round 4).
- The live microphone path was exercised only by its refusal handling and a controlled restart; the walkthrough uses the scripted partner.
- Earcons start only after a key press or click (browser autoplay policy).

## Methods used

Read and applied (absolute paths):
- `/Users/aamia/.codex/skills/t3-workflow/SKILL.md`, `references/routes.md`, `references/ui-quality.md`, `references/visual-evidence.md`, `references/orchestration.md`
- `/Users/aamia/.agents/skill-libraries/pstack/skills/poteto-mode/playbooks/feature.md` (primary route; implementation kept in this thread because the user assigned it here and the work is one tightly coupled folder)
- `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` ("Verify a screen" above)
- `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md` (freeze under an armed dwell, one exit, label in name, honest failure)
- `/Users/aamia/clarte/skills/review-animations/SKILL.md` and `STANDARDS.md` (table above)
- `/Users/aamia/clarte/skills/choreograph/SKILL.md` (one entrance per container, same-element exits, timelines in DESIGN R5–R8)
- `/Users/aamia/clarte/skills/animation-performance/SKILL.md` (compositor arc, trace diagnosis)
- `/Users/aamia/clarte/skills/emil-design-eng/SKILL.md`, `/Users/aamia/clarte/skills/apple-design/SKILL.md` (tracking by size, response, interruptibility)
- `/Users/aamia/clarte/skills/break-ui/SKILL.md` and `CATALOG.md` (table above, `?data=worst`)
- `/Users/aamia/clarte/skills/find-animation-opportunities/SKILL.md`, `/Users/aamia/clarte/skills/remove-animations/SKILL.md`, `/Users/aamia/clarte/skills/animation-vocabulary/SKILL.md` (restraint; nothing added beyond MOTION's list)
- `/Users/aamia/clarte/skills/better-ui/SKILL.md`, `animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md`, `performance.md`
- `/Users/aamia/clarte/skills/frontend-design/SKILL.md`, `/Users/aamia/clarte/skills/design-html/sections/doctrine.md`, `craft.md`
- `/Users/aamia/clarte/skills/lintapple-ui/SKILL.md` (Lint Apple 0.1.24 run above)
- `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/council/SKILL.md`
- `/Users/aamia/clarte/AGENTS.md`, and `/Users/aamia/clarte/prototypes/UI/v0/README.md`, `BRIEF.md`, `MOTION.md`, `RESEARCH.md`, `s0/DESIGN.md`
