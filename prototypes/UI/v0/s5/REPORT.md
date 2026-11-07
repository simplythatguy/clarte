# Style 5 · Dialogue: report

The conversation is the screen. The partner's turns and the person's replies form a thread in the Q2–Q3 rest zone. The primary card (Q1) offers a whole suggested reply from the partner's last words before any typing, then the live best word while typing, then Speak. Q4 is the contextual Delete / One moment / Menu / Not now card. The four letter groups sit in Q5–Q8. Two rest zones in every state, no page flip.

The build is on the owner's shared light skin (BRIEF "Visual direction", "Quality bar", MOTION.md, 2026-11-07). The visual layer, card labels, word in progress and motion were redone for it; the layout, quadrant map, thread, suggested-reply contract and engine carry over.

## Run it

```sh
cd prototypes/UI/v0/s5
npm install
npm run dev            # http://localhost:5105 (strict port)
```

- First run opens the calibration sequence; **Escape** skips it.
- Mouse = gaze (dwell), digits **1–8** select Q1–Q8, **Space/Enter** confirm a preview (Confirm mode) or activate a keyboard-focused card, **Escape** cancels, **`** toggles the shared quadrant overlay.
- `#phase=<name>` opens any phase directly (`idle`, `listening`, `suggested`, `composing-pending`, `composing-reopened`, `composing-nomatch`, `composing-ready`, `speaking`, `spoken`, `menu`, `menu-phrases`, `menu-settings`, `menu-settings-2`, `menu-demo`, `worst-case`, `worst-nomatch`, `calibrate-position`, `calibrate-points`, `calibrate-validate`, `calibrate-ready`). `window.clarteDebug` exposes `phases`, `phase()`, `setPhase()`, `validate()`, `engine`.
- Checks: `npm run build`, `node ../shared/selftest.ts`, `node ../shared/check-layout.mjs http://localhost:5105 <dir>`, `node scripts/check-rest.mjs`, `node scripts/side-by-side.mjs`, `node scripts/record-demo.mjs http://localhost:5105 <dir>`, `node scripts/check-card-text.mjs [dir]` (card text at 100%/200%), `node scripts/check-reading.mjs` (reading safety), `node scripts/check-click.mjs` (commit click timing), `node scripts/check-swap.mjs` (card swaps frame by frame), `node scripts/check-frequent.mjs` (candidate fade speed, reduced-motion ring).

## What was built

- Every capability in the brief: Listen (Web Speech when available, scripted partner otherwise, restarting after every ended session with backoff on errors), the thread, the suggested reply (`src/suggest.ts`, contract `suggestReply(partnerText): string | null`, quiet ink card with “quotes” and a Suggested hint, dismissed by typing or by **Not now**), typing with the four groups and the live word in progress (`pendingGlyphs`), accept, Delete and reopen at the next candidate, Delete word, Speak with the spoken word highlighted from synthesis boundary events or a timer, Say again (6 s, held while gaze rests on it), Stop as a repair (the draft returns), One moment, Menu (Phrases, Settings ×2 pages, Recalibrate, Demo), and the calibration and first-run sequence.
- Settings, each showing its value and advancing on one look: Letter dwell, Button dwell (0.3–2 s), Text size (100–200%), Theme (light/dark), Sounds, Selection (Dwell/Confirm), Word colours, Suggested replies on/off; Demo: Gaze noise, Repeat (Look away / Hold), Partner voice (Microphone / Script).
- State pill (Listening, Replying, Speaking) and Web Audio earcons (commit, control, delete, rise and fall on phase changes).
- Developer overlay mounted in development; `clarteDebug` for the layout check; keyboard access, visible focus, accessible names, reduced motion, text to 200%.

Decisions beyond the original DESIGN are written in `DESIGN.md` ("Decisions made while building" and "Visual layer v2"). The most consequential:

