# Style 4 · Split: report

A 2×2 letter keypad on the left (Q1 Q2 Q5 Q6), the primary card (Q3) and the second card (Q4) top right, and the conversation in Q7 + Q8, which are rest in every state. Built twice on 2026-11-07: first in the style's own warm-paper skin, then redone for the owner's shared light skin and MOTION.md bar. This report describes the redo; the first build's council round is kept as round 1.

## Run it

```sh
cd prototypes/UI/v0/s4
npm install
npm run dev          # http://localhost:5104 (strict port)
npm run build        # tsc + vite build
node ../shared/selftest.ts
node ../shared/check-layout.mjs http://localhost:5104 evidence/layout
```

- First load runs the calibration (Escape skips; it is remembered). `?phase=<name>` opens any state listed in `src/debug.ts`; `?partner=script` uses the scripted partner instead of the microphone.
- Mouse = gaze; keys 1–8 select Q1–Q8; Space/Enter confirms in Dwell + key mode or activates the focused card; Escape cancels or steps back; backquote toggles the developer overlay (dev only).
- `window.clarteDebug = { phases, phase(), setPhase(name), validate(), engine, settings(patch), state(), replace(state) }`.

## What was built

- Vite 8 + React 19 + TypeScript, plain CSS with tokens in `:root`, inline SVG icons, Satoshi 500/700 from Fontshare. Imports `../shared/*.ts` directly; `shared/` is untouched.
- The whole screen is data: `layoutOf(state)` in `src/model.ts` derives what each of the six positions offers in every state, so the quadrant map is fixed by construction and only labels change. One reducer; side effects (listening, speech, the Say again window) follow the state.
- Conversation loop: Listen (Web Speech in Chrome; scripted partner when recognition is unavailable or fails) → type with the four groups (word in progress via `pendingGlyphs`) → accept the candidate → More → Other word / Delete word → Speak with the spoken word highlighted → Say again for 6 s (held while Q3 is looked at) → Listen. One moment speaks the floor-holder without touching the message (and is filtered out of the partner's transcript). Spell (group → pair → letter) for names, from Menu or from Q3 when the groups match no word.
- Menu: Phrases (two pages), Spell, Settings (letter and button dwell, text size to 200%, theme, sound, selection mode, word colour; Demo: gaze noise, repeat, partner microphone or script, overlay), Clear message, Recalibrate.
- Calibration per MOTION.md: position, nine points, four-point check, Ready.
- Partner awareness: a 6 px state strip on the top edge plus a status line; Web Audio earcons (letter tick, control tick, delete, phase up, phase down; no error tone).
- Accessibility: every card is a `<button>` with its visible text as its name, visible focus ring, keyboard path, `role=status` and `aria-live` for state and the message, reduced motion honoured, text to 200% without overlap (checked).

## Decisions beyond the original DESIGN.md

All recorded in `DESIGN.md` "Decisions made while building". The main ones:

| Decision | Why |
| --- | --- |
| Cards centred on each quadrant column, 304 × 352 at 1440 × 900, gutters 56 px (columns) and 116 px (rows) | The quadrant is the hit region; the label at the column centre is farthest from any grid line; widest gap on the row boundary (R-1, R-4) |
| No slab around the keypad | A box around boxes (minimal-ui rule 6); the mock floats its cards bare |
| Q3 always the ink card, Q4 always white | One primary target with the strongest contrast; faces never change between states, so mean luminance stays constant (R-4) |
| Two-circle motif on group cards; the same ring around each control icon | Owner's visual direction; the dwell ring is an instrument present at rest |
| Arc as two composited half-ring rotations (Web Animations) | MOTION.md acceptance 8: the first SVG `stroke-dashoffset` arc repainted every frame and wrote a style attribute the shared layout tracker observes |
| Letters 32 px at 1440 (28 px below 1400 px wide), tracking +0.10 em | All eight letters of G–N fit, every group the same size (peers look alike), never below 28 px except wrapping at large text |
| Q4 is More (except mid-word and speaking) | Round 1: One moment, Menu, Phrases, Spell were unreachable while composing; every function now has one home |
| Spell replaces "Keep" when no word matches | Round 1: Keep could speak internal group ids |
| Dwell setting = arrival to commit | Round 1: hold + dwell made 600/900 read as 750/1050 |
| Satoshi from Fontshare | Owner's type decision; without the network the system sans takes over |

## Evidence (all opened and looked at)

Under `evidence/`:

| File | What it shows |
| --- | --- |
| `side-by-side-mock.png` | The owner's mock (left) and this style's compose screen (right) at 1440 × 900 |
| `walkthrough/walkthrough.webm` | The full user path, recorded: first-run calibration skipped with Escape, Listen (mouse dwell), scripted partner, More → One moment, Stop, type "not" by gaze (decodes as "now"), accept, More → Other word ("not"), keys only "now maybe later", Speak with highlight, Say again, More → Menu → Settings → Demo → gaze noise on, type with noise, overlay on with the pointer wandering over the Q1/Q2 line, More → Menu → Recalibrate, Escape. Inspected by frame sheets across the clip |
| `walkthrough/*.png` | `calibration-position`, `idle`, `listening`, `dwell-ring` (arc half-way on G–N), `composing-pending`, `after-decode`, `more` (the word to fix underlined, "Not" offered), `composing-ready`, `speaking` (pill on the spoken word), `spoken` (Say again), `menu`, `menu-settings`, `menu-demo-noise-on`, `overlay-dead-band` (overlay: Q7/Q8 rest, pointer on the line, layout ok) |
| `walkthrough-log.txt` | Step log with every asserted phase; dead band: 40 samples across x = 360 ± 22 px, quadrant Q1, 0 flips |
| `motion/motion.webm`, `motion/events.json` | A 26 s clip for frame-by-frame review; the second of each event in the video, aligned to a black sync mark found in the encoded frames (the page clock ran 0.12 s ahead of the video) |
| `motion/sheet-commit.png` | 40 ms steps through a letter dwell: no change for about 170 ms, one face step, even arc, bloom and click on the commit frame, no layout shift |
| `motion/sheet-drain.png` | A look that leaves early: the arc drains back over about 150 ms |
| `motion/sheet-keyboard.png` | Key 6: the glyph appears, no bloom, candidate cross-fades in 150 ms |
| `motion/sheet-phase.png` | Listen: one cross-fade, keys go quiet, red strip and status, label held until the eyes leave |
| `motion/sheet-calibration-entry.png` | 40 ms steps through Menu → Recalibrate by gaze: the outgoing menu fades out over the static calibration canvas while the position ring fades in, one cross-fade, no blank frame |
| `motion/sheet-calibration.png` | 250 ms steps through two calibration points: caption types, guide travels with one easing, the ring fills at the settle, bloom, beat |
| `motion/reduced-*.png` | A dwell under reduced motion: no arc, the ring steps in opacity |
| `luminance.json` | Mean relative luminance of every phase at 1440 × 900: 0.797–0.836 everywhere, calibration included |
| `source-fingerprint.json` | SHA-256 of every source and script file at the moment this evidence was generated |
| `motion/reduced-calibration-*.png`, `motion/reduced-times.json` | A calibration target under reduced motion: the guide jumps, the ring appears in opacity steps; the time each frame was actually taken |
| `perf-dwell.json` | Chrome trace counts: idle, no paint or layout; arc filling 320–560 ms after arrival: 1 layout and 2 paints (0.1 ms together, at the end of the focus step); steady fill 420–580 ms: 0 layouts, 0 paints, 10 small style recalcs (0.5 ms, the animation ticks); commit + bloom: about 28 paints and 4 layouts (under 1 ms) from the face colour step and the label cross-fades |
| `layout/*.png`, `layout-check.txt` | Shared check-layout over 22 phases × 2 viewports; frames that duplicate the walkthrough removed (the log lists all 44) |
| `rest-check.txt` | Q7 and Q8 rest in all 44 phase/viewport combinations |
| `variants/*.png`, `variants-check.txt` | 30 cases: 200% text (compose, More at 1280 × 720, the speech-error state), dark theme, Spell, calibration Ready, and every phase at 1280 × 720 and 200%; checks every label, value, ring, letter row and pip inside its card, the rest zone's children inside it, no word cut by the message edge, at least one whole message line, and the phase actually shown |
| `break-ui/*.png`, `break-ui.txt` | Worst-case data (below) |
| `lintapple-policy.json`, `lintapple-results.txt` | Lint Apple 0.1.24 with a project-derived policy: 20 phases, 1440 × 900 and 1280 × 720, light; all pass |

The T3 preview browser could not be used: `preview_snapshot` and `preview_recording_start` timed out on the app and on example.com alike (tabs reported `visible: false`), so screenshots and recordings were made with Playwright from the style's own `node_modules`. In both recordings a speech-synthesis test double (same interface: start, word boundaries, end, at a speaking pace) replaces headless Chromium's synthesizer, which ends utterances at once; the app's real success path is what the videos show. The evidence folder is about 9.4 MB, of which about 4.6 MB is the two recordings; layout frames that duplicate the walkthrough were deleted.

## Checks

```
npm run build                         ✓ (tsc --noEmit + vite build)
node ../shared/selftest.ts            all checks passed
check-layout.mjs                      layout ok in every phase (44 ok: 22 phases × 1440x900, 1280x720)
scripts/rest-check.mjs                44 ok (Q7 rest · Q8 rest everywhere)
scripts/variants.mjs                  30 ok
scripts/break-ui.mjs                  16 ok
scripts/walkthrough.mjs               walkthrough complete
lintapple 0.1.24                      20/20 phases passed at both viewports
```

## Against the mock (owner's minimum bar)

`evidence/side-by-side-mock.png`, both at 1440 × 900.

| Axis | Verdict |
| --- | --- |
| Whitespace | Matches: same canvas, cards of the same size class floating with 56/116 px gutters, a bare conversation zone |
| Type scale | Matches: message 52/700 (the mock's size), Q3 label 44, Q4 40; the mock's 64 px "A–F" anchor is gone by the owner's later decision, replaced by 32 px letter rows under a 64 px motif |
| Radius | Matches: 40 px cards, round rings and dots, pill highlight for the spoken word |
| Colour restraint | Matches or beats: the same tokens; the word in progress uses group inks on letters and tertiary ghost letters (the mock uses three coloured dots); accent only on dwell |
| Finish | Matches, and on secondary pages now too: hairline-clean, no shadows, no borders, an icon in every ring, labels on one baseline per row; the arc's seam ticks (at rest, then while filling) were found and removed |

Overall: matches the mock. The one difference is composition: the mock sets labels bottom-left in each card; this style centres the ring and label in each card because the brief asks for the progress indicator centred on the tile and the label centred (focal point at the hit region's centre, R-1 §25).

## review-animations (on this build)

| Before | After | Why |
| --- | --- | --- |
| SVG arc driven by `--progress` written to a style attribute each frame | Two half-rings rotated by Web Animations (`src/gazeVisuals.ts` `Arc`) | GPU-only properties; the per-frame style write also woke the shared layout tracker |
| Arc and track visible at rest with clipped half-ring edges | `.arc` hidden unless `[data-dwell]`, hide delayed 150 ms for the drain (`src/styles.css` `.arc`) | Hairline artefacts at 12 and 6 o'clock on every card |
| Candidate relabel used the 300 ms phase cross-fade with a 100 ms delay | 150 ms, no delay, for candidate → candidate (`.is-quick`) | Frequent event; the phase timing left a blank frame |
| Bloom on keyboard selections | Skipped when a key went down in the last 80 ms | No motion on keyboard-triggered actions |
| Primary relabel under the eyes after a selection | Held until the card is no longer latched (`src/Tile.tsx`) | A label must not change under an armed or just-used target (apple-hig-ui, R-6) |

Kept, with reasons: the bloom is 450 ms on every commit (above the 300 ms UI rule and on a 100+/day action) because MOTION.md specifies it as the one celebration, it runs on a composited layer, never blocks input and never moves layout; the calibration guide's 1200 ms travel is a rare, first-run motion; content cross-fades are keyframes (one-shot enter/exit, not interrupted mid-flight; a rapid relabel replaces the leaving copy). No `transition: all`, no `ease-in`, no `scale(0)`, no hover motion (there is no hover styling at all), reduced motion keeps opacity and colour only.

Verdict: Approve.

## break-ui (on this build)

| # | Severity | Field | Worst-case value | What happened | Fix (applied) |
| --- | --- | --- | --- | --- | --- |
| 1 | Broken | spelled name | "Wisniewskakowalczyk" | Ran out of the rest zone at 100% | The spelled word fits the zone by character count |
| 2 | Broken | candidate in Q3 | "uncomfortable" at 200%, 1280 × 720 | Overflowed the card | Labels fit their longest word, in 4 px steps |
| 3 | Broken | message | a 13-letter word at 200% | Left the rest zone | `overflow-wrap: anywhere` breaks only a word wider than the line |
| 4 | Ugly | fitted label sizes | "Recalibrate" at 1280 | 40.12 px, off the type scale | `round(down, …, 4px)` |
| 5 | Fragile | partner turn | a 45-word turn | Clamped to two lines (one at large text) after listening; the full turn is shown only while listening | Kept: the last partner turn stays visible but must not displace the message; open question below |

Clean: twelve groups with no word (one dot per group, wraps), a one-letter message ("I"), a long message (whole-line tail), speaking a late word in a long message (scrolls to keep the spoken word in view).

## minimal-ui "Verify a screen" (compose, listening, speaking, More, menu, calibration; 1440 and 1280; 100% and 200%)

1. Major thing: the message while composing (52 px, the darkest text), the transcript while listening, the spoken sentence while speaking, the page title in menus, the targets in calibration.
2. Elements: four group cards, Q3, Q4, status line, partner turn, hairline, message. None removable without losing a function; the status line is the partner cue's text twin.
3. Words: no text above a title; card labels are verbs or values; the only sentence is the speech-failure error. "Other word" under the offered word names the action (it is not a restatement).
4. Colour: group inks (telling groups apart), the strip and status dot (state), accent (dwell progress only), red (recording and error).
5. Containers: one surface per action, none nested; the rest zone has no box.
6. Squint: the message, then the ink card, then the keypad. In idle (no message) the keypad leads, which is right for an empty draft.
7. Capability: all six capabilities within one or two selections from where they matter, mid-word excepted (below).

Finding kept and justified: the empty ring on menu items reads a little like a radio button; it is the same ring as everywhere (the instrument, also the calibration target), so it stays.

## better-ui "Before you finish"

No same-radius nesting (the card is the only surface; the motif ring is a circle). No `transition: all`. No keyframes on toggled state except one-shot enters. No `scale` below 0.96 and no press scale at all (gaze: nothing moves under an armed target). No hover styles. Theme switch suppresses transitions. `will-change` only on the arc halves and the bloom. Icons use `currentColor` (the recording dot uses the state colour token). No scrolling overlays.

## Council

Members: Claude Opus 5.5 (effort high) and GPT-6.1 Sol (reasoningEffort max, serviceTier priority), started in parallel with `delegate_task`, read-only.

Round 1 asked for one score; from round 2 the brief asks for two (design and interaction; craft and motion).

| Member | Round 1 (first build) | Round 2 (redo) | Round 3 | Round 4 | Round 5 |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | 6.5/10 | design 8, craft 7 | design 8, craft 7.5 | design 8.5, craft 7.5 | design 8.5, craft 8 |
| GPT-6.1 Sol | 6.5/10 | design 8, craft 7 | design 8, craft 7.5 | design 7.5, craft 8 | design 7.5, craft 8 |

The rounds stopped at round 5: the owner's limit of four rounds after the redo (rounds 2–5) was reached before either member gave craft 9. Sol reviewed the build with Opus's round-5 fixes applied; the fixes made for Sol's round-5 findings have not been re-scored. Both members, in every round from 2 to 5, judged the compose screen to match the mock; neither said it beats it.

### Round 1 → changes

Applied: Q4 More page (capability while composing), fixed positions (Back in Q4 everywhere, one home per function), whole-line message snapping and an honest variants check (it had passed vacuously twice; the check now asserts the phase shown), cancel a dwell when a slot's meaning changes without a selection, Say again held while looked at, double phase earcon removed, no fake partner after silence, floor-holder filtered from the transcript, tokens enlarged, re-arm shown by the held relabel, dwell = arrival to commit, Spell for no-word, Stop and speech failure keep the draft, repeat on letters only, pointer exit cancels, Composing kept during repair, word cross-fade fixed, luminance constant by construction (fixed faces), spoken message in secondary ink, disabled Add neutral, dark composing strip.

Declined: neutral tile boundaries at 3:1 (Sol) — the brief requires flat tiles without outlines; a card's extent is not information the person needs (selection is by quadrant, the label identifies it), and the dwelt card deepens one step. Default `redwell` (Opus) — the brief forbids auto-repeat; double letters cost one look away, and the held latch shows when a key has re-armed. Live-recognition restart on silence (Opus) — belongs in `shared/speech.ts` (proposal below).

### Round 2 → changes

Both members: the compose screen matches the mock; not yet beating it on secondary pages and the arc seam.

Applied: the word in progress no longer breaks mid-word at large text (Opus H1); the arc's halves hidden until their turn, no seam tick (Opus H2); "2 s" instead of "2. s" (M1); 150 ms relabels within a scene (M2); quiet keys without a content dip (M3); icons on every secondary-page ring and labels on a shared baseline (M4); ink focus ring (L1); instant spoken-word swap (L2); Menu keeps listening (L3); "Next" on page Q3 (L4); Escape closes More; the calibration guide appears only when it travels; flat arc ends in calibration; an outgoing fade for the conversation zone. Speech outcomes are honest: only the API's end event is "said" (Sol F1); a height budget for large text (F2); the message keeps a full line beside an error (F3); monotonic reduced-motion steps, including calibration (F4); no content motion after keyboard input (F5); Spell's group level prints letters (F6); an honest calibration result (F7). Lint found two more after these changes and they were fixed: the status line is ink (secondary rendered at 4.3:1 at 20 px), ghost letters `#7A7A7F` (tertiary rendered at 2.95:1). The variants check now also runs every phase at 1280 × 720 and 200% and the speech-error state, and fails when the message shows less than one line.

Declined or kept: keyframes for one-shot content cross-fades (Opus L5) — each change mounts a new element, and the leaving copy is replaced on a rapid change; no motion at all after keyboard input. Redwell progress on the arc (Opus L6) — redwell is a demo option for letter keys only. A 120 ms fade on a deleted glyph (Opus L6) — the glyph's place is taken by the ghost letter in the same frame, which already reads as a change in place. One moment mid-word (Sol) — kept as the documented exception: Delete stays one look while a word is being typed. Calibration luminance (Opus) — the app screen is about 9% darker than the calibration canvas because of the ink primary card the brief mandates; recorded.

### Round 3 → changes

Both members: compose matches the mock; craft held back by edge states.

Applied: Recalibrate ends listening (Opus H1); live listening restarts on Chrome's silence end and reports a microphone error instead of inventing partner words (H2); the arc freezes when the eyes leave and fades (not unwinds) after a commit (M1, M2); luminance across app states measured and held within 0.797–0.836 with a neutral page face and inactive items kept in place (M3); quick cross-fades without overlap (L1); clearer reduced-motion steps (L2); the calibration guide starts off-target and hides on arrival (L3, Sol F4); content centred at large text and the error dot aligned (L4); only accepted words announced (L5); calibration rings fill over the last 600 ms of the settle (Opus's reconciliation of MOTION.md). Keyboard-to-pointer switching no longer replays animations or blanks the message (Sol F1, verified by probe: every content layer stays at opacity 1, no animation running); the highlight schedule starts on the voice's start (F2); Menu and Spell show recording status and notices (F3). Lint then found page values at 4.34:1; fixed with `#5F5F64`.

Declined or kept: the calibration screen's luminance (0.91 against 0.80 in the app; MOTION.md asks for the bare light canvas and the app's ink card is mandated); the mid-word exception for One moment and Menu; Spell's second entry from Q3 when no word matches (the forward action for a word the decoder does not know).

### Round 4 → changes

Both members: matches the mock; Opus found the round-3 arc freeze could still commit, Sol found a keyboard press could speak behind a held label.

Applied: the arc freezes only in the engine's grace and never blinks (Opus H1, M1); network/unsupported-language errors and a restart cap end listening with a notice (M2); the calibration guide cross-fades (L1); the Listen icon in ink, red only for recording (L2); no transitions under keyboard input (L3); no `data-action` on blank cards (L4); events marked against the video's start and the motion clip recorded at 1440 × 900 (L6); calibration fills over 450 ms, the visible letter arc (L7); two message lines at 200% on 1440 × 900 (Opus's design-9 ask). A key on a held card only releases its label (Sol F1, verified: first 3 shows "Speak" and speaks nothing, second 3 speaks); recording status stays visible in words at large text (F2); Composing until the voice starts (F3); calibration's bare screens at the app's measured luminance, so every state is 0.797–0.836 (F4); every piece of evidence regenerated against one recorded source fingerprint, with reduced-motion calibration frames (F5).

### Round 5 → changes (last round)

Opus: design 8.5, craft 8; compose matches the mock and does not clearly beat it.

Applied:
- **H1:** a look resting on Stop as speech ended spoke the message again with no new look. The engine restarts a dwell under the same eyes after the meaning-change cancel. A card whose label changes under the eyes is now stale: it shows no progress and its gaze selection is ignored until the eyes leave. A key press still acts at once. Verified by probe: speech ends 300 ms into a dwell on Stop, the card reads Say again, and 2.85 s of resting there shows no progress and speaks nothing; after the eyes leave and return, it speaks.
- **M1:** calibration no longer flashes on entry. The canvas tone is static and only the scene on it fades. On exit, the keys fade in with the 300 ms phase cross-fade. Measured from a recording: entry luminance 0.814 → 0.809 with no peak (was 0.870 → 0.946 → 0.912); exit keypad opacity 0 → 0.97 → 1 under gaze (instant under keyboard input, by design).
- **L1:** the status line fades in over 150 ms.
- **L3:** at large text the Q4 label grows to at most 1.4×, so Back, More and Delete never out-shout Q3 at 200%.
- **L4:** the reduced-motion frames are timed from one start, and the time reached is recorded in `motion/reduced-times.json` (each within 2 ms).

Sol: design 7.5, craft 8; compose matches the mock on all five axes ("Overall: matches the mock"). Its review froze the build after the fixes above (`81688e80…`).

Applied:
- **F1 (HIGH):** an armed keypad offer could change meaning and commit the replacement. A transcript or context change turned More's Other word from "Now" to "How" mid-dwell. The meaning-change guard covered only Q3 and Q4; it now watches every card. Verified by probe: the offer changes from "never" to "not" 500 ms into a dwell, the dwell cancels, and 2.5 s of resting there commits nothing. A fresh look then commits "not".
- **F2:** a click or screen-reader activation on a stale card was silently ignored. Explicit activation now clears the stale mark and acts on what the card shows. A click on a card still showing its previous label only releases the label, as a key press does. Verified: after a gaze accept, a click on Speak speaks, and a second click on Stop stops.
- **F4:** entering calibration cut the outgoing scene in one frame. Entering or leaving calibration now keeps an inert, unanimated copy of the outgoing stage, with no `data-action`, so neither the engine nor the layout check sees it. The copy fades out over 150 ms while the incoming scene fades in on the static canvas. There is no motion under keyboard input. `motion/sheet-calibration-entry.png` shows one cross-fade with no blank frame. The clip now enters calibration by gaze through Menu → Recalibrate.
- **F5:** the event clock was not the video clock. The clip now opens with a 400 ms black sync mark, finds its end in the encoded video, and shifts every event by the difference (−0.12 s). Each sheet starts from the aligned time.

Declined:
- **F3:** keep More in Q4 mid-word, with Delete inside More. This makes the most frequent repair, Delete mid-word, two selections instead of one, to bring One moment and Menu from three selections to two. The trade-off is documented in DESIGN.md and was raised and kept in rounds 2–4; it stays an open question for the owner.

Not fully verifiable here: click audio synchronisation (headless recordings carry no audio stream) and the literal ten consecutive compose loops of acceptance 10. In acceptance 8's 320–560 ms window, the one layout and two paints (0.1 ms) are the focus step's face colour change at the start of that window; the steady fill shows zero layouts and paints.

Kept: Q3 is the ink card on Menu and More pages too (L2). Fixed faces are what hold every state at 0.797–0.836 luminance. The roughly 350 ms leave lag is the shared engine's hold plus grace (proposal 4).

## Proposals for `shared/` (not edited)

1. `gaze.ts` `attachPointer`: resample the last pointer position at the tracker rate (a still mouse currently goes stale after 600 ms, before any dwell completes). See `src/pointerStream.ts`.
2. `overlay.ts`: exclude the overlay layer from `trackActionables`' observed subtree, or skip redraws when the report is unchanged; once visible it currently freezes the page. See `mountOverlayOutsideBody` in `src/App.tsx`.
3. `gaze.ts`: per-action `dwellMs` and `repeat` (a function of the action id), instead of one global value that styles switch as the gaze arrives.
4. `gaze.ts`: count the quadrant hold inside the dwell, or document that commit = hold + dwell; and note that a look leaving within about 300 ms of commit still commits (150 ms hold for the new quadrant + 150 ms grace).
5. `speech.ts`: `speak` with word-boundary callbacks and distinct end / cancel / error outcomes; `listen` restarting recognition when Chrome ends it after silence while the session is still open, and reporting fatal errors instead of swallowing them (see `listenLive` in `src/voice.ts`).
6. Brief palette: P2 G3 `#BB80C2` and G4 `#B38F39` measure 2.69:1 and 2.72:1 on `#F5F2EC` (moot for the new skin; relevant if P2 returns as a fallback).

## Open questions and what the brief asks that this style does not fully do

- Mid-word, One moment and Menu are two selections away only after the word is accepted or deleted (Q3 is the candidate, Q4 is Delete). Delete stays one selection mid-word because it is the most frequent repair.
- Other word replaces the last word directly (2 selections) instead of reopening it as pending groups; editing one group of an accepted word means Delete word and retype.
- The partner's long turn is clamped after listening (two lines, one at large text).
- Calibration runs about 44 s at MOTION.md's pacing; its bare screens use a canvas tone matched to the app's luminance rather than the brighter empty canvas (the brief says about 30 s; MOTION.md says about 40 s).
- The bloom fires on every commit (MOTION.md) although review-animations would drop motion on a 100+/day action.
- Live microphone recognition and audible speech were not verified (headless); earcons were not listened to.
- Linear (the natHacks research memory) needs authorisation in this session, so nothing was read from or written to it.

## Methods used

- T3 workflow router and references: `/Users/aamia/.codex/skills/t3-workflow/SKILL.md`, `references/routes.md`, `references/ui-quality.md`, `references/visual-evidence.md`, `references/orchestration.md` (under `/Users/aamia/.codex/skills/t3-workflow/`).
- pstack feature playbook: `/Users/aamia/.agents/skill-libraries/pstack/skills/poteto-mode/playbooks/feature.md` (single owner: one tightly coupled folder; the council supplied independent review).
- Owner's rules: `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` (Verify a screen, above).
- Repository skills: `/Users/aamia/clarte/skills/frontend-design/SKILL.md`; `/Users/aamia/clarte/skills/better-ui/SKILL.md` with `animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md`, `performance.md`; `/Users/aamia/clarte/skills/lintapple-ui/SKILL.md` and its `references/upstream-readme.md` (run, above); `/Users/aamia/clarte/skills/design-html/sections/doctrine.md`, `craft.md`; `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md`; `/Users/aamia/clarte/skills/review-animations/SKILL.md` and `STANDARDS.md` (table above); `/Users/aamia/clarte/skills/choreograph/SKILL.md` (event casting in MOTION.md terms); `/Users/aamia/clarte/skills/break-ui/SKILL.md` and `CATALOG.md` (table above); `/Users/aamia/clarte/skills/animation-performance/SKILL.md`, `emil-design-eng/SKILL.md`, `apple-design/SKILL.md`, `find-animation-opportunities/SKILL.md`, `remove-animations/SKILL.md`, `animation-vocabulary/SKILL.md` (read for their rules; applied through the review above).
- Council: `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/council/SKILL.md`.
- Project: `/Users/aamia/clarte/AGENTS.md`, `prototypes/UI/v0/README.md`, `BRIEF.md`, `MOTION.md`, `RESEARCH.md`, `research/lane6-motion-feedback-ux.md` §3, `s0/DESIGN.md`.
