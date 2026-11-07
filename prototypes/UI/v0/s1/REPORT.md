# Style 1 · Rails: report

## What this is

Style 1 builds the team's first sketch. Controls sit on the top rail (Q1–Q4), the conversation in the middle band, and the four letter groups on the bottom rail (Q5–Q8). It has no rest zone while composing, so the default selection is look-to-preview, then Space (a blink, in the product) to commit.

It is drawn in the owner's shared light skin, revised on 2026-11-07:

- **Floating cards.** Cards float in a `#F5F5F7` canvas. The letter groups have pastel faces and print all their letters. The one primary target is an ink card.
- **Dwell ring.** A thin ring fills clockwise in `#0071E3` while you look, and blooms on commit.
- **Word in progress.** The word you are typing shows as the live best decode in group inks.
- **Calibration.** Built to MOTION.md's sequence, about 50 s in all.

All six capabilities are implemented:

- Listen / Pause / Respond / End;
- the candidate word;
- Delete, with reopen;
- Speak, with Say again;
- One moment;
- Menu: Phrases, Clear message, Recalibrate, Selection and Display settings, all ten settings the brief lists.

Spell is designed (DESIGN.md) but not built.

The full set of decisions, with reasons, is in [DESIGN.md](DESIGN.md) under "Decisions made while building".

### Run it

```sh
cd prototypes/UI/v0/s1
npm install
npm run dev          # http://localhost:5101 (strict port)
```

- **Scripted partner:** add `?partner=script` to always use the scripted partner instead of the microphone.
- **Calibration:** first run opens calibration; Escape skips it.
- **Simulator:** the mouse is the gaze. Space or Enter confirms a finished preview, and keys 1–8 select Q1–Q8.
- **Developer overlay:** the backquote key shows it.
- **Debug hook:** `window.clarteDebug` exposes `phases`, `phase()`, `setPhase()`, `validate()` and `engine`.

### Re-run the checks

```sh
npm run build                                                   # tsc + vite build
node ../shared/selftest.ts                                      # shared engine checks
node ../shared/check-layout.mjs http://localhost:5101 evidence/layout
node scripts/walk.mjs http://localhost:5101 evidence/walk       # full loop, gaze + noise, then keys
node scripts/states.mjs http://localhost:5101 evidence/states   # 200% long word, voice failure, dark
node scripts/motion.mjs http://localhost:5101 evidence/motion   # frame strip + performance trace
node scripts/compare.mjs http://localhost:5101 evidence/compose-vs-mock-1440x900.png
node scripts/verify.mjs http://localhost:5101                   # council regressions, rounds 3–6 (20 checks)
node scripts/luminance.mjs evidence/layout                      # mean luminance per phase
```

## Decisions beyond DESIGN.md

DESIGN.md records every decision. The ones that go past its original text, and why:

- **The ring is built for the compositor.**
  - *Problem:* the first ring animated an SVG `stroke-dashoffset` and wrote a custom property to `<html>` each frame. A Chrome trace showed a full-viewport repaint and a style recalc every frame.
  - *Fix:* the arc is now two clipped half-rings rotated with Web Animations (transform only).
  - *Clock:* the engine is advanced by a 16 ms timer instead of the shared requestAnimationFrame loop. A rAF loop forces a main frame every frame, and Chrome then re-styles even composited animations (proved on a bare page: 18 recalcs with a rAF loop, 0 without).
  - *Result:* while the arc fills, 0 layout, 0 paint and 2–3 style recalcs in 270 ms.
- **The quadrant latch** (style-side, proposed for `shared/gaze.ts`).
  - *Problem:* the engine guards the selected action, not the place. In Rails a selection often relabels the card under the gaze: Speak becomes Stop, Menu becomes Recalibrate. A long look or a blink could fire the new label.
  - *Fix:* after a gaze selection, a different action in that quadrant cannot preview or fire until the gaze leaves it.
- **Delivery is true.**
  - *Rule:* only a voice that reports its end counts as spoken. An error, a voice that never starts, one that never ends, or no speech synthesis at all keeps the message and shows "The voice did not play".
  - *Stopping:* a stopped message stays unsaid.
  - *Testing:* the headless walkthrough supplies a stand-in voice from the test harness, never from the app.
- **End is inert while groups are pending,** so a reply can never lose typed input. Accepting or deleting the pending groups wakes it.
- **The candidate's action id carries its word** (`autocomplete:good`). A candidate that changes under a preview is a new target, so the preview cancels rather than accepting a different word.
- **Rest.** The groups are quiet (not actionable) while idle, listening and paused. So reading the partner's words has only two actions on screen.
- **Confirm-only Repeat.** "Keep looking" (redwell) applies in dwell mode only. In confirm mode it would fire without a confirm.
- **`rearmMs` is 0.** Leaving a quadrant already takes the engine's 150 ms hold, which is the guard against re-firing. The extra 300 ms re-arm only delayed the next target's dwell.
- **No motion on digit keys.** A digit-key selection marks the page as keyed until the pointer moves, so transitions run at zero and the bloom is skipped.