- **The suggested reply is never louder than any other primary function** (R-3 §18, R-2 F19): it sits on the same ink card every Q1 function uses (the brief's primary target), in quotes, with a Suggested hint, never with an accent of its own; Q4 offers **Not now** while it shows.
- **Cards float**, centred content, 64 px gutters, a 144 px row gutter; Q1 is always the ink card so selecting Speak never changes luminance under the fovea.
- **Gaze safety layer** on top of the shared engine: dwell classes by action, a quadrant guard after every selection, an owner-change guard (nothing fires when a rest quadrant becomes active under a still gaze), Hold-repeat for letters only, labels that never change under a resting gaze, off-screen = no eyes (streamed), stale-label activations are no-ops.
- **Live line** with a fixed two-line basis; at large text it shrinks to the room, steps its type down to a floor and keeps the latest words. Everything readable stays inside Q2–Q3 (council R5: the row gutter belongs to Q5–Q8).
- **Cards hold still.** Each card's motif sits at a fixed height; text flows below it; a face change cross-fades a frozen clone of the old face (`src/Swap.tsx`), on page timing for a screen change and the 150 ms label cross-fade within a screen. Card text fits by measurement (`src/fit.ts`).
- **FLIP rise retired** for a cross-fade in place (MOTION.md: nothing slides across quadrants).

## Evidence

All media below were opened and inspected. Screenshots are in `evidence/`; the recording is in `recording/` (kept out of `evidence/` for the ~3 MB budget).

| File | What it shows |
| --- | --- |
| `evidence/dwell-paint-trace.json`, `evidence/idle-paint-trace.json` | Timeline traces: layouts, style updates and Paint events in 800 ms mid-dwell and at idle |
| `evidence/screen-change-luma.json` | Per-frame luminance (whole screen, Q1 card, Q1/Q4/Q6 faces) and bloom count across Menu → Settings → Back → Back |
| `evidence/compose-vs-mock.png` | The compose screen (`composing-pending`, 1440×900) beside `reference/11-light-direction-mock-1440x900.png` |
| `evidence/layout/1440x900-*.png` (20) and `1280x720-*.png` (11 conversation and worst-case phases) | Every phase from `check-layout.mjs`; 1280 menu and calibration frames removed as redundant (the log covers all 40) |
| `evidence/layout-check.log` | 40/40 phase × viewport combinations ok, zero violations |
| `evidence/rest-check.log` | Q2 and Q3 rest in all 40 |
| `evidence/dwell-scrub.png` | 52 consecutive screencast frames (~33 ms apart, every second frame of 104) of one dwell on G–N: still during the intent delay, single focus step, clockwise arc, commit (ring solid + bloom 895–1129 ms), held accent, 150 ms drain after gaze leaves |
| `recording/demo-loop.webm` (68 s, 1440×900, Playwright recording of the running app) and `evidence/demo-loop-sheet.png` (a frame every 2.5 s) | First-run calibration (position, three points) → Escape → Listen → transcript → Stop → suggested reply → typing "tired" by dwell (incl. the double A–F) → accept → Delete reopens at "three" → Delete word → retype → accept → Speak → Say again → Menu → Settings → Back → Back |
| `evidence/swap-check.log`, `evidence/frequent-check.log` | Card swaps frame by frame (rings still, outgoing size kept, page changes never doubled, hints under labels); candidate fade ≤ 150 ms; reduced-motion ring monotonic |
| `evidence/reading-safety.log` | Thread content inside Q2–Q3 for every phase, viewport and text size; live line never clipped unmarked; 2 s dwells on the last visible words select nothing; incremental typing of an unknown word stays fitted |
| `evidence/commit-click.log` | The commit click is requested in the same task as the solid ring and bloom (0.1–0.2 ms), scheduled at the context's current time |
| `evidence/text-200-compose-1280x720.png`, `text-200-menu-1280x720.png`, `text-200-sweep.log` | 200% text on the smallest viewport: letters wrap to two rows of four, the draft fits, the partner question keeps its head. Every card's text stays inside its card with no word broken across lines (sweep: 20 phases × 2 viewports × 100% and 200%). Menu row labels are about 28 px here, limited by "Recalibrate" |
| `evidence/dark-compose-1440x900.png` | Optional dark theme |
| `evidence/worst-case-1440x900.png`, `worst-case-1280x720-200.png`, `worst-nomatch-1280x720-200.png` | break-ui fixtures (see below) |
| `evidence/calibration-settle-crop.png` | Active calibration target mid-settle: 6 px centre dot visible, arc filling, caption pill with the highlighted keyword |
| `evidence/lintapple-policy.json` | The project-derived Lint Apple policy used |

## Verification

- `npm run build` passes; `node ../shared/selftest.ts` → all checks passed.
- Layout check: **40/40 ok at 1440×900 and 1280×720, zero violations**; rest check: Q2 and Q3 are rest in every phase.
- Walkthrough (headless Playwright with real pointer dwells, and earlier in the T3 preview): mouse as gaze, keys only, and with gaze noise 0.06 (dwell completes at card centres; quadrant switches cancel cleanly). Every step of the brief's user path works. Probes verified: looking off screen during a Speak dwell cancels it; a rest quadrant that becomes active under a still gaze never fires (12 s hold); Speak under a still gaze with Hold on speaks once; Hold double-types letters; Stop restores the draft; Confirm mode Space confirms the preview; live recognition restarts after a session ends with words (injected fake recognition); the calibration runs points → check → Ready with no page error.
- Performance (acceptance 8), devtools timeline trace over 800 ms in the middle of a dwell: **0 layouts, 0 Paint events** (the arc is two half-rings rotated with transform, animated by the compositor); the idle baseline is also 0 and 0 (`evidence/dwell-paint-trace.json`, `evidence/idle-paint-trace.json`).
- Luminance across screen changes (screencast of idle → Menu → Settings → Back → Back, every frame, `evidence/screen-change-luma.json`): whole screen 223.2–232.6 (largest step 2.5 of 255); Q1 card 32.5–50.5 and its bare face 29.1–44.1 (the dwell focus step, ink ↔ ink-focus; largest step 5); one bloom per selection, none on a copy.
- Lint Apple 0.1.24 with `evidence/lintapple-policy.json` at 1440×900: idle, composing-ready, speaking, menu, menu-settings exit 0. composing-pending reports text-contrast on glyphs measured mid fade-in (resting values: ghost `#86868B` on canvas 3.33:1 at 52 px, hints 5.07:1, partner turns 4.66:1) and one content-clipping on the visually hidden screen-reader text; both judged false positives. Earlier fixes from Lint Apple: explicit `html` background; accessible names now contain the visible text; label sizes on-scale.
- T3 preview limits, stated plainly: `preview_recording_start` timed out on every attempt after the reskin (it worked for the first build), and `preview_snapshot` hangs in a tab once speech synthesis has played. The final recording and frame sequences were therefore produced with Playwright (`scripts/record-demo.mjs`) against the same dev server; T3 preview screenshots from the first build are not reused as evidence.

### MOTION.md acceptance (self-check on the recording and the frame sequence)

| # | Check | Result |
| --- | --- | --- |
| 1 | Idle is still | Yes: 0 DOM mutations and 0 style recalcs per second at rest (measured) |
| 2 | First 150/250 ms of a look show no change; single focus step; even arc | Yes (`dwell-scrub.png`: first change after the quadrant hold and intent delay; one face/track step; linear arc) |
| 3 | Leaving drains the arc | Yes, from its current value, 150 ms |
| 4 | Commit: solid ring, click and bloom on one frame; bloom moves no layout | Yes; bloom is a transform/opacity layer outside the flow |
| 5 | Phase change is one cross-fade, no sliding, no luminance jump | Yes after round 6. Cards persist and change in place; their content cross-fades out 150 / in 300 from 100 ms from a frozen clone, and the motif never moves (`swap-check.log`); luminance measured above. Calibration ↔ app cross-fades two stages with `plus-lighter` |
| 6 | Captions type at 30–35 ms/char, keyword highlighted, one line at a time | Yes: 32 ms, 180 ms rest after punctuation, accent keyword |
| 7 | Guide dot travels with one easing; ring fills at the app's rate | One easing (`--ease-move`); the calibration arc is the same component style and linear over the settle |
| 8 | No layout/paint beyond the ring during a dwell | Yes: 0 layouts and 0 Paint events mid-dwell (traced) |
| 9 | Reduced motion keeps the information | Arc → four-step ring opacity that only rises (fixed in R6; `frequent-check.log`), no bloom, guide jumps, fades remain |
| 10 | 50th-use test | Frequent motion is ≤ 150 ms colour/opacity, including the candidate word (fixed in R6: it had used the page fade); key presses render without transitions; the bloom (450 ms) runs on every gaze commit as MOTION prescribes |

### Compose screen vs. the mock (BRIEF "Visual direction")

`evidence/compose-vs-mock.png`. My judgment: **matches, does not beat.**

- Whitespace: matches. Cards float with 64 px gutters and a calm 144 px band between rows; the rest zone holds one hairline and the message.
- Type scale: matches the mock's text sizes (52 px message, 44 px labels, 26 px partner). The mock's 64 px range labels are its biggest gesture; the owner's letters-not-ranges decision replaces them with 36 px letter rows, which reads quieter.
- Radius: matches (40 px, concentric motif).
- Colour restraint: matches or slightly beats: one accent, only on dwell; group colour only on group cards and typed glyphs.
- Finish: matches: the motif, the pill, the outline icons, 1.5 px strokes. Where it falls short of beating: the mock's bottom-left editorial alignment is more striking than my centred stack (centred per the brief's "label centred" and the HIG focus-point rule), and the thread adds two quiet history lines the mock does not carry.

