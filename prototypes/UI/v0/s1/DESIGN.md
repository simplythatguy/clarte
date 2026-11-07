# Style 1 · Rails

The first prototype idea, built exactly as sketched, with the evidence applied to everything the sketch left open. Three visual rows on the two backend rows: controls along the top rail, the conversation in the middle, the four letter groups along the bottom rail.

Sketch: [../reference/02-style1-layout-sketch.png](../reference/02-style1-layout-sketch.png). Quadrant map: [quadrant-map-compose.svg](quadrant-map-compose.svg).

## Layout

| Quadrant | Action id | Label and behaviour |
| --- | --- | --- |
| Q1 | `mode` | Cycles **Listen** → **Pause** → **Respond** → **End**. Listen starts transcribing the partner and disables the groups. Pause stops transcribing. Respond enables the groups. End speaks the message if there is one, clears it, and returns to Listen. |
| Q2 | `autocomplete` | Shows the current candidate word. Selecting it commits the word. With nothing pending it is not actionable (no `data-action`), so Q2 becomes a rest zone. |
| Q3 | `delete` | Removes the last pending group, or reopens the last word at its next candidate. |
| Q4 | `flip` | Arrow pointing right on page 1, left on page 2. Page 2 relabels Q1–Q3 as **Speak**, **One moment**, **Menu**. The flip never happens on its own and the page returns to 1 after any page-2 action. |
| Q5–Q8 | `G1`–`G4` | A–F, G–N, O–S, T–Z. Not actionable while listening. |

Middle band (visual rows 2 of 3): the partner's last words small and quiet at the top of the band, the message large below it with the pending tokens at the end. It spans all four columns and is never actionable.

Rest zones: none while composing with a pending word. Q2 rests when nothing is pending; Q5–Q8 rest while listening.

## Selection

Default `mode: 'confirm'`: a steady look of 600 ms previews the action (the tile fills, nothing fires), Space or a blink confirms, looking away cancels. This is the current tracking prototype's model and the only safe default for a layout where reading the middle band is classified as the top or bottom row.

Offer `dwell` in the Demo menu with a one-line warning, so the team can feel the Midas touch problem on this layout. Offer the experimental "middle band rests" option: when the raw gaze point is inside the middle band, dwell does not accumulate. It uses the point, which the backend does not promise, so it stays labelled experimental.

Dwell classes: groups 600 ms, controls 900 ms.

## Visual direction

The user's original wish: bubbly, colourful, playful, but professional, big buttons. Keep the energy, spend the colour where the evidence allows.

- Light warm page `#F5F2EC`, ink `#1A1A1A`. Tiles are large rounded rectangles (radius 32 px) in a slightly darker neutral (`#ECE8E0`), gutters 24 px within a row and 56 px between the rails and the band.
- Group tiles carry a 6 px bar in the group colour along their top edge and a quiet 60% tint; the range label ("A–F") is 32 px weight 700, centred, with a small 1–4 dot glyph beneath it so the group reads without colour.
- Controls are neutral tiles with 26 px labels and an inline SVG glyph; the mode tile is the one coloured surface, in the state colour: listening `#1A8757` green, responding ink, speaking `#172F93`.
- Message 44 px weight 600; pending tokens as described in the brief; decoded words plain ink (setting to keep colours).
- Type: a confident humanist sans with personality (for example Manrope, Outfit or Inter Tight; one family). Playfulness comes from the generous radii, the scale of the tiles and one orchestrated transition when Respond starts (tiles rise 12 px and fade in over 300 ms, staggered 60 ms, once).
- No gradients, no shadows deeper than a 1 px hairline, no illustration. The calibration sequence uses outlined circles that fill with the state colour.

## What this style tests

- Whether the top-rail / bottom-rail split is comfortable or whether looking from the message down to the groups and back up to the autocomplete slot costs too much travel.
- Whether a page flip is understandable or whether people lose the second page.
- Whether a layout with no rest zone is usable with the confirm step, and how much the confirm step slows typing.

## Acceptance

All brief gates, plus: the flip arrow direction matches the page; page 2 returns to page 1 after an action; groups are not selectable while listening; Q2 is a rest zone when nothing is pending (overlay shows "rest").

## Decisions made while building