## Evidence

Every file listed was opened and looked at before it was listed here. The folder is about 3.3 MB.

| File | What it shows |
| --- | --- |
| `evidence/compose-vs-mock-1440x900.png` | The compose screen beside the owner's light-direction mock, at the same viewport |
| `evidence/layout/*.png` | Every phase from the layout check: all 18 at 1440×900 and 10 at 1280×720 (8 redundant ones deleted for size) |
| `evidence/layout-check.txt` | The checker's output (below) |
| `evidence/walk/01-calibration-position.png` | First run: the position ring and the typed caption pill with its key word |
| `evidence/walk/02-calibration-points.png` | The nine 28 px outlined targets, the caption pill beside the first, and the guide dot travelling to it |
| `evidence/walk/03-idle.png` | Idle: Listen as the ink primary, More; everything else rests |
| `evidence/walk/04-listening.png` | Listening: the orange recording pill and the partner's words as the major thing; the groups are quiet |
| `evidence/walk/06-dwell-in-progress.png` | A group mid-dwell: face one shade deeper, accent arc part-way round, the word in progress "Who" in group inks |
| `evidence/walk/07-composing-pending.png` | Five groups typed: the decode "Tired" in group inks and the candidate "tired" in the ink card |
| `evidence/walk/09…11` | The message; Delete reopening the last word at its next candidate ("more"); accepting the other word |
| `evidence/walk/13-speaking.png` | Speaking: the ink pill, Stop as the only action, the spoken word in the pill highlight and the rest waiting in secondary ink |
| `evidence/walk/14-say-again.png` | After Speak: page 2 offers Say again (caught mid-cross-fade, label still fading in) |
| `evidence/walk/15-one-moment.png` | The floor-holder spoken in place of the message |
| `evidence/walk/19-keys-only-speaking.png` | The keys-only pass reached Speak and Say again |
| `evidence/walk/walk.webm` | The full loop: calibration → Listen → Pause → Respond → "tired but good" with webcam noise on → Delete/reopen → Speak → Say again → One moment → Menu → End → Recalibrate → keys-only pass. Inspected by frames extracted across the clip. |
| `evidence/states/text-200-long-word-1280.png` | 200% at 1280×720 with the 11-group "appointment": the partner's turn kept, the decode whole, nothing clipped |
| `evidence/states/voice-failed.png` | Voice failure: the red-text pill "The voice did not play", the message kept, Speak under Q1 |
| `evidence/states/dark-reduced-motion-dwell.png`, `dark-listening.png` | The optional dark theme; under reduced motion the dwell is a whole ring stepping in opacity |
| `evidence/motion/dwell-frames.png` | MOTION scrub at about 50 ms per frame: intent delay, the one-step cue, the even clockwise fill, the preview, the Space commit with its bloom, the re-arm, then a dwell left at about 70% that pauses and drains |
| `evidence/motion/screen-change-frames.png` | Opening Menu by gaze and Space: the outgoing screen, labels whole and the Menu card's ring solid, fades out by about 140 ms while the menu fades in from 100 ms, in place |
| `evidence/motion/dwell-trace.json` | Performance trace of a stationary dwell, in two windows: the counts, every raw Layout, UpdateLayoutTree, Paint and PrePaint event with its arguments, and the source fingerprint `13b663a499aa…` (sha256 over `src/`) it was measured on |
| `evidence/verify.txt` | The regression checks for every verified council defect, rounds 3 to 6: all 20 kinds pass (58 lines) |
| `evidence/luminance.txt` | Mean luminance of every layout screenshot |

### MOTION acceptance, from the frame strip and the trace