## review-animations (run on this build)

| Before | After | Why |
| --- | --- | --- |
| FLIP rise of the finished line into the thread (translate + scale across the rest zone, 380 ms) | Cross-fade in place: line out 150 ms, turn in 300 ms from 100 ms | Spatial motion on a frequent event; MOTION.md forbids sliding |
| Two-segment bar, per-frame attribute writes | WAAPI arc started on state transitions only | Per-frame DOM writes re-ran the actionable tracker and blocked tooling; composite-cheap now |
| Keyframe fades on the accepted word and ghost tokens | `@starting-style` transitions (opacity, colour) | Interruptible, no keyframes on frequent UI |
| Bloom on every commit, including key presses | No bloom on keyboard-triggered selections | Keyboard actions get no motion |
| `opacity` dimming of disabled cards' faces (luminance change) | Faces stay; only content dims | Constant luminance |

Remaining tension (documented, not changed): the 450 ms bloom runs on every gaze commit, which review-animations' frequency rule would cut; MOTION.md (the owner's bar) prescribes it as "the only celebration" and it never moves layout. Easing tokens are `--ease-out`, `--ease-state`, `--ease-move`; no `ease-in`, no `transition: all`, no `scale(0)`. Pure-fade entrances (no transform) are deliberate: the gaze research forbids movement near armed targets. **Verdict: Approve**, with the bloom frequency noted for the owner.