Recorded as they were taken. The visual layer was redone on 2026-11-07 against the owner's direction update (BRIEF "Visual direction" and "Quality bar", MOTION.md). That update supersedes the earlier visual direction above: the warm page, Atkinson Hyperlegible Next, the P2 group palette, the bars and the fills that grew or closed in. Everything below describes the current build. The interaction decisions (flow, latch, menus) carried over from the first build and its first council round.

### Skin (shared by all five styles)

- Canvas `#F5F5F7`, white surfaces `#FFFFFF`, ink `#1D1D1F`, secondary `#6E6E73`, tertiary `#86868B`, hairline `#D2D2D7`.
- Dwell accent `#0071E3`. Nothing else uses that blue.
- Group faces and inks as the brief lists them (ice, lavender, mint, peach).
- Satoshi 500/700 from Fontshare, with SF Pro and the system sans as fallbacks. No shadows, no gradients, no borders on tiles.
- The optional dark theme takes the dark reference shot's look, with lightened group inks on deep faces.

### Geometry (8 px grid)

- **Cards float in the canvas.** Each is 304 px wide at 1440 px (half a gutter of 28 px to every quadrant line; gutter `clamp(48px, 3.9vw, 56px)`, at least 1°), radius 40 px.
- **Card heights:** top rail 216 px, bottom rail 248 px at 900 px tall (24vh and 27.6vh). The letter groups get the taller cards because they are hit most often.
- **Larger text:** at larger text sizes each rail yields up to 40 px to the middle band.
- **Vertical layout:** a 40 px state pill sits 24 px from the top edge, and the top rail starts 24 px under it. The middle band sits between the rails with a 28–48 px gap on each side.
- **The middle band is the row boundary**, at least 300 px tall: the widest gap on screen, as the brief asks.
- **Departs from the mock in proportion, not in kind.** The mock's cards are 368 px tall because Corners keeps no band between its rows. Rails must keep the message band the sketch draws, so its cards are shorter and the content inside them is scaled up to keep the mock's confidence.

### Cards