| # | Item | Result |
| --- | --- | --- |
| 1 | Idle is still | Pass. Trace at rest: 0 style recalcs, 0 layout, 0 paint. |
| 2 | First 150/250 ms show nothing; one-step cue; even fill | Pass. Frames 1–159 ms are unchanged. The face steps at about 160–210 ms. The arc grows evenly to full by about 600 ms. After a glance away and back it resumes from its drawn angle; the largest step between samples is 26° (check 13; before round 5 it jumped about 90°). |
| 3 | Leaving drains the arc | Pass. While the engine still holds the dwell (150 ms quadrant hold plus 150 ms grace), the arc pauses and cannot preview or complete. Then it drains back over about 150 ms (strip, "left O–S" frames). |
| 4 | Commit: solid ring, click and bloom on one frame; no layout shift | Pass for the visual: the solid ring and the bloom appear in the first frame after Space, and the label and card do not move. The click plays in the same handler, but audio is not verifiable from frames. |
| 5 | A phase change is one cross-fade | Pass. Cards: the outgoing label fades out over 150 ms in the incoming label's cell. Screens: an inert copy, labels whole (check 14) and the chosen card's ring solid, fades out over 150 ms while the new screen fades in from 100 ms (screen-change strip). No slides, no staggers. Before round 5 the copy's labels blanked on its first frame. |
| 6 | Captions type at 30–35 ms per character, key word highlighted, one line at a time | Pass: 32 ms per character, a 180 ms rest after punctuation, the key word in accent at 14%. The pill holds its final width while typing (293 px throughout, `verify.txt`). |
| 7 | Guide dot travels with one easing; the calibration ring fills at the app's rate | Pass for the easing (`--ease-move`, 1200 ms) and the component (the same two-half ring). The settle is 1800 ms for calibration against 450–750 ms in the app, as MOTION specifies. |
| 8 | No layout or paint during a dwell beyond the ring | Pass: 0 layout in both windows. While the arc fills, 0 paint and 3 style recalcs of 2 elements each. At arrival, 3 paints, all in the cue's first frame: the two sweep layers (the ring itself) and one document paint record. Before round 5 the end of the cue's transition de-promoted the cue layer and the ring svg and laid out the whole document; both now hold a standing layer. Raw events with arguments are in the trace file. Measured on source `13b663a499aa…`. |
| 9 | Reduced motion conveys the same | Pass: a stepped opacity ring, no bloom, cross-fades only (dark-reduced-motion frame). A cancelled dwell fades out over 150 ms (check 15; before round 5 it vanished). |
| 10 | The 50th-use test | Not measurable by the builder alone. A group selection costs 600 ms of dwell plus the confirm, and nothing else moves. |

## Layout check

`node ../shared/check-layout.mjs http://localhost:5101 evidence/layout`, 18 phases at both viewports:

```
(see evidence/layout-check.txt)
ok   1440x900 calib-position … worst-nomatch   (18 of 18)
ok   1280x720 calib-position … worst-nomatch   (18 of 18)
layout ok in every phase
```

`node ../shared/selftest.ts`: all checks passed. `npm run build`: passes.

## The owner's bar: compose screen against the mock

`evidence/compose-vs-mock-1440x900.png`, my verdict:

| Axis | Verdict | Why |
| --- | --- | --- |
| Whitespace | Matches | Floating cards on the same canvas with the same 56 px gutters. A calm middle band and empty canvas around every card. |
| Type scale | Matches | Satoshi 700. 36 px tracked letter rows as the group's primary label (stronger than the mock's 22 px row, which the owner's correction makes primary), 40 px control labels, a 52 px candidate, a 52 px message. The mock's 64 px "A–F" is gone by the owner's decision. |
| Radius | Matches | 40 px on every card, as in the mock. |
| Colour restraint | Matches, arguably beats | Neutral surfaces. Group hue on faces and inks only. Accent only on the dwell ring. One ink primary. The state pill is the one extra element; the mock has a quieter grey status line. |
| Finish | Matches, short of the mock in one respect | The motif, thin glyphs and hairline are as precise. Rails keeps the sketch's middle band, so its cards are 216–248 px tall against the mock's 368. They read as a deck of cards rather than the mock's tall portrait cards, which is a property of the layout, not of the skin. |

Overall: yes, it matches the bar; it does not beat it. In the final round (6) both members judged it to match on all five axes and to beat it on none (Opus: finish matches once the round-6 dot regression is fixed, which it now is).

## Council

Members: Claude Opus 5.5 (effort high) and GPT-6.1 Sol (reasoningEffort max, serviceTier priority). Each round was a fresh `delegate_task`, read-only.

| Member | Round 1 | Round 2 | Round 3 | Round 4 | Round 5 | Round 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | 6/10 | 6/10 | 7 / 7 | 8 / 7 | 8 / 7 | 8 / 6 |
| GPT-6.1 Sol | 6/10 | 6/10 | 7 / 6 | 7 / 6 | 7 / 7 | 8 / 8 |

Rounds 1 and 2 gave one score each. From round 3 on, the brief asks for two scores: design and interaction, then craft and motion. Both members judged the compose screen to match the owner's mock on all five axes in round 3 (Opus: "matches at rest, falls short in motion" on finish; Sol: matches). Neither was satisfied.

In round 4 both again judged the compose screen to match the mock (Opus: matches, does not beat it; Sol: matches). Opus's main finding was that the arc kept filling, and could complete, after the gaze left during the engine's grace. Sol's was that a quick click latched the wrong quadrant, so the card replacing the clicked one could fire under a still gaze.

In round 5 both said the compose screen matches the mock and does not beat it. Opus found that every screen change blanked the outgoing copy's labels on its first frame (acceptance 5), and that the arc jumped about 90° after a glance away (acceptance 2). Sol found that the round-4 latch still failed for a click from across the screen (12 of 12 trials fired Stop), and that the cue's end laid out the whole document (acceptance 8).