## break-ui (run on this build)

Fixtures are the `worst-case` and `worst-nomatch` phases (`src/debug.ts`, shown at both viewports and at 200%).

| # | Severity | Field | Worst-case value | What happened | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Broken (fixed) | live line at 200%, 1280×720 | "I would love to go outside" | Overflowed the thread onto the bottom cards | Live line shrinks to the room and its type steps down; history yields to it; the thread stays inside Q2–Q3 (row-gutter borrowing removed in R5, see #8) |
| 2 | Ugly (fixed) | word in progress, unknown name | `wojciechowski` (13 groups, no candidate) | Dot row ran off the right edge | Dot runs may wrap; words with letters never break |
| 3 | Ugly (fixed) | newest partner turn at 200% | 50-word question | Kept its tail, lost "Do you want to…" | Newest turn anchors to its first line when it alone does not fit |
| 4 | Fragile (open) | 5-word draft of the longest words at 200% on 1280×720 | "really uncomfortable physiotherapist everything temperature disappointed" | At the type floor the oldest line is clipped (latest words kept) | Physical limit of a 280 px rest zone at 104 px type; recorded below |
| 5 | Held | candidate in Q1 | `physiotherapist` (15 letters) | Shrinks to fit (`150cqi / length`, then the fit pass) | – |
| 6 | Held | letter rows at 200% | `GHIJKLMN` | Two rows of four at 60–71 px | – |
| 8 | Broken (fixed, council R5) | the live message at 1280×720 | any two-line message | Used the row gutter, inside Q5–Q8's backend quadrants: reading it could type | The thread stays in Q2–Q3; history yields to the message; `evidence/reading-safety.log` |
| 7 | Broken (fixed, council R5) | card labels at 200%, 1280×720 | `Recalibrate`, `Button dwell 0.9 s`, `Please say that again` | Words split mid-word ("Dem/o") or spilled past the card edge | Words never break; `src/fit.ts` shrinks each card's text until it fits width and height; bottom-row peers share one size |

## Council

Members as the user named them: Claude Opus 5.5 (effort high) and GPT-6.1 Sol (reasoningEffort max, serviceTier priority), each round a fresh read-only `delegate_task`.

| Delegate | Round 1 (first skin) | Round 2 (first skin + fixes) | Round 3 (light skin): design / craft | Round 4: design / craft | Round 5: design / craft | Round 6: design / craft |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 (high) | 6.5/10 | 7.5/10 | 7.5 / 6 | 8 / 7.5 | 8 / 8 | 8.5 / 8.5 |
| GPT-6.1 Sol (max) | 5/10 | 6.5/10 | 7 / 6 | 7.5 / 7 | 7.5 / 8 | 8 / 8.5 |

Rounds 1–2 predate the owner's direction change and were single scores. From round 3 each member gives two scores (design and interaction; craft and motion against MOTION.md) and a verdict on the mock. Round 3 mock verdict, both members: **matches, does not beat**; both blocked on motion and selection findings.

**After round 1** (applied): calibration crash at the points → check step; rest-to-action firing under a still gaze (owner-change guard); Hold repeat limited to letters; stale labels on click/key; Confirm-mode key routing; Stop restores the draft; 200% draft clipping; Speak luminance swing; progress centred near the label; group bars to 3:1; listening restart after sessions with words; false latch on stale dwell; calibration shortened.