- **One composition for every card:** the instrument centred, then the label centred under it, 16 px apart. The label is centred because the brief asks for it and because a centred focal point is where the eye lands (R-1, R-5). Placing the instrument above the label keeps the dwell indicator on the axis of the target, where research says feedback must be (R-6 §3.1).
- **Departs from the mock's corner placement** of the motif. A ring in a card's corner would sit about 120 px from the label, and feedback away from the target pulls the eye off it.
- **Groups:** a pastel face, the instrument as the two-circle motif (a 40 px solid dot in the group ink, overlapped by the 44 px dwell ring), then **all the letters** in one row (`groupLetters`), 36 px weight 700 tracked +0.14em in the group ink, then a 1–4 count glyph of 6 px pips. No range label anywhere on screen (owner's decision).
- **Letter-row sizing:** the row scales with the card (`13.6cqi`), so all eight of G–N fit one row at 1280 px too.
- **Letter rows at large text (150% and up):** the row breaks into two lines (G–N as GHIJ / KLMN, 3 + 3 for A–F) and grows as far as the card's height allows. At 200%, G–N grows from 34.8 px to 57.6 px at 1440×900 and from 30.2 px to 36 px at 1280×720. It never drops below 24 px.
- **Settings rails:** a rail that holds settings reserves a setting's two lines (name and value) on every card, so Back's ring lines up with the settings' rings (round 5).
- **A blocked control says why on the card.** Muted End reads "Finish the word first" and muted Repeat "Only with dwell", one line in secondary ink at full strength under the quiet label; the card's surface, glyph and label stay at the muted strength. minimal-ui allows a blocked reason and apple-hig-ui requires one. The top rail reserves the line on every card, so End going quiet moves nothing (round 6).
- **Count pips** are the group ink at 0.72 opacity, 3:1 or better on every face (round 6).
- **Controls:** a white card with a 56 px ring holding a 26 px, 1.6 px-stroke outline glyph, and a 40 px weight 700 label. At large text the ring is 40 px and the glyph 24 px, so the glyph never fills its ring, and every top-rail card centres its ring on one line whatever its label (round 4).
- **The one primary target** (the candidate word; Listen in idle; Respond in paused; Speak or Say again on page 2; Stop while speaking; Start after calibration) is an ink card with a white label: the strongest contrast on screen, as the brief now requires.
- **The candidate word** is 52 px, shrinking with its length to fit the card (`165cqi / letters`), and growing at most 1.15× with text size, so it always fits its card. Its glyph is the accept check; End uses a return glyph so the two never read alike.
- **Large-text mode (150% and up):** the instrument shrinks to 40 px and the gaps to 8 px. The top rail keeps at least 144 px. Every card's content stays inside its rail at 200% in every phase at both viewports (`scripts/verify.mjs`).
- **Settings:** the topic glyph in the ring, the setting's name at 20 px in secondary ink, and its current value at 36 px.
- **Phrases:** the speech glyph and the phrase at 36 px.

### State pill (partner awareness)

- One pill at the top edge, readable across a table:
  - **Listening:** orange `#C93400` (Apple's microphone-in-use colour; white on it is APCA Lc 80) with a white recording dot.
  - **Composing:** white with a hairline and ink text.
  - **Speaking:** ink with white text.
  - **Voice failure:** white with "The voice did not play" in red `#D70015`, until the next selection. It sits beside the state, never over it, so a failure while listening still shows the recording pill.
  - **Idle and paused:** no pill.
- Orange is used for recording and nothing else, and red only for errors. Neither is a group hue.
- The pill is keyed by state and fades in over 300 ms, so its colour and its words always arrive together. The recording dot follows 100 ms later over 200 ms.

### The dwell instrument (MOTION "The dwell indicator")

- **At rest:** a 1.5 px track ring at 30% sits on every card, in the group ink on groups, tertiary ink on white and canvas colour on the ink card.
- **Choreography,** timed from the gaze's arrival (the engine's 150 ms quadrant hold is subtracted):
  - Nothing changes for 150 ms (groups) or 250 ms (controls).
  - Then one static cue over 150 ms: the face steps one shade and the track turns opaque. Both are opacity changes, of a shade layer over the face and of the ring's own `<svg>`, so the cue composites.
  - The 3 px accent arc starts with the cue, not after it, and fills clockwise from 12 o'clock, linear, over the remaining dwell. On a primary (ink) card in the dark theme the arc uses the light-theme accent `#0071E3`, which keeps it above 3:1 there (council round 4).
  - A preview that becomes ready, and one that is cancelled, are announced once in a polite live region ("Speak ready", "Cancelled"), so assistive technology hears what the ring shows.
  - Confirm mode: the full ring is the preview, and Space (a blink, in the product) commits it.
  - At commit, the ring goes solid accent, the 45 ms click plays on the same frame, and a copy of the ring blooms from 1× to 2.4× while fading from 0.35 to 0 over 450 ms.
  - The ring stays solid accent while the gaze stays. It fades to the track over 150 ms, opacity only, once the gaze has left and the engine has re-armed.
  - **Leaving holds the arc still.** The engine keeps a dwell for its 150 ms quadrant hold plus 150 ms of grace. In that window, with the gaze already in another quadrant, the arc pauses, a preview there is cancelled, and a completion there is refused. Nothing finishes on a card the person has looked away from (council round 3). The arc also holds through the engine's own grace, when the gaze has left but no new quadrant has been confirmed (round 4). When the engine gives the dwell up, the arc drains back over 150 ms from where it was.
  - **Back from a glance away, the arc carries on from what is drawn.** The engine keeps counting while the arc holds, so resuming from the engine's count would jump the arc forward; it resumes from its drawn angle and fills a little faster to land on the preview on time (council round 5).
  - **A refused completion is not lost.** If the gaze comes back to the card while the engine still reports it selected, the completion is delivered then, so a card never sits looking committed while nothing happened (round 4).
- **Built for the compositor.** The arc is two clipped half-rings that rotate 0 → 180° in turn, driven by Web Animations on `transform` only; the bloom is `transform` and `opacity`. `will-change` sits on those two parts only.
- **Departs from the first build**, which animated an SVG `stroke-dashoffset` and wrote a custom property to `<html>` every frame. A trace showed a full repaint and a style recalc every frame.
- **The engine's clock is a 16 ms timer**, not the shared `startTicking` (requestAnimationFrame). A rAF loop forces a main frame every frame, and Chrome then re-styles even composited animations. Measured: while the arc fills, 0 layout, 0 paint and 2–3 style recalcs in 270 ms (`evidence/motion/dwell-trace.json`).
- **Reduced motion:** the ring is drawn whole and steps from 0.3 to 1 opacity in four steps across the dwell. There is no bloom, and commit is the colour step. A cancelled dwell fades the whole ring out over 150 ms from where it stood (round 5).
- **Standing layers:** the cue's shade layer and the ring's `<svg>` carry `will-change: opacity`, so the cue's transitions starting and ending never re-lay out the page. Before this, the end of the cue's transition laid out the whole document once per dwell (round 5). This departs from MOTION's "will-change only on the ring and the bloom"; the trace is the reason.
- **A dwell the engine gives up drains,** even if the gaze has come back by then: the arc never shows progress the engine has thrown away (round 6).
- **Keyboard input gets no motion:** Tab, the arrow keys and the digit keys mark the page as keyed until the pointer moves.
  - What drops to zero: card, label, glyph, pill, caption and screen transitions, the bloom, and the release fade.
  - Space stays a gaze action, because it stands in for a blink. A focused card takes Space or Enter only while the keyboard is driving. Otherwise the key confirms a finished gaze preview and nothing else (council round 3), in either selection mode: in dwell mode there is no preview, so it does nothing (round 5).
  - Clicks latch their quadrant like gaze (the pointer is the gaze); digit keys do not. The latch covers every quadrant the clicked card owns and clears only when the engine's quadrant, the smoothed gaze point and the raw sample have all left them (the raw sample since round 5, for a click from across the screen), so a click that lands before the tracker catches up cannot let the card that replaces it (Speak → Stop) fire under a still gaze (round 4).

### The message and the word in progress

- **Composing layout:** the partner's last turn (26 px weight 500, secondary ink, two lines), one hairline, then the message (52 px weight 700, −0.025em). At 150% text and above the partner's turn keeps one line (its last 44 characters), so the message always keeps at least one whole line (round 4).
- **A long partner turn keeps its end**, the part the reply answers, after an ellipsis.
- **The word in progress is the live best decode** (`pendingGlyphs`):
  - each typed group is one glyph, the candidate's letter in that position, in that group's ink;
  - the predicted remainder follows as ghost letters in tertiary ink;
  - with no candidate, each typed group is a dot in its ink.
- **Glyphs appear in place.** They are keyed by position and letter, so a new or changed glyph fades in over 150 ms where it stands, and nothing slides.
- **An accepted word settles** from its group inks to plain ink over 180 ms, colour only. The Word colours setting keeps the group inks instead.
- **While speaking**, the current word carries the one pill highlight (ink at 8%) and the words still to come wait in secondary ink. A phrase highlights word by word.
- **Whole lines only.** The message shows whole lines and keeps its newest line in view. The partner's turn never scrolls away.

### Motion map (MOTION "Choreography of the frequent moments")

| Event | Lead | Support | Static |
| --- | --- | --- | --- |
| Group committed | new glyph fades in, 150 ms | ring solid, click, bloom | every other card, the pill, the transcript |
| Candidate changes | candidate label swaps, 150 ms; ghost letters fade in | — | typed glyphs |
| Word accepted | glyphs settle to ink, 180 ms colour | candidate card goes quiet (rest) | groups |
| Delete, or a new decode changing a typed letter | the removed or changed glyph fades out over 120 ms where it stood, as an overlay, while whatever now takes that place fades in; nothing slides (round 4; changed letters round 5) | — | all |
| Speak | highlight steps word to word, instant | pill fades in, 300 ms | all |
| Listening starts / stops | pill fades in, 300 ms; recording dot 200 ms | group cards wake or go quiet by opacity, 300 ms | positions |
| Page flip, mode relabel | the card's content cross-fades in place: the outgoing label fades out over 150 ms in the same grid cell while the incoming one fades in over 300 ms from 100 ms; a card going quiet keeps its label while it fades. The candidate card's swap is quicker (out over 80 ms, in over 150 ms from 60 ms), so two words never sit legibly on top of each other (round 4) | — | the cards themselves, the grid |
| Screen change (menu, calibration step) | an inert copy of the outgoing screen (no actions), taken in the render that replaces it so the chosen card shows its solid ring and its bloom begins, fades out over 150 ms, linear, as one still: nothing inside it transitions (round 5); the incoming screen likewise enters as one fade, its labels and glyphs riding it rather than running their own entrances (round 6), while the incoming screen fades in over 300 ms from 100 ms; the linear exit keeps the sum of the two near full, so no frame dips to empty canvas (round 4) | — | the pill |
| State pill changes | the outgoing pill fades out over 150 ms in the same cell while the new one fades in (round 4) | — | all |

No staggers anywhere, no slides, no idle motion. Every transition names its properties; there is no `ease-in` and no `transition: all`.

### Calibration (MOTION "The calibration sequence")

- The working canvas throughout.
- **The result at large text** may take up to three lines, so its caution ("a little less sure") always shows (round 5).
- **Captions:** one white pill per line (hairline, radius 12, padding 10 × 14, 20 px weight 500), typing at 32 ms per character with a 180 ms rest after punctuation. The pill takes its final size before the first letter types; its hidden sizing copy carries the same key-word mark and padding, so the last letters do not grow it (round 4). The key word is highlighted in accent at 14%, the caret is a 1 px static bar, and an earlier line settles to secondary ink.
- **Position:** a ring 38% of the shorter side, with "Sit so your face fills the **circle**." under it. At the simulated pass (1.2 s after the line), the stroke turns accent and the fill tints accent at 12% over 200 ms. "Good." follows, then a 600 ms beat.
- **Nine points:**
  - The outlines (28 px, 1.5 px, 30% ink) fade in together over 200 ms, at 7/50/93% across and 10/50/90% down.
  - "Follow the **dot**." types beside the first point.
  - A 12 px ink guide dot travels with `--ease-move` over 1200 ms. Each point then shows its centre dot, and its ring fills clockwise over 1800 ms: the same two-half arc as the app's dwell ring, so the person learns it here. It blooms (450 ms), settles to a 30% outline, and a 400 ms beat follows.
- **Check:** four other points (22/78% across, 30/70% down) at 900 / 1200 ms, captioned "One more **look**."
- **Ready:** the title, the (simulated) result in plain words, and Start as the ink card in Q2, the style's primary quadrant.
- **About 50 s in all;** Escape skips it. Under reduced motion the guide fades instead of travelling, and the rings step in opacity.

### Flow, latch and menus (carried over)

- Q1 walks Listen → Pause → Respond → End. The groups wake only in Respond.
- **End:**
  - speaks a message only if it changed since it was last spoken, then clears it;
  - stopping End's speech, or a voice that fails, keeps the message.
- **Speak:** stays on page 2, which offers Say again while the message equals what was spoken. There is no timed return.
- **One moment:** speaks the floor-holder and returns to page 1.
- **Phrases:** land on page 2, one look from Speak.
- **The microphone pauses** whenever the device speaks, and during recalibration.
- **Quadrant latch:** after a selection, a different action in the same quadrant (a relabelled card) cannot preview or fire until the gaze leaves that quadrant. Space and Enter commit only a finished preview. Looking off screen cancels at once, and a still pointer keeps sampling.
- **Menus** reuse the rails, with Q4 always Back:
  - Menu: Phrases, Clear message, Recalibrate, Selection, Display.
  - Selection: Select by, Letters, Controls, Repeat, Middle rest (test), Gaze noise.
  - Display: Text size, Theme, Sounds, Word colours.
  - Phrases: seven.
- **Spell** is designed (entry at Menu Q7, letter pages on the rails, G–N split g–m / n), not built.

### Measured

- **Contrast (APCA):**
  - ink on canvas: Lc 98;
  - group inks on their faces: Lc 72–75. Only G1 reaches the brief's label floor of Lc 75; these are the brief's values, reported, not changed;
  - accent on white, faces and ink: 4.7, 4.0 and 3.6:1;
  - secondary on canvas: Lc 69;
  - tertiary (ghost letters, 52 px) on canvas: 3.3:1;
  - white on the listening orange: Lc 80.
- **Known limit, chosen deliberately:** pastel faces against the canvas are about 1.06:1, so a card's extent is found by hue. Style 1 shows the dwelt card with a face one shade deeper rather than an outline.
- **Mean screen luminance** (`scripts/luminance.mjs`, `evidence/luminance.txt`):
  - ordinary phases sit within 10.1% of the brightest at both viewports (`1280x720-composing-pending` is the 10.1%); the brief asks for constant luminance, so this is a measured gap, not compliance;
  - the worst-case data phase `worst-long` (three lines of 52 px ink text) sits 10.7% below at 1440×900 and 11.8% below at 1280×720.