Round 6 was the fourth round after the owner's redo, the last the owner allowed. The stop rule (both members at craft 9 or better) was not met. Sol confirmed every round-5 fix, including 12 of 12 Q8 → Speak trials with no Stop, and scored 8 / 8. Opus confirmed its own round-5 findings fixed but found a regression my round-5 changed-letter fix introduced: a dot overlay that re-added itself about 8 times a second over the message after typing (craft 6, down from 7, "8 once F1 is fixed, 9 with F2 and F3"). Both said the compose screen matches the mock and does not beat it. Neither was satisfied. The changes after round 6 below were verified by me, not by a further round.

### Changes after round 1

Accepted:
- **Quadrant latch:** relabelled cards can't fire under the gaze.
- **Confirm key:** Space confirms only a finished preview.
- **Timing:** measured from gaze arrival.
- **Simulator gaze:** a still mouse re-samples, and leaving the window cancels at once.
- **Candidate:** Q2 rests without a real candidate.
- **Speech outcomes:**
  - Stop during End keeps the message.
  - Voice errors keep it and say so.
  - No timed Say-again return.
- **Phrases:** land on page 2.
- **Microphone:** never records the device's voice, and pauses for calibration.
- **Visuals:**
  - fill toward the centre, with a tone-step cue;
  - no dark slabs;
  - measured luminance;
  - flip labelled More / Back;
  - the 400 ms entrance;
  - the real screen-fade wrapper;
  - calibration reduced motion and a guide dot;
  - forced-colours borders.
- **Message:**
  - the partner line outside the scroll area, with whole lines only;
  - the sibling-layer cross-fade;
  - word-by-word phrase highlighting;
  - the experimental option labelled "(test)".

Declined:
- **Recolouring G3/G4:** these were then the brief's palette; that palette is now superseded.
- **A 3:1 outline on tiles:** the brief forbids outlines.
- **Flattening the menu:** eight quadrants can't hold about fifteen items.

### Changes after round 2

Round 2 reviewed the old skin, a few minutes before the owner's redo arrived. Its visual findings are answered by the redo:

- the shared skin is adopted;
- the dwell is an accent ring at 3.6–4.7:1 against what it sits on;
- the ink band became a pill.

Its interaction findings, all accepted:

- **Stale visual:** a direct selection no longer leaves a stale dwell visual.
- **Confirm key:** a preview owns it before a focused card does.
- **Redwell:** off in confirm mode.
- **Latch:** direct selections don't latch.
- **One moment:** resumes listening.
- **Failed floor-holder:** keeps what was last said.
- **Delivery truth:** only a reported end counts as said.
- **End:** inert while groups are pending.
- **Late results:** a late recogniser result is ignored.
- **Candidate id:** carries its word.
- **200% room:** the message room accounts for every sibling.
- **Re-arm:** `rearmMs` is 0.

Still declined:
- **Menu reach:** settings are four selections from composing. Recorded as an unmet part of the reach gate.
- **Labels at 200%:** single-word control labels stop growing at the card width. At round 2 the letter rows did not yet grow; that was built after round 3 (two lines, up to 57.6 px at 1440×900). The message and transcript grow fully.
- **Live-recognition end detection:** needs `ListenSession.onEnd` in `shared/speech.ts` (proposal below).

### Changes after round 3

All accepted. Each verified defect has a check in `scripts/verify.mjs`.

**From Opus:**
- **200% fit:** cards no longer overflow their rails at 200%. The candidate grows at most 1.15×, large-text mode shrinks the instrument and gaps, and the top rail keeps at least 144 px.
- **Confirm key:** a focused card takes Space or Enter only while the keyboard is driving, so a blink while reading can't fire a stale focus.
- **Leaving a dwell:** the arc pauses, a preview cancels and a completion is refused while the gaze is already elsewhere.
- **Letter rows:** they now break into two lines and grow at large text. Round 3 caught the REPORT claiming this before it was built.
- **Relabels:** the outgoing label cross-fades, and a quiet card keeps its label while it fades.
- **Interrupted speech:** counts as failed.
- **Focus ring:** ink, not accent.
- **Descender sliver:** masked once lines scroll away.
- **Blocked reasons:** muted End and Repeat say why in their accessible names (and on the card since round 6).
- **Clicks:** latch like gaze.
- **Latched ring:** keeps its 3 px arc and fades it out.
- **Calibration face ring:** colour transitions only.

**From Sol:**
- **Recording truth:** a voice failure while listening shows the error beside the recording pill.
- **Calibration at large text:** large-text ring rules are scoped to cards, so targets stay 28 px and concentric.
- **Keyboard suppression:** extended to the pill, its dot, captions, outgoing labels and the release fade.
- **Screen changes:** an inert copy of the outgoing screen fades out over 150 ms.
- **Cue:** the cue and the track step are opacity changes.
- **Caption pills:** reserve their final width.
- **DESIGN.md corrections:** the luminance claim (the worst-case phases exceed 10%), and that only G1's ink reaches Lc 75 on its face.

**Found by the builder:** the new cue layer briefly covered the card labels during a dwell. The motion strip caught it, and the labels now sit above the layer.