**After round 2** (applied to the reskinned build, since the skin changed while it ran): looking off screen now cancels a dwell (Sol, high); the calibration guide hands over so the centre dot shows (both); recognition errors back off and fall back (Opus); the newest turn keeps its head at 200% (Opus); the 200% floor is the 100% size (Sol); 300 ms controls still show progress (Sol); labels always wait for gaze to leave (Opus); the double earcon on Stop (Opus). Obsolete with the reskin: Sol's build-break (mid-migration snapshot), range labels and tokens, warm-skin contrast; Opus's G1/accent clash and token wrap.

**After round 3** (all applied):
- Opus: every screen change and the live line at Speak cut through bare canvas for a frame (outgoing copy remounted at opacity 0; measured luma jump to 244). Now both layers cross-fade together over 300 ms and the outgoing copy starts from 1; re-measured across Speak, Menu and Back: whole-screen mean luminance stays within 223.5–233.5, max 2.9 per frame. A spoken message stays the same element from composing into speaking. Spoken word now in the speaking ink (4.65:1). State pill larger (26 px, 48 px tall), Replying in magenta and shown as soon as a reply is owed; one element so its colour transition runs. Post-commit ring fades instead of unwinding; cancel drains linearly while fading (no cap dot). Quiet cards fade over 300 ms. Q1 says "No word" from the first group. The overflowing live line gets a top mask. Gutter figures corrected (144 px).
- Sol: leaving the window late in a dwell no longer fires (exit cancels; no dwell selects while outside). Confirm mode has its own preview state (full arc, no success ring or bloom until Space). Dark theme glyph inks lifted for the dark canvas. Card labels size by their longest word, so 200% enlarges them (Delete 44 → 55 px; hints 20 → 38 px) up to the card's physical width. At 1280×720 the thread may use the empty row gutter so the partner turn keeps two lines; fit and anchoring recompute on resize. Keyboard-triggered actions now render with transitions off. Reduced-motion calibration steps the ring's opacity across the settle. Accepting a word or suggestion no longer relabels Q1 under the gaze. The outgoing layer lives for its full fade. The caption pill reserves its full size before typing.
- Not changed: the 450 ms bloom on every gaze commit (owner-prescribed; both members accept it); "ring-only paint" is not proven (Sol is right that the trace shows document paint as well; REPORT now claims only zero layouts and one-element style recalc).

**After round 4** (both members, mock verdict from both: matches, does not beat).
- Sol: Space/Enter confirming a preview now render without motion; reduced-motion calibration steps were scheduled from a mutated time (now relative to arrival); setting values, phrases, the suggestion and setting names size by their longest word, so 200% enlarges them; history reserves two whole partner lines before the message (at 200% on 1280×720 the partner turn keeps two lines, clamped with an ellipsis); a Confirm preview shows a half-strength arc, distinct from the solid committed ring; **the dwell arc is now two clipped half-rings rotated with `transform`**, so a dwell is compositor-only: the trace records 0 layouts and **0 Paint events** in 800 ms mid-dwell (it recorded 96 with the dash-offset arc; `evidence/dwell-paint-trace.json`, idle baseline `evidence/idle-paint-trace.json`). Sol's fade-pulse finding (Q1 29 → 82 → 29) is the one Opus found; it was fixed by the persistent board before Sol's report arrived.
- Opus: the symmetric two-layer cross-fade still flashed a shared card through the canvas (Q1 card 34 → 86 → 34), double-exposed labels and restarted the bloom on the fading copy. The cards now persist across screens and transition in place; re-measured: Q1 card 35.6–50.5 (only the dwell focus step), whole screen 223.2–232.2, one bloom per selection, none on copies (`evidence/screen-change-luma.json`). History shows whole lines only (no half-erased line under the pill; the newest turn clamps to whole lines at 200%). The face returns to rest at commit. Stale Stage comment fixed.

