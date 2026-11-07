# Style 5 · Dialogue

The conversation itself is the screen. The partner's turns and the person's replies form a thread in the top-centre rest zone, and the primary slot offers a whole predicted reply from the partner's words before any typing, then word candidates as typing refines it. Six actions, two rest zones, no page flip.

Quadrant map: [quadrant-map-compose.svg](quadrant-map-compose.svg).

## Layout

| Quadrant | Action id | Label and behaviour |
| --- | --- | --- |
| Q1 | `primary` | Contextual: **Listen** when idle · **Stop** while listening · a **suggested reply** (whole phrase from the partner's last turn) when the message is empty and nothing is pending · the **candidate word** while groups are pending · **Speak** when the message has words and nothing is pending · **Say again** for 6 s after speaking |
| Q4 | `delete` | **Delete** while composing · **One moment** while listening · **Menu** when idle with nothing to delete |
| Q2 + Q3 | rest | The thread: partner turns left-aligned in secondary ink, the person's turns right-aligned in ink, the current message at the bottom, large, with pending tokens |
| Q5–Q8 | `G1`–`G4` | A–F, G–N, O–S, T–Z |

Rest zones: Q2 and Q3 in every state.

## The suggested reply

A stand-in rule table maps the partner's last turn to one short reply: a question starting with "how are" → "I'm okay, thanks"; "do you want" or "shall we" → "Yes, please"; "are you" → "Yes" ; otherwise no suggestion and the slot offers Listen or stays as is. The suggestion is visibly a suggestion: secondary ink, quotation marks, the label "Suggested". Selecting it commits the phrase into the message (it does not speak). Typing any group dismisses it. The language-model teammate will replace the table; keep the contract: `suggestReply(partnerText: string): string | null`.

The evidence is two-sided (R-2, R-3): whole-phrase suggestions gave the largest speed gains in the field, and users distrusted generated replies for tone and for making partners think the device did the talking. This style exists to feel that tradeoff.

## Selection

Default `mode: 'dwell'`, groups 600 ms, controls 900 ms. The primary slot waits for gaze to leave before relabelling.

## Visual direction

Warm, conversational, adult.

- Page `#F5F2EC`, ink `#1A1A1A`, secondary `#5A5A5A`. The thread has no bubbles and no boxes: alignment and ink weight separate the speakers; a 1 px hairline sits above the current message.
- Group tiles along the bottom: `#ECE8E0`, radius 28 px, group bar on the top edge, 32 px labels, dot glyph.
- The primary tile is the one place with presence: when it offers a suggested reply or Speak it uses the accent `#172F93` face with light ink; otherwise neutral.
- Speaking highlights each word in the thread as it is spoken with a 60% tint behind it; the state band at the top edge changes colour per state.
- Type: a humanist sans with warmth (Source Sans 3, Nunito Sans or Inter) at 44 px for the current message and 26 px for past turns.
- Motion: new thread lines fade in over 200 ms; the only orchestrated moment is Speak, where the message rises into the thread as a sent turn.
- Calibration sequence on the same page colour.

## What this style tests

- Whether seeing the exchange as a thread helps keep track of the conversation, especially after interruptions.
- Whether a whole-reply suggestion is used, ignored or resented, and how clearly it must be marked.
- Whether the primary slot's many states stay legible.

## Acceptance

All brief gates, plus: Q2 and Q3 show "rest" in every state; a suggestion never speaks or commits on its own; typing a group dismisses it; spoken-word highlighting follows speech synthesis boundary events when available and a timer otherwise.

## Decisions made while building

Everything below was decided while building the prototype (2026-11-07). Where it departs from the brief above, the research reason is cited.

### Slots, state by state

| Phase (`clarteDebug` name) | Q1 `primary` | Q4 `delete` | Q5–Q8 |
| --- | --- | --- | --- |
| `idle` | Listen | Menu | groups |
| `listening` | Stop | One moment (stops listening, speaks "One moment, I'm answering.") | quiet, not selectable |
| `suggested` | “Suggested reply” | **Not now** (dismisses it for this partner turn) | groups (typing also dismisses) |
| `composing-pending` | candidate word | Delete | groups |
| `composing-reopened` | next candidate | **Delete word** | groups |
| `composing-nomatch` | quiet; "No word" from two groups on | Delete | groups |
| `composing-ready` | **Speak** (accent face) | Delete | groups |
| `speaking` | Stop | quiet | quiet |
| `spoken` (6 s, held while gaze rests on Q1) | Say again | Menu | groups (typing ends the window) |

- **Suggestion state, Q4 is "Not now", not Menu.** With the suggestion occupying Q1, Listen and Menu would otherwise be unreachable without typing. One look dismisses it; Listen and Menu are then where they always are. Users must control when predictions apply (R-2 F19–F20, R-3 §18), and a visible refusal is that control.
- **Groups are quiet while listening and speaking.** Q1 cannot be both Stop and the candidate, and the transcript or spoken sentence is the one major thing then; quieting the bottom row makes all of it rest. Quiet tiles stay visible (R-6 §3.2: a quadrant that suddenly fills is peripheral motion).
- **One moment while listening also stops listening**: saying "I'm answering" is taking the turn. It is also on the Menu (same Q4 position).
- **Spell** is designed, not built: when the decoder has no word for two or more groups, Q1 says "No word"; in the product that tile becomes **Spell** (letter-exact entry for names, R-2 F15), the place where it matters.
- **What this layout cannot offer mid-message (declared non-compliance with BRIEF "Capability"):** One moment, Recalibrate, Menu (settings, phrases) and Listen are reached only when the message is empty. Six actions and two rest zones leave two control slots; mid-message they are the candidate/Speak and Delete. "Clear message" is therefore not in the Menu (it could never have anything to clear); Delete removes a word in at most two looks. Recorded as an open question in REPORT.md.

### The suggested reply is quiet, not accented

The brief above gives the suggestion the accent face. Built that way, the generated reply was the loudest thing on screen, nudging the person toward words they did not choose. Users distrust generated replies and object to partners thinking the device did the talking (R-3 §18, R-2 F19), so the suggestion uses the neutral tile, secondary ink, curly quotes and a sparkle glyph plus "Suggested" at 21 px. The accent face is kept for **Speak** only: the one action that moves the person's own message forward.

### Thread

- Above the hairline: what was said. Partner turns left in secondary ink `#5A5A5A` at 26 px/400; the person's turns right in ink at 26 px/600. No bubbles, no boxes. Older turns scroll off the top behind a 64 px fade.
- The history keeps at least two lines of the newest turn, so the partner turn being answered stays visible at any text size; the live line takes the rest and steps its type down to fit (floor 75% at 100% scale, 60% at 200%), so the whole draft stays readable at 200% (council round 1).
- Below the hairline: **the live line**, whatever is happening now: the partner's words as heard (40 px ink), the message being composed (44 px/500 with tokens), or the sentence being spoken (44 px with the spoken word on a 16% speaking-colour tint). When a live line finishes it **rises** into the thread as a turn: one FLIP from the live line to its place, 380 ms `cubic-bezier(0.2, 0, 0, 1)`, colour and size settling with it; an opacity fade under reduced motion. This is the one orchestrated moment, used for both speakers because it is one idea: a turn completing.
- A floor-holder ("One moment…") is kept in the thread in secondary ink and never counts as a reply.
- Words are shown and spoken in sentence case (the decoder works in lower case).

### Tiles, type and colour

- Font: **Atkinson Hyperlegible Next** (Google Fonts). Measured x-height ratio 0.496 with distinct I, l and 1; Source Sans 3 and Nunito Sans measured 0.486 (below the brief's 0.5), and the hosted Inter did not render distinct I/l. Designed for low-vision readers (R-4 §14).
- Scale at 100%: live message 44, live partner line 40, group labels 32, setting values 34, candidate 40 (shrinks to fit long words), suggestion 29, control labels 26, past turns 26, small labels 21–22. Nothing under 21 px. `--scale` multiplies all of them to 200%; container-query caps keep long words inside their tile.
- Tiles: `#ECE8E0`, radius 28, inside their quadrant with 52 px gutters between tiles in a row and 80 px across the row boundary (the widest), 24 px to the screen edge, band height 52 px.
- Group identity: **n short bars in the group colour** (G1 one bar … G4 four), 22×8 px, above the range label. One element carries colour and count, so identity survives colour blindness without a separate glyph.
- State band at the top edge, 52 px, white 22 px bold label and glyph: Listening `#B4372A` with a recording dot, Replying `#0B6E78` with three dots, Speaking `#172F93` with a speaker. Idle has no band colour. Partner-facing word "Replying" rather than "Composing".
- Primary action: **Speak** (and calibration Start) use a light accent tint face `#D4D8EA` with ink label and a `#172F93` icon and dwell bar. A full `#172F93` face (the first build) dropped mean screen luminance by 13% under the fovea every time a word was accepted (council round 1, measured on the screenshots); R-1 §27 says pupil change shifts gaze.
- Group bars: P2 with **G3 `#A672AD` and G4 `#9F7F33`** (stock P2 `#BB80C2`/`#B38F39` measure 2.46/2.49:1 on the tile, below the brief's 3:1 for group bars) and dark **G1 `#676EAA`** (stock `#545C9F` 2.38:1). Same hues, darkened or lightened just to 3:1. The brief's palette and its 3:1 rule conflict; this keeps the rule.
- Dark theme (Menu → Settings → Theme): page `#1C1B19`, ink `#F2EFE9`, secondary `#A8A49C`, tiles `#2A2826`, P2 dark group colours.

### Dwell indicator

Two ink segments grow from the ends of a faint track **just under the label** (in the content flow, so the eye never leaves the content) and meet at its centre when the dwell completes, so the remaining time is the gap still open. The static focus cue (face one step darker plus the track) appears after 150 ms on groups and 250 ms on controls and holds alone for 100 ms before progress starts. At commit the face takes the selected tint and the bar stays whole until gaze leaves (the engine's latch). A cancelled dwell drains back over 150 ms. Under reduced motion the track is drawn whole, and its opacity and the face tint ramp in four steps. The bar never touches the label, works for one-word and two-line content alike, and converges toward the centre (R-6 §3.1: progress that closes toward the target's centre).

### Gaze plumbing (local, see REPORT proposals)

- Two dwell classes on one engine: `dwellMs` switches to the letter or control value the moment the engine starts dwelling on an action.
- The mouse streams its last position at 30 Hz like a tracker would; the shared `attachPointer` sends nothing for a still mouse, and the engine counts 600 ms without samples as lost gaze.
- **Quadrant guard:** after any selection, a different action in the same quadrant cannot dwell until gaze leaves that quadrant. Found in the live walkthrough: Menu → Settings put "Button dwell" under a gaze that never moved, and it changed the setting by itself 300 ms after the latch re-armed.
- **Owner-change guard:** a quadrant whose owner changes while gaze rests in it (a quiet group becomes active when speech ends; Q4 goes from blank to "Not now" or Menu) cannot fire until gaze leaves and returns, even for the same action id (council round 1).
- **Repeat ("Hold") applies to letter groups only**; controls always need a look away, so Speak, Delete and settings never auto-repeat (council round 1).
- A label never changes under a resting gaze unless the change came from selecting that slot; any activation (dwell, key or click) on a label that changed underneath it does nothing except bring the label up to date.
- In Confirm mode Space/Enter always confirm the open preview; they activate a tile only when it has keyboard focus (`:focus-visible`).
- **Stop while speaking is a repair**: the draft returns to the composer and nothing joins the thread.
- Live listening drives recognition directly so a session that ends after words restarts (shared `listen` cannot report the end separately); automated browsers use the scripted partner.

### Calibration

Same page colour as the app. Position (2.6 s): one 2 px outlined circle that turns accent and thicker when the "face" is found. Nine points at the grid extremes in reading order, each a 19 px-radius outlined circle with a 4 px ink centre dot; a 14 px accent guide dot travels between them (1200 ms, ease-in-out), the active target fills accent while a ring closes onto it over the 1800 ms settle; finished points keep an accent centre dot. Four validation points (move 700, settle 900), then "Ready" with "Tracking is steady across the screen" and a Start button (owns Q6–Q7, drawn 440×240 on the accent tint). Total about 36 s: the brief's own pace (1200 + 1800 ms × 9 points) is 27 s before positioning and validation, so "about 30 s" and the prescribed pace cannot both hold. Captions type themselves at 32 ms per character. Escape skips. First run only; Recalibrate in the Menu.

## Visual layer v2: the shared light skin (owner direction, 2026-11-07)

The owner moved all five styles onto one skin (BRIEF "Visual direction", "Quality bar", MOTION.md). This style keeps its layout, quadrant map, thread, suggested-reply contract and engine; the visual layer, tile labels, word in progress and motion were redone. Where this section conflicts with "Decisions made while building" above (Atkinson, the warm palette, the navy accent, the two-segment bar, the FLIP rise, the top band), this section wins.

### Look

- Apple neutrals: canvas `#F5F5F7`, white surfaces, ink `#1D1D1F`, secondary `#6E6E73`, tertiary `#86868B`, hairline `#D2D2D7`. Accent `#0071E3` is used by the dwell arc, its bloom and the calibration arc only.
- Satoshi 500/700 from Fontshare (measured x-height 0.494). Message 52/700 −0.025em; card labels 44/700 −0.02em; group letters 36/700 +0.14em; partner and thread turns 26/500; hints 20/500; state pill 22/700.
- **Cards float in their quadrant** (README rule 1) instead of filling it: `25vw − 64px` wide (296 px at 1440, 64 px gutters between neighbours, 32 px to the screen edge), `min(50vh − 112px, 344px)` tall (338 px at 900, 248 px at 720), 40 px from the top or bottom edge, radius 40, no borders, no shadows. The row gutter is 144 px at both viewports, the widest gutter as the brief asks.
- Q1 is the one primary target: an ink card with white label, in every state (so its luminance never changes). Q4 is a white surface card. Groups are their pastel faces with group-ink content.
- **Content is centred** on every card (BRIEF "Hit region": label centred; HIG: a natural focus point), where the mock anchors content bottom-left. The motif sits above the label, so the dwell ring is within 40 px of the label's centre.

### Cards

- Group card: the two-circle motif (44 px solid dot in the group ink, 48 px ring overlapping it by 18 px), then the group's letters from `groupLetters(id, '')` as the only text, then the count glyph (n short bars in the group ink). The letters are tracked +0.14em and unspaced, which fits one row at both viewports (`GHIJKLMN` is 228 px at 36 px); the brief's spaced form ("G H I J K L M N", 295 px at 32 px) does not fit a 256 px card. Above 100% text the row breaks into two rows of four instead of shrinking.
- Control card: an outline icon (1.5 px, 28 px) inside a 64 px ring, the label, and a hint where it carries a value: "Accept" under the candidate, "Last group" or "Last word" under Delete, "Suggested" under a suggested reply. Settings and phrases put a quiet icon in the ring so it never reads as an empty radio button.
- The dwelt group card deepens one step (face mixed 14% toward its ink, about 1.2:1 against the canvas): this style's answer to the brief's "known limit" on pastel faces. No outline.
- Disabled cards keep their face (constant luminance) and dim their content to 32% over 300 ms: groups while listening and speaking, Q1 "No word" (from the first group, so the ink card is never silent), and Q4 while speaking (it shows the Delete it returns to, dimmed, instead of an empty card).

### The dwell indicator (MOTION.md)

Intent delay with no change (150/250 ms) → one static focus step (face one shade deeper, ring track opaque) held 100 ms → an accent arc draws clockwise from 12 o'clock, linear, over the remaining dwell → at commit the ring turns solid accent and a copy of it blooms (scale 1 → 2.4, opacity 0.35 → 0, 450 ms, `--ease-out`) on a layer that never moves layout → the ring stays accent while gaze remains and drains over 150 ms when it leaves. A cancelled dwell drains linearly from wherever the arc is while fading, so no round cap lingers (Web Animations retarget from the computed value); after a commit the solid ring fades back to the track instead of unwinding. No bloom on keyboard-triggered selections. Arc and bloom start only on state transitions; during a dwell Chrome reports zero layout and one element's style recalc per frame (measured: 62 recalcs, 1.7 ms per second). Reduced motion: no arc, the ring's opacity steps 0.3 → 1 in four steps, commit is a colour step, no bloom.

### The word in progress (BRIEF)

`pendingGlyphs()` drives it: one glyph per typed group in that group's ink, then the predicted rest as ghost letters in tertiary ink; with no candidate, one dot per typed group in the group ink. Glyph slots are keyed by position, so a new glyph fades in where it lands (150 ms) and nothing slides; a letter that changes cross-fades in place; a deleted trailing glyph lingers 120 ms while it fades out. An accepted word's letters start in their group inks and settle to ink over 180 ms; the Word colours setting keeps them. A run of dots may wrap; a word with letters never breaks.

### Thread and live line

- The state pill (Listening red `#C4001A`, Replying magenta `#9E1F63`, Speaking green `#1F7A38`; a 12 px dot plus the word, 26 px/700, 48 px tall) sits at the top of the rest zone, aligned with the card tops. It replaces the full-width band: the same information, readable across a table, without a coloured strip across the top of the screen. Replying shows as soon as a reply is owed (the partner spoke last), not only once typing starts. One element: its colour cross-fades over 300 ms.
- The live line has a fixed basis of two message lines, so typing never moves the thread above it. Only when the viewport leaves less room (200% text on 1280×720) does it shrink, and its type then steps down to a floor (75% at 100%, 60% at 200%); at the floor the latest words stay in view. At text sizes above 100% the thread may extend into the empty row gutter (text is never actionable), stopping 24 px above the bottom cards.
- **The FLIP rise is retired.** MOTION.md: nothing slides across quadrants and a finished line becomes a turn by a cross-fade in place. The live line fades out over 150 ms (from 1, not a snap); the new turn fades in over 300 ms from 100 ms. A message that is spoken stays the same element from composing into speaking; only the highlight changes.
- Spoken word: one pill highlight in the speaking tint with the word in the speaking ink (4.65:1), swapped instantly on each speech boundary.

### Choreography

| Event | Lead | Support | Static |
| --- | --- | --- | --- |
| Group committed | glyph fades in place, 150 ms | ring solid + bloom on the card | other cards, pill, thread |
| Word accepted | glyphs settle group ink → ink, 180 ms | Q1 relabels (after gaze leaves) by the 150 ms label cross-fade, no entrance delay | groups |
| Delete | trailing glyph fades out, 120 ms | ring solid + bloom on Q4 | everything else |
| Candidate changes | ghost letters fade in place, 150 ms | – | typed glyphs |
| Speak | highlight steps word to word | pill to Speaking, 300 ms colour | all |
| Listen / Stop | pill colour and word, 300 ms | groups dim or wake by opacity | positions |
| Screen change (menu, page) | the cards stay; each card's face colour moves in place over 150 ms; its content follows MOTION: out 150 ms, in 300 ms from 100 ms (the card behind it holds the luminance). The rest zone's text uses the same timing | – | the grid, the cards' positions |
| Calibration ↔ app | both stages cross-fade together over 300 ms with `plus-lighter` (the split timing dips through the bare canvas here; constant luminance wins); the outgoing stage is inert | – | – |

### Calibration (MOTION.md sequence)

Position ring 38% of the shorter side, caption "Sit so your face fills the **circle**." typed at 32 ms per character (180 ms rest after punctuation), the check passes at 1.3 s (accent stroke and 12% fill over 200 ms), "Good.", then points. Nine 28 px 1.5 px outlines at 30% ink; a 12 px ink guide dot travels on the move curve (1200 ms), the target's arc fills clockwise in accent over the 1800 ms settle, blooms, returns to the outline; a 400 ms beat. Check: four points, 900/1200 ms, "One more **look**." Ready: title and result in the rest zone, Start in Q1. About 42 s; Escape skips.

### Accessibility names

Visible text names every card (Lint Apple label-in-name); the groups' accessible name is their letters. Only cards whose visible text is absent carry an `aria-label`. The word in progress exposes its letters to screen readers through visually hidden text.

### After council round 3

- Screen changes: both layers cross-fade together over 300 ms (outgoing from 1 to 0, incoming from 0 to 1) and the outgoing layer lives for the whole fade. MOTION's split timing (out 150, in 300 from 100) dips through the bare canvas; constant luminance wins.
- Keyboard-triggered actions render with transitions off (`data-instant` on the root for 160 ms) and no bloom.
- Confirm mode: a previewed card shows the full arc on the focus face; the solid success ring and the bloom wait for the confirmation.
- Pointer exit (looking off screen) cancels a dwell at once, and no dwell selects while the pointer is outside.
- Dark theme: the word-in-progress glyphs use lighter group inks on the dark canvas (`--g*-text`); cards keep their inks.
- Card labels size by their longest word (`155cqi / length`), so 200% text grows them until that word fills the card.
- Short windows (≤ 820 px tall): the thread may use the empty row gutter, so the partner turn keeps two lines above a two-line message.
- Caption pills reserve the whole line's size before typing; the typed text sits over it.

### After council round 4

- **The cards persist across the conversation and the menu.** One board of six cards keyed by quadrant renders every screen's slot descriptions (`menuSlots()` and the talk slots). A screen change transitions each card in place: its face colour (pastel → white, white → white, ink → ink) over 150 ms and its content by a 150 ms fade; a quadrant with no action on the new screen fades its card away (inert). Only the rest zone's text cross-fades. Two copies of a card never overlap, so a shared surface never passes through the canvas, labels never double-expose, and no bloom restarts on a copy (measured: Q1 card luma 35.6–50.5 across Menu, Settings and Back, the range being the dwell focus step; four selections, four blooms, none on copies; `evidence/screen-change-luma.json`).
- Calibration ↔ app still cross-fades two stages; both layers paint the canvas and blend with `plus-lighter` at the same duration and easing, so the sum is exactly linear.
- At commit the card face returns to rest at once; the solid accent ring alone marks the latch.
- History shows whole lines only: a turn cut by the top edge is hidden, not half-masked; a newest turn too tall to fit is anchored to its first line and clamped to the whole lines that fit.
- **The dwell arc is compositor-only.** Two half-rings, each clipped to its half of the ring and rotated 0 → 180° with `transform` (right half 12 → 6 o'clock, then left half 6 → 12), replace the SVG stroke-dashoffset arc, which repainted every frame. Fill, drain (unwinding from the current angles while fading) and the post-commit fade all retarget from the computed transform. A Confirm preview shows the full arc at 45% strength; only a confirmed selection shows the solid ring and the bloom.
- Labels, setting names and values, phrases and the suggestion all size by their longest word, so text size up to 200% enlarges them until that word fills the card.
- History reserves two whole partner lines before the live message takes the rest.

### After council round 5

- Card text never breaks inside a word. A measured fit pass (`src/fit.ts`) steps each card's text down until it fits the card's width and height. The longest-word size from round 4 is now only the starting size.
- The bottom row is peers, so its four cards share one text size: the smallest any of them needs. Q1 (primary) and Q4 (secondary) are different ranks and size alone. At 200% on 1280×720, "Recalibrate" holds the Menu row to about 28 px; this is accepted as the physical limit of a 256 px card.
- Card content changes by MOTION's page-change timing, in place: the old face fades out over 150 ms, taking no height, and the new face fades in over 300 ms from 100 ms. The two never show at once.
- **Readable content stays inside Q2–Q3** (Sol R5). The earlier choice to let the thread borrow the empty row gutter at short windows and large text is reversed: a backend quadrant is the whole cell, gutter included, so reading text there could type a letter group. The thread's room is shared in priority order (pill, live message, whole history lines); history yields its second reserved line when the message is past its type floor.
- Peer cards match per text role (label, setting name, setting value, phrase), not by one scale for the whole card; setting names keep 20 px; a crowded card tightens its motif gap before shrinking text.
- The commit click is scheduled at the audio context's current time, in the same task that paints the solid ring.

### After council round 6

- **Cards hold still.** Each card's motif sits at a fixed height derived from the card's height (so a one-line label card still reads as centred) and never follows the face's content; text flows below it. At large text every motif sits 16 px higher, the same for all cards, so letter cards keep their two rows.
- **The outgoing face is what was on screen.** `Swap.tsx` clones the old face's DOM in `getSnapshotBeforeUpdate`, freezes every computed font size inline, and fades the clone out; icons fade the same way. Two timings: a change of screen uses MOTION's page choreography (out 150, in 300 from 100); a change within one screen, such as the candidate while typing, uses the 150 ms label cross-fade with no entrance delay (BRIEF: frequent actions ≤ 150 ms).
- **Support never outranks its subject.** A card's hint is capped at 0.6× its label's fitted size, floored at 20 px.
- **Reduced-motion progress only rises.** The focus cue stays on the face; the ring's brightness is progress alone.
- Trade accepted: at 200% on 1280×720, label cards are top-weighted (the motif sits high so every ring stays still across faces and the letter rows fit).