### Changes after round 4

Accepted. Each verified defect has a check in `scripts/verify.mjs` (checks 8–11).

**From Opus:**
- **Arc after leaving (F1):** the arc also pauses through the engine's own grace, when the gaze has left but no new quadrant is confirmed, so it can neither grow nor complete. Check 8 samples it every 20 ms.
- **Refused completion (F2):** a completion refused while the gaze was away is delivered if the gaze returns while the engine still reports it, so a card never looks committed with nothing done.
- **Top-rail alignment (F3):** every top-rail card centres its ring on one line, at 100% and 200% (check 9).
- **Large-text icon (F4):** 24 px inside the 40 px ring.
- **State pill (F5):** the outgoing pill fades out in place.
- **Candidate cross-fade (F6):** the outgoing word fades out in 80 ms and the new one fades in over 150 ms from 60 ms, so two words are never legible on top of each other.
- **Screen change (F7):** the outgoing copy fades linearly, so no frame dips to empty canvas.
- **Voice safety timeout (F8):** now cancels the voice as well as reporting failure.
- **Documentation (F10):** the dwell strip is about 50 ms per frame, calibration takes about 50 s, break-ui row 5 is masked, and DESIGN says the arc starts with the cue.
- **Also:** the still pointer is resampled every 16 ms, so the hold and grace see a steady stream.

**From Sol:**
- **Quick-click latch (F1):** the latch covers every quadrant the clicked card owns and clears only when both the engine's quadrant and the raw point have left (check 11).
- **Message at 200% (F2):** the scroller no longer shrinks below its whole lines, and at large text the partner's turn keeps one line, its last 44 characters (check 10).
- **Dark-theme primary arc (F3):** on the ink card in the dark theme the arc uses `#0071E3`, 4.31:1 against the light card, above the 3:1 floor.
- **Ready feedback for assistive technology (F4):** a polite live region says "<card> ready" when a preview is ready and "Cancelled" when one is cancelled.
- **Caption growth (F7):** the hidden sizing copy carries the same key-word mark and padding, so the pill keeps one width (check 6, measured once the face has loaded).
- **Delete exit (F8):** the removed glyph fades out over 120 ms where it stood, as an overlay, while what replaces it fades in. Skipped in keys mode. Its position is re-measured when a face loads, because the face swap moves glyphs without a render.
- **Trace attribution:** the trace file now keeps every raw layout, style and paint event with its arguments, tied to a sha256 of `src/`.

Declined or recorded:
- **Luminance (Sol F5):** still unmet for `worst-long` (10.7% and 11.8% below the brightest); it is the content, three lines of 52 px ink, not the chrome.
- **Listening outliving recognition (Sol F6):** needs `ListenSession.onEnd` in `shared/speech.ts`; proposal 3 below.
- **On-screen reason for muted End (Opus F9):** declined at the time; reversed after round 6 (see there).

**Found by the builder:** the caption pill measured 1 px narrower for its first ~100 ms, before Satoshi loaded (`font-display: swap`). This is a one-time swap from the fallback face, not caption growth, and `swap` is kept because `block` would hide text for up to 3 s on a slow network.

### Changes after round 5

Accepted. Each verified defect has a check in `scripts/verify.mjs` (checks 9 and 11 extended, 12–17 new). The P1 latch fix was mutation-tested: with the raw-sample condition removed, check 11 fails from across the screen, as Sol reproduced.

- **Latch, click from across the screen (Sol F1, P1):** the latch now also holds while the raw gaze sample is inside it, and clears only when the raw sample, the smoothed point and the engine's quadrant have all left. Check 11 now clicks Speak from Q8 as well.
- **Space in dwell mode (Opus F4, Sol F2):** Space or Enter commits only a finished preview in either mode (check 12).
- **Screen-copy entrances (Opus F1, Sol F3):** nothing inside the outgoing copy transitions. The copy is taken in the render that replaces the screen, so the chosen card keeps its solid ring and its bloom (CSS, since Web Animations do not survive a clone) (check 14).
- **Arc jump after a glance (Opus F2):** the arc resumes from its drawn angle (check 13).
- **Layout at the cue (Opus F3, Sol F5):** attributed by invalidation tracking to the cue layer and the ring svg leaving compositing when their transitions ended. Both hold a standing layer now; the trace has 0 layout in both windows.
- **Reduced-motion cancel (Sol F6):** fades over 150 ms (check 15).
- **Settings-rail alignment (Sol F7):** settings rails reserve a setting's two lines on every card (check 9 covers Selection and Display).
- **Calibration result at 200% (Sol F4):** may take three lines, so the caution shows (check 16). I kept the wording rather than shortening it.
- **Changed letters (Opus F5):** any typed glyph that is removed or changes letter fades out where it stood (check 17).
- **Docs (Opus F6):** the stale review-animations line, and luminance restated as a measured gap (10.1% ordinary, 11.8% `worst-long` at 1280).