**After round 5** (Opus 8 / 8, Sol 7.5 / 8; both: matches the mock, does not beat it. Opus it re-verified the round-4 luma, bloom, compositor-only dwell, Confirm keys and reduced-motion calibration as holding).
- Opus, high: the round-4 longest-word sizing broke at 200% on 1280×720: "Dem/o" split mid-word, and "Not now", "No word", "Look away", "Button dwell 0.9 s" and "Please say that again" spilled out of their cards. **The round-4 REPORT said the 200% menu evidence passed; the image showed "Look away" outside its card. That claim was wrong.** Now card text never breaks inside a word (`overflow-wrap: normal`), and a measured fit pass (`src/fit.ts`) steps each card's text down by `--fit` until the content fits the card's width and height. The bottom row is peers (menu items, settings, phrases), so all four share the smallest size any of them reached. Q1 and Q4 are different ranks and fit alone. The pass runs after each render and only does work when card text, viewport, text size or font status changed; it also runs on resize and font load. Verified by a sweep of all 20 phases × 1280×720 and 1440×900 × 100% and 200%: no text outside its card and no word on two lines (`evidence/text-200-sweep.log`; the probe discounts the blank trailing letter-spacing after a row's last letter). One limit, stated plainly: at 200% on 1280×720 the Menu row's labels are about 28 px, because "Recalibrate" is the longest single word that must fit a 256 px card and its peers match it. The thread's text does double.
- Opus, medium: card content cut in one frame on a screen change, because its keyed wrapper was `display: contents`, which has no box to fade. Each face is now a real box (`.card-swap`), stacked in one grid cell with the outgoing face. The outgoing face takes no height, fades out over 150 ms, and is inert. The incoming face fades in over 300 ms from 100 ms (MOTION "Phase or page change"). Measured on Menu → Settings, Q5: old face 1 → 0.01 by 104 ms, new face 0 until 104 ms, then 0.20 → 1.00 by 371 ms, with no frame showing both. Whole-screen luma across screen changes is 223.2–232.6, max 2.5 per frame. The Q1 card is 32.5–50.5. Dwell is still 0 Paint and 0 layouts in 800 ms.
- Opus, low: peer label sizes now match across the bottom row (above). The duplicated comment in `App.tsx` is removed.
- The settings effect now runs before paint, so a new text size is never shown unfitted for a frame.
- Sol, P1: **reading the message could enter a letter group.** At 1280×720 (and at 200% anywhere) the thread used the empty row gutter above the bottom cards; that gutter belongs to Q5–Q8, so dwelling on "outside" typed into G2. My "text is never actionable" reasoning was wrong: the backend classifies where the eye is, not what is drawn. Both gutter extensions are gone. Everything readable stays inside Q2–Q3 with the 40 px inset from the row boundary, and the room is shared in priority order: the state pill, then the live message (type steps down to its floor), then whole lines of history. History reserves two lines at 100% and one at 200% (with tighter rule margins); when the message is past its floor, history gives up its second line and the message takes the room. A lone clamped turn no longer shrinks by its speaker-change margin (that clipped descenders). Verified by `evidence/reading-safety.log`: across 18 non-calibration phases × both viewports × 100% and 200%, the pill, history and live line all sit inside Q2–Q3; the live line is never clipped without its mask; dwelling 2 s on the last visible word of the live line and of the newest turn selects nothing (14 gaze trials). One case remains masked by design: the five-longest-words draft at 200% on 1280×720 (break-ui #4).
- Sol, P2: the word in progress rendered its glyphs one commit late, so the live line's fit measured the previous glyphs (seven glyphs in 225 px of content in a 115 px room, unmarked). The glyphs now render in the same commit, and only a deleted trailing glyph is added back for its 120 ms fade. The fit also re-runs from a ResizeObserver on the live line, its text and the history, so a text-size change applied by the parent, the webfont arriving or a resize refits it. Verified: typing `wojciechowski` after "Ask" group by group, at both viewports and both text sizes, is fitted at every step.
- Sol, P2: peer sizing scaled every text role together and pushed setting names under 20 px ("Gaze noise" 18.4 px). Now each role (label, setting name, setting value, phrase) takes the smallest size that role reached in the row, setting names keep a 20 px floor, and a card gives back motif-to-text space (24 → 12 px) before its text shrinks.
- Sol, MOTION item 4 (the click on the commit frame, unverified because its probe had no running AudioContext): measured with Chromium's autoplay gate open (`evidence/commit-click.log`). The click is requested in the same task as the solid ring and the bloom, 0.1–0.2 ms after the bloom starts (1.8 ms on the first commit of a session); the 5 ms scheduling lead was removed, so the tone starts at the context's current time. What remains is the device's output latency (29 ms on this machine's headless path), which a web page cannot remove. Browsers keep audio suspended until the first key or click, so a pure-gaze session in a fresh tab starts silent (declared under open questions).

**After round 6** (Opus 8.5 / 8.5, Sol 8 / 8.5; both: matches the mock, does not beat it). Both members re-verified the round-5 fixes with their own probes: reading safety (Sol 17 and Opus 18-phase sweeps, no selection, nothing outside Q2–Q3), card text at 200% in 80 combinations, incremental typing of `wojciechowski`, the commit click with running audio (0.1–0.3 ms after the bloom, same task), Confirm keys, luma (222.8–232.7), one bloom per commit (Sol: 40 selections, 40 blooms over ten loops), 0 layouts and 0 paints mid-dwell. **Process fault, disclosed:** I applied Opus's round-6 fixes while Sol's round-6 review was still running, after telling both members the tree would not change; Sol noticed, re-verified on the changed files and fingerprinted the final tree it scored.

Round 6 was the fourth and last round the owner allowed after the direction change. **The stopping rule (craft ≥ 9 from both, mock match or beat) was not met.** Every round-6 finding except the one Opus marked as declared was then fixed and verified with probes; those fixes have not been re-scored by the council.
- Opus, medium: **a card swap jumped on its first frame.** The outgoing face was a fresh render that lost its fitted font size (Q5 "Phrases" 30.2 → 42.6 px at opacity 1), the icon cut instantly, and the motif and dwell ring moved with the new face's height (up to 54 px). Now each card's motif sits at a fixed height (`padding-top` from the card height, the same in every face; 16 px higher at large text, so two letter rows fit), text flows below it, the outgoing face is a clone of the DOM taken just before React replaces it with every computed font size frozen inline (`src/Swap.tsx`, `getSnapshotBeforeUpdate`), and the icon fades with its face through the same component. Verified by `evidence/swap-check.log` (`scripts/check-swap.mjs`): 8 transitions × 2 viewports × 2 text sizes, every frame for 450 ms: rings never move, the outgoing face keeps its on-screen size on frame 1 (Q5 "Phrases" holds 30.15 px), page changes never show both faces above 0.15, hints sit under their labels. My first attempt let the letter cards' count bars reach the card edge at 200% on 1280×720 and then shrank the letter rows to one 31 px row; both were caught in the screenshots, reverted, and fixed by giving letter cards the room (the sweep now checks the count bars).
- Opus, medium: **at 200% a hint outranked its label** ("Accept" 38.5 px over "disappointed" 26.8 px). A hint is now capped at 0.6× its label's fitted size, floored at 20 px (`fit.ts`).
- Opus, low: the thread's fit re-ran on every App render (one forced layout per look start); it now re-runs when the thread's inputs change, and its ResizeObserver catches every size change.
- Sol, P2: **a candidate change while typing used the page-change fade** (100 ms delay, about 400 ms to full), against BRIEF's 150 ms ceiling for frequent actions. A face change within one screen now uses MOTION's 150 ms label cross-fade with no entrance delay; page changes keep their choreography. Measured (`evidence/frequent-check.log`, real dwells): "i" → "me" visible on the next frame and full in 100 ms; idle → Menu still starts its new face at 120 ms and is full at 370 ms.
- Sol, P2: **reduced-motion progress ran backwards** (ring opacity 0.30 → 0.81 → 0.49 → 1: the normal focus cue brightened the ring before step 1 dimmed it). Under reduced motion the focus cue now stays on the face and the ring's brightness is progress only: measured 0.30 → 0.97, never falling.
- Opus, low (declared, not reopened): at 200% on 1280×720 the partner's question keeps one line with an ellipsis.

**Declined** (all rounds): restoring mid-message access to One moment, Recalibrate, Menu, Listen and Clear (it would redesign the six-action layout the style exists to test; declared below; both members accepted the declaration); a "gaze-accessible review path" for overflowing drafts (new UI beyond the brief); Selection: Confirm one-look lock-out (kept, keys still work, noted).

## Open questions and what the brief asks that this style does not satisfy

1. **Capability (declared non-compliance).** Mid-message, One moment, Recalibrate, Menu (settings, phrases) and Listen are reachable only once the draft is empty: six actions and two rest zones leave two control slots, and mid-message those are the candidate/Speak and Delete. One moment mid-message is the costliest gap (partners misread silence while a reply is typed). Remedies for the team, none built: (a) a two-stage Q4 where Delete's second state offers One moment; (b) Menu from the state pill as a seventh target in a Q2/Q3 corner, which would break this style's "Q2 and Q3 rest in every state"; (c) the suggestion slot showing One moment while the partner waits.
2. **Calibration length** is about 42 s: MOTION.md's own pace (1200 + 1800 ms + 400 ms beat × 9) makes "about 30 s" unreachable; MOTION says about 40 s.
3. **200% on 1280×720** with a very long draft (five of the longest words) clips its oldest line at the type floor, marked by the top mask (break-ui #4). The thread may no longer borrow the row gutter for it: that space belongs to Q5–Q8.
4. **Satoshi x-height** measures 0.494 against the brief's 0.5; Satoshi is the brief's named face.
5. **Brief palette conflicts**: none in the light skin; the group inks meet 5.6–6.5:1 on their faces. The pastel faces are 1.06:1 to the canvas; this style deepens the dwelt card one step (no outline).
6. **Whole-reply suggestion** (the question this style exists for): the stub rule table only fires on three question shapes; the team should test whether people use it, ignore it or resent it once the language model drives it.
7. **Audio unlock.** Browsers keep Web Audio suspended until the first key or click, so a pure-gaze session in a fresh tab has silent earcons until someone presses a key or clicks. A product build needs the host (or the caregiver's launch click) to unlock audio.
8. **Menu labels at 200% on 1280×720** are about 28 px: "Recalibrate" is the longest single word that must fit a 256 px card, and its peers match it.
9. **Top-weighted label cards at 200% on 1280×720.** The motif sits at a fixed height so the dwell ring never moves between faces, and the letter cards need that room for two rows; label cards on that one size and viewport carry their whitespace below the text.
10. **Linear write-back.** The repo asks for findings and decisions to be written to the natHacks Linear workspace; Linear needs authentication in this session, so nothing was written there. The round-5 and round-6 findings and the decisions in DESIGN.md are the material for that write-back.

### Proposals for `shared/` (not edited)

- `attachPointer`: stream the last position (and null when outside) at ~30 Hz; a still mouse otherwise reads as lost gaze after 600 ms, and one null on leave keeps the quadrant through blink grace.
- `listen`: report session end separately from final results (`onEnd`, `onError`), so callers can restart and back off.
- `speak`: accept `onWord(index)` from boundary events, with a timer fallback.
- `GazeEngine.activate`: an activation from a key replaces the latch on the pointer's action, so a resting pointer re-fires 300 ms later; a per-quadrant guard (as `src/gaze.ts` does) belongs in the engine.
- An owner-change guard in the engine: a quadrant whose action changes under a still gaze should not start a dwell until gaze leaves.

## Methods used

Read and applied (absolute paths):

- Workflow: `/Users/aamia/.codex/skills/t3-workflow/SKILL.md`, `.../references/routes.md`, `.../references/ui-quality.md`, `.../references/visual-evidence.md`, `.../references/orchestration.md`; pstack feature playbook `/Users/aamia/.agents/skill-libraries/pstack/skills/poteto-mode/playbooks/feature.md` (single owner: one code-coupled feature, no fan-out).
- UI rules: `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` (Verify a screen, below); `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md`; `/Users/aamia/clarte/skills/frontend-design/SKILL.md`; `/Users/aamia/clarte/skills/better-ui/SKILL.md` with `animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md`, `performance.md`; `/Users/aamia/clarte/skills/design-html/sections/doctrine.md`, `craft.md`; `/Users/aamia/clarte/skills/lintapple-ui/SKILL.md` (Lint Apple 0.1.24 run).
- Motion (Emil Kowalski set): `/Users/aamia/clarte/skills/review-animations/SKILL.md` and `STANDARDS.md` (table above), `/Users/aamia/clarte/skills/choreograph/SKILL.md` (DESIGN choreography table), `/Users/aamia/clarte/skills/animation-performance/SKILL.md` (metrics above), `/Users/aamia/clarte/skills/emil-design-eng/SKILL.md`, `/Users/aamia/clarte/skills/apple-design/SKILL.md`, `/Users/aamia/clarte/skills/break-ui/SKILL.md` (table above), `/Users/aamia/clarte/skills/find-animation-opportunities/SKILL.md`, `/Users/aamia/clarte/skills/remove-animations/SKILL.md`, `/Users/aamia/clarte/skills/animation-vocabulary/SKILL.md`.
- Council: `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/council/SKILL.md`.
- Project: `/Users/aamia/clarte/AGENTS.md`, `prototypes/UI/v0/README.md`, `BRIEF.md`, `MOTION.md`, `RESEARCH.md` (and `research/lane2` F16–F20, `lane3` §18 and §3, `lane6` §3), `s0/DESIGN.md` and `clarte-light.html`, every reference image.
- Not available: Linear (natHacks research memory) is not authenticated in this session; nothing was read from or written to it.

### minimal-ui "Verify a screen" (compose, listening, suggested, speaking, menu, settings, calibration; 1440×900, 1280×720, 200%)

1. Major thing: the message while composing; the live transcript while listening; the spoken sentence while speaking; the options in the menu. Each screen names it without "and".
2. Elements: six cards (each a separate gaze target by rule; not a box per item of one component), the state pill (minor, partner-facing), history (minor, quiet ink), hairline (separates said from saying). Nothing to move or remove.
3. Words: no text above titles; no explanatory text; hints are values ("Last group", "Accept", "Suggested"); calibration captions are the brief's required guidance.
4. Colour: group faces and inks (find the group), state pill (partner awareness), accent (dwell progress only), ink primary (the one primary action). Nothing else is coloured.
5. Containers: cards and the state pill only; no box inside a box (the ring is the instrument, not a surface).
6. Squint: compose lands on the message, then the ink card; groups read as a calm row.
7. Capability: everything in the six capabilities is reachable within two selections from the screen where it matters, except mid-message (declared, above).