Declined or recorded:
- **Menu reach (both):** four selections to a setting. Eight quadrants with page 1 full cannot reach about fifteen settings in two; this needs the owner's decision (open questions).
- **On-screen blocked reason for End (Sol, disagreement):** I still decline. The muted card at 32% plus its accessible name carry it; a line of reason text on the card is the explanatory text minimal-ui asks to remove, and the case clears as soon as the word is accepted or deleted.
- **Luminance and group-ink contrast:** unchanged and unmet, as recorded.

### Changes after round 6

Verified by `scripts/verify.mjs` (17b and 18–20 new) and by inspecting the regenerated evidence; no council round followed.

- **Dot overlay loop (Opus F1, P1, my regression):** the glyph measurement now looks only inside the word in progress, so a fading overlay is never measured as a glyph. Check 17b types by clicks (gaze input; digit keys get no motion and could not catch it) and asserts no message mutations for 1.5 s afterwards. Mutation-tested: with the old selector it fails with 22 mutations.
- **Arc after a dwell the engine gave up (Opus F2):** an engine `cancel` now drains the arc even if the gaze is back by then, so the arc never shows progress the engine threw away (check 18: down to 0° before refilling).
- **Nested entrance on the incoming screen (Opus F3, Sol):** the incoming screen carries `data-entering` from before its first style pass, so its labels, glyphs and captions ride its one fade (check 19: labels at 1 inside the fading screen).
- **Blocked reason on screen (Sol, P2):** I reversed my earlier decline. minimal-ui lists "why something is blocked" as allowed text and asks for "blocked states and their reasons visible when they happen"; apple-hig-ui calls a silent blocked action a defect. Muted End now reads "Finish the word first" under its quiet label, at full secondary ink; muted Repeat reads "Only with dwell". The top rail reserves that one line on every card, so End going quiet moves nothing (checks 9 and 20; never cut by an ellipsis at 100% or 200%, either viewport).
- **Count pips (Sol, P2):** 0.55 → 0.72 opacity, 3:1 or better on every group face.
- **Live-region layout at the preview (Opus F4, nit):** recorded, not changed. Writing "<card> ready" adds a text node and the shared actionable tracker then reads geometry, one small layout at the moment the preview is ready. A `shared/` proposal is added below.

Still declined or unmet, as recorded under open questions: menu reach (an owner decision), constant luminance, G2–G4 ink contrast (the brief's values), and live-recognition end detection (a `shared/` proposal; Sol reproduced it with a controlled recogniser).

## Self-reviews run on this build

### review-animations (Emil Kowalski's standards)

| Before | After | Why |
| --- | --- | --- |
| Arc as SVG `stroke-dashoffset` WAAPI (`gaze.ts`, first redo) | Two half-rings, `transform: rotate()` WAAPI (`ui.tsx` `RingArc`, `gaze.ts` `fill`) | Standard 7, GPU-only properties: dashoffset repainted the page every frame |
| `--dwell` custom property written to `<html>` each frame (first build) | No per-frame style writes; one animation per event | Escalation trigger: a CSS variable on a parent drives a style recalc storm |
| Engine ticked by `requestAnimationFrame` (`startTicking`) | 16 ms `setInterval` clock (`gaze.ts`) | A rAF loop forced main frames that re-styled composited animations |
| Bloom on a digit-key selection | Skipped when `data-input="keys"` (`gaze.ts` `commit`) | Standard 2: no animation on keyboard-triggered actions |
| Staggered group entrance (first build) | One 300 ms opacity wake, no stagger (`styles.css` `.tile` transition) | MOTION and choreograph: no staggered children on anything seen more than once |
| — (kept) Bloom 450 ms on each commit | Kept | Over the 300 ms UI budget and on a frequent action, but MOTION names it as the one celebration, it does not move layout, and it runs off the main thread. The owner's bar wins here. |
| — (kept) Dwell arc on every look | Kept | 100+/day says no animation, but the gaze research makes dwell progress a requirement. The research wins. |

| Keyboard-driven changes still ran pill, caption and release transitions | `data-input="keys"` zeroes them all and skips the release fade | Standard 2, extended after council round 3 |
| Outgoing label and screen removed at once | 150 ms opacity exits: a label in the same grid cell, an inert screen copy (`ui.tsx` `Tile`, `ScreenSwap`) | Standard 9 and MOTION's exit timing: every exit is shorter than its enter |
| Focus cue as a `background-color` change | An opacity layer and the svg's opacity | Standard 7: composite rather than repaint |

| A cloned outgoing screen replayed its children's `@starting-style` entrances, blanking its labels on frame 1 (found by the council, round 5) | `.screen--out *` has no transitions; the copy fades as one still (`styles.css`) | Standard 9: an exit must not re-enter |
| Cue layer and ring svg promoted only while transitioning | `will-change: opacity` on both (`styles.css`) | Standard 7: the end of the transition de-promoted them and laid out the document |
| Reduced-motion cancel removed the ring at once | Fades its opacity over 150 ms (`gaze.ts` `drain`) | Standard 8: reduced motion keeps opacity |

| Incoming screen's labels ran their own entrances inside its fade (council, round 6) | `data-entering` on the incoming screen drops those entrances | Standard 9 and MOTION: a screen change is one cross-fade |
| The changed-glyph overlay measured itself and re-added itself every 140 ms (council, round 6; my round-5 regression) | Measurement scoped to the word in progress | Idle must be still; nothing repeats above 1 Hz |

Verdict: **Approve, as of the final source.** There is no `transition: all`, no `ease-in`, no `scale(0)` and no hover motion. Every exit is shorter than its enter, keyboard input gets no motion, and reduced motion is handled everywhere. The verdict I gave before round 5 missed the screen-copy entrances; the council caught it.

### break-ui

Worst-case data enters through two dev phases, `worst-long` and `worst-nomatch` (`state.ts` `presetFor`). The layout checker walks them at both viewports. Other states: 200% text, the dark theme and reduced motion.

| # | Severity | Field | Worst case | What happened | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Broken (fixed) | message at 200%, 1280×720 | partner turn plus rule plus an 11-group word | The message line was cut to slivers | Rails yield height as text grows; the scroller room counts every sibling; line-height 1.18 (`styles.css`, `App.tsx`) |
| 2 | Broken (fixed) | partner turn | a 240-character partner turn | The 2-line clamp cut the end, which is the part the reply answers | Show the last 100 characters after an ellipsis (`screens.tsx` `tail`) |
| 3 | Ugly (fixed) | letter row | G–N at 1280 px | Wrapped to two lines at 100% | Row size follows the card width, `13.6cqi` |
| 4 | Ugly (fixed) | candidate | `physiotherapist` (15 letters) | Overflowed the ink card | Size from length, `165cqi / letters` |
| 5 | Fragile (fixed) | message, extreme case | three lines at 200% on 1280×720 | A 2 px descender sliver of the hidden line showed above the visible one | Masked once lines have scrolled away (`[data-scrolled]` mask), so normal sizes keep their ascenders |
| 6 | Held up | no candidate | G4 ×4 | Four dots in the T–Z ink; the candidate slot rests | — |
| 7 | Held up | long phrase | "Can you say that again?" | Wraps to two balanced lines inside its card | — |

### minimal-ui "Verify a screen"

Run on the compose, listening, speaking, menu and calibration screenshots at both viewports.

1. **Major thing:**
   - composing: the message;
   - listening: the partner's words;
   - speaking: the sentence;
   - menus: the screen's options;
   - calibration: the one active target.
2. **Elements:** each card is one target with one instrument and one label. Nothing is removable without losing a function or the brief's required count glyph.
3. **Words:** nothing sits above a title. There is no explanatory text, except "With dwell, reading the message can select a tile", a safety boundary DESIGN asks for, and the two blocked reasons ("Finish the word first", "Only with dwell"), which minimal-ui allows.
4. **Colour:**
   - groups: identity;
   - accent: the dwell;
   - orange: recording;
   - red: errors;
   - ink card: the primary action.
   Nothing else is coloured.
5. **Containers:** cards are the targets. There are no boxes inside boxes and no dividers except the one partner/message hairline.
6. **Squint:** the ink primary card is darkest. The brief requires it to be the strongest contrast, which puts it ahead of the message; the message is the largest text.
7. **Capability:** every capability is reachable. Settings are four selections deep (reported above).

### better-ui "Before you finish"

- No same-radius nested surfaces.
- No `box-shadow` ring without a transparent border: forced-colours borders are added.
- No `transition: all`.
- No keyframes on toggled classes: calibration's one-shot keyframes are not interruptible state.
- No `scale` below 0.96.
- `will-change` on the arc's sweeps and the bloom, and (opacity) on the cue layer and the ring svg: a departure from MOTION's "will-change only on the ring and the bloom", justified by the trace (without it, the end of the cue's transition laid out the whole document).
- Icons use `currentColor`.
- No hover styling.
- No scrollable overlays.

### apple-hig-ui "Verify a screen"

Fixed positions hold, the label is centred, nothing moves while armed, and errors say what is blocked. Two points are weaker:

- the partner-visible pill is the only tracking-state cue, because there is no tracker;
- Clear message has no undo, though it needs a confirm in confirm mode.

## Open questions and unmet items

- **Brief inconsistency.** BRIEF's "Type and contrast" still lists "group range labels 44–64 px" and "group letters 22 px", but "Letter groups show their letters" asks for one 28–36 px row with no range label. Style 1 follows the newer section and the owner's correction.
- **Menu reach.** Recalibrate takes three selections from composing, and individual settings four. Unmet for "everything within one or two selections".
- **Tile boundary.** Pastel faces against the canvas are about 1.06:1, and white cards about 1.04:1. The extent of a resting card is found by hue or not at all. The dwelt card steps a shade deeper rather than gaining an outline.
- **Luminance.** Unmet: the brief asks for constant luminance. Ordinary phases sit within 10.1% of the brightest (`1280x720-composing-pending` is the 10.1%). The worst-case data phase `worst-long`, with three lines of 52 px ink, is 10.7% below at 1440×900 and 11.8% below at 1280×720.
- **Group-ink contrast.** Only G1's ink on its face reaches the brief's label floor (Lc 75). G2–G4 reach Lc 73.4, 72.1 and 72.4 (Sol's independent figures). These are the brief's prescribed values; darkening them is the owner's call.
- **Owner decisions needed.** Menu reach (four selections to a setting cannot become two with eight quadrants and page 1 full) and a luminance tolerance (content such as three lines of 52 px ink moves the mean by up to 11.8%).
- **Double letters.** Typing two letters in a row from one group (the "oo" in "good") needs a look away of at least 150 ms. With "Keep looking" (dwell mode only) it is one long look. RESEARCH open question 7 stands.
- **T3 preview.** Recording didn't work in this session. The preview host disconnected twice, and its recording of a hidden tab held a stale frame for 10 minutes. The demo is the Playwright recording, inspected by frames.

## Proposals for `shared/`

None are made here; style 1 works around each locally.

1. `gaze.ts`: latch by quadrant, not only by action (a relabelled target under the gaze must not fire). Two dwell classes, or a per-action `dwellMs`. Redwell produces `previewed` in confirm mode. `confirm()` acts only on `previewed` in confirm mode.
2. `gaze.ts`: `startTicking` on a timer, or a documented note that a rAF loop forces main frames during composited animations.
3. `speech.ts`: `ListenSession.onEnd(reason)`, so a style can show that capture stopped and restart it. `speak()` with an `onWord(index)` callback and an `ok` result.
4. `overlay.ts`: exclude the overlay's own nodes from the actionable MutationObserver (Sol, round 2), and have `trackActionables` ignore text-only changes such as a live-region announcement, which now cost one layout when a preview becomes ready (Opus, round 6).
5. `gaze.ts`: stop accumulating dwell time while the gaze is away (Opus, round 5); the style resumes the arc from its drawn angle meanwhile.

## Methods used

- T3 workflow: `/Users/aamia/.codex/skills/t3-workflow/SKILL.md`, `references/routes.md`, `references/ui-quality.md`, `references/visual-evidence.md`, `references/orchestration.md`
- pstack feature route: `/Users/aamia/.agents/skill-libraries/pstack/skills/poteto-mode/playbooks/feature.md`. One owner wrote the code, not a delegate: a single coupled UI where the design judgment is the deliverable. The council supplied the independent review.
- Owner's rules: `/Users/aamia/.agents/skills/minimal-ui/SKILL.md` ("Verify a screen" run above)
- Clarte design skills:
  - `/Users/aamia/clarte/skills/frontend-design/SKILL.md`
  - `/Users/aamia/clarte/skills/better-ui/SKILL.md` with `animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md`, `performance.md`
  - `/Users/aamia/clarte/skills/lintapple-ui/SKILL.md` with `references/upstream-readme.md`. Lint Apple itself was not run: no project policy exists, and its checks cover type and contrast that were measured directly.
  - `/Users/aamia/clarte/skills/design-html/sections/doctrine.md`, `/Users/aamia/clarte/skills/design-html/sections/craft.md`
  - `/Users/aamia/clarte/skills/apple-hig-ui/SKILL.md`
- Emil Kowalski's set:
  - `/Users/aamia/clarte/skills/review-animations/SKILL.md` and `STANDARDS.md` (table above)
  - `/Users/aamia/clarte/skills/choreograph/SKILL.md` (motion map in DESIGN.md)
  - `/Users/aamia/clarte/skills/animation-performance/SKILL.md` (it caught the CSS-variable and paint problems; traces above)
  - `/Users/aamia/clarte/skills/emil-design-eng/SKILL.md`
  - `/Users/aamia/clarte/skills/apple-design/SKILL.md`
  - `/Users/aamia/clarte/skills/break-ui/SKILL.md` (table above)
  - `/Users/aamia/clarte/skills/find-animation-opportunities/SKILL.md`, `/Users/aamia/clarte/skills/remove-animations/SKILL.md` (applied as the gate in the review-animations table)
  - `/Users/aamia/clarte/skills/animation-vocabulary/SKILL.md`
- Council: `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/council/SKILL.md`
- Council briefs, one per round, each sent as a fresh read-only `delegate_task` to both members: `/private/tmp/claude-501/-Users-aamia-clarte/730351e4-e66b-475f-84c3-f120e478245f/scratchpad/round1.md` … `round6.md`
- Project: `/Users/aamia/clarte/AGENTS.md`, `prototypes/UI/v0/README.md`, `BRIEF.md`, `MOTION.md`, `RESEARCH.md`, `s0/DESIGN.md`
