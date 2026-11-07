# Style 2 · Corners

The letter groups own the four corners of the screen, the most robust positions for quadrant classification because the screen edge clips gaze error back into the same cell. The conversation rests in the two top-centre quadrants, where the eyes are most comfortable. Two controls sit below it. Six actions, two rest zones, no page flip.

Quadrant map: [quadrant-map-compose.svg](quadrant-map-compose.svg).

## Layout

| Quadrant | Action id | Label and behaviour |
| --- | --- | --- |
| Q1 | `G1` | A–F |
| Q4 | `G2` | G–N |
| Q5 | `G3` | O–S |
| Q8 | `G4` | T–Z |
| Q2 + Q3 | rest | Partner's last words (quiet, 24 px) above the message (44 px) with pending tokens |
| Q6 | `primary` | Contextual: **Listen** when idle with an empty message · **Stop** while listening · the **candidate word** while groups are pending · **Speak** when the message has words and nothing is pending · **Say again** for 6 s after speaking |
| Q7 | `delete` | **Delete** while composing (pending group, else reopen last word) · **One moment** while listening · **Menu** when idle with nothing to delete |

Reading order of the groups is the Z pattern: top-left, top-right, bottom-left, bottom-right. The range labels make the order explicit.

Rest zones: Q2 and Q3 in every state.

## Selection

Default `mode: 'dwell'`, groups 600 ms, controls 900 ms. Because the rest zone is real, reading never arms anything. Confirm mode remains available in the Demo menu.

The primary slot changes label with context, so it must announce each change in a way the eye catches without motion: the label cross-fades (150 ms) and the tile's accent bar changes to the state colour. The slot never changes while the person is dwelling on it; a pending change waits until gaze leaves.

## Visual direction

The scientific instrument the user asked for, on a light surface because the tracker and the reader both prefer it.

- Page `#F5F2EC`, ink `#1A1A1A`, secondary `#5A5A5A`, hairlines `#D9D4CA`. One accent, `#172F93`, used only for the primary tile when it offers Speak and for the dwell indicator.
- Group tiles are quiet: neutral face `#EDE9E1`, radius 28 px, a 5 px group-coloured bar on the edge that faces the centre of the screen (so the four bars frame the conversation), label 32 px weight 600 with the dot glyph.
- Controls are typographic tiles with a thin outlined-circle motif from the calibration reference as the dwell indicator: the circle outline sits beside the label and fills clockwise as dwell progresses.
- The conversation area has no box. The partner's words sit in secondary ink; the message in full ink. A 1 px hairline separates the two.
- State for the partner: a 10 px band across the top edge of the screen in the state colour (listening green, composing neutral graphite, speaking accent) with a 20 px label at its left end.
- Dark theme available in Menu at APCA-matched contrast (page `#121212`, ink `#F5F5F5`, dark palette variant) so the team can compare luminance against the tracker; the default stays light.
- Type: a neo-grotesque with tabular figures (Inter, IBM Plex Sans or Söhne-like). Calibration sequence on the light page: outlined circles, accent fill, typewriter caption, exactly the reference's rhythm.

## What this style tests

- Whether corner placement is more robust than a bottom row under gaze noise (compare with style 1 using the noise setting).
- Whether a contextual primary slot is understood or whether people lose track of what it will do.
- Whether placing the conversation top-centre keeps the eyes comfortable and the reading safe.

## Acceptance

All brief gates, plus: Q2 and Q3 show "rest" in the overlay in every state; the primary slot never relabels while dwelt on; the Z reading order is visible from the labels alone with colour removed (test with a greyscale filter).

## Decisions while building

Recorded as made. The owner's visual direction (BRIEF "Visual direction", "Quality bar") and MOTION.md supersede the visual section above where they conflict; this style keeps its layout, its quadrant map, its centred dwell indicator and its interaction decisions. Where a decision departs from the brief, the reason is given.

### Geometry (8 px grid)

- Cards float inside their backend quadrants: 32 px from the screen edges and 64 px between columns, 40 px top and bottom, an 80 px gutter across the row boundary (vertical accuracy is the worse axis; R-1 §25). That is 296 × 370 px at 1440×900 and 256 × 280 px at 1280×720, taller than wide, the same proportion as the owner's mock. Radius 40 px (BRIEF 32–40). No border, no shadow. Card padding 20 px.
- The rest zone is exactly Q2 + Q3. Nothing in it is actionable; `scripts/walk.mjs` checks Q2 and Q3 hold no enabled action in all 17 phases.

### Skin

- The owner's tokens: canvas `#F5F5F7`, surface `#FFFFFF`, ink `#1D1D1F`, secondary `#6E6E73`, tertiary `#86868B`, hairline `#D2D2D7`, accent `#0071E3` for dwell progress only. Group faces and inks as in the brief.
- Satoshi 500/700 from Fontshare, SF Pro and the system sans as fallbacks.
- **Primary (Q6)** is an ink card with a white label in every state, the strongest contrast on screen. It is always ink, so mean luminance never changes when its function changes. Q7 and menu cards are white surfaces.
- **Partner state band**: 8 px at the top edge, transparent in Ready, so the band appearing at all means "something is happening": listening `#D70015`, writing a reply ink `#1D1D1F`, speaking `#C4136E`. Each has its word and an 8 px dot in the rest zone. Round 1 found Ready and composing indistinguishable as two greys; this fixes that. Listening stays red (the recording convention), not green, because G3 mint and the old green state collided.
- **Focus cue**: the brief offers deeper faces or a 1.5 px group-ink outline on the dwelt card. I chose neither. The static cue is MOTION's own: the face steps one shade (8% of the card's ink mixed into the face) and the ring's track turns fully opaque in the card's ink (5.6–6.5:1 on the face). An outline sits at the card's edge, and edges pull the eye from the centre (R-5 Apple, Meta); the opaque ring sits at the centre where the eye already is.
- **Dark theme**, an explicit option for light sensitivity: canvas `#161617`, surfaces `#232325`, light ink, accent `#2997FF`. The primary stays a filled card with a white label but in mid-grey `#444446` (white 9.7:1, accent 3.2:1), so it is not the brightest card on screen (round 2). The group faces become deep tints with light inks (`#1C2A36`/`#A9CFEF`, `#262036`/`#C9B8F2`, `#1B2C24`/`#A6DCBF`, `#33251B`/`#F2C4A2`; 8.7–9.5:1). **Deviation from the reference shot**, which keeps pastel cards on a dark canvas: in a theme that exists for photophobia, four light cards would be the brightest things on screen.

### Type

- Letters on group cards: 36 px weight 700, gap 0.24em, in the group ink; one row of up to eight letters at 1440×900 (the brief's 28–36 px). As text grows, the size cap rises with the text scale, so the row wraps into two halves (G H I J / K L M N) instead of shrinking; never below 24 px.
- Message 52 px/700, −0.025em, leading 1.16. Partner 26/500 secondary (44/700 ink while listening, when it is the major thing). Control labels 40/700, −0.02em; candidate 44/700. Labels enlarge fully with the text size and wrap only between words; each word is unbreakable, and if the widest word would not fit the card, the label's size comes down just enough (`FitText`; round 3: "Recalibr / ate" broke mid-word at 200%). Control labels on one screen then share the smallest fitted size, so same-role labels never differ (round 4). Consequence: at 200% on 1280×720 the Menu's labels stay at 40 px because "Recalibrate" (the brief's word) is the widest; at 1440×900 they reach 47 px. Settings: name 20/500 secondary, value 32/700. Status 20/500. Titles 52/700, −0.03em.
- At 150% and 200% text, secondary labels (status, setting names, phrases) grow at half rate, so the primary labels can double without overflowing (checked in every phase at 100, 150 and 200% at both viewports: no card overflows). The message first shrinks back toward 100% to fit, in height and in width (round 4: a long accepted word at 200% ran past the right edge) (its size is declared on the message box itself, where the fit sets `--msg-scale`; round 2 found it declared at `:root`, where the fit had no effect), then follows its tail by whole lines; the partner line drops from three lines to one. The partner's words are word spans too, so the transcript is clipped by whole words, and a tail starts with "…" so it never reads as a fragment (round 3). Checked with the real setting, not a CSS override, in every phase at both viewports by `scripts/regress.mjs`, which measures rendered text bounds.

### Group cards: letters and the two circles

- **Letters, not ranges** (owner decision): "A B C D E F", "G H I J K L M N", "O P Q R S", "T U V W X Y Z" from `groupLetters()`, the only text on the card. The range names ("A–F") remain only in accessible names ("G H I J K L M N, group G to N").
- **Count glyph and dwell ring**: beneath the letters, the visual direction's two overlapping circles. A 44 px solid disc in the group ink carries dice pips (one to four, in the face colour), so the Z order reads without colour; a 48 px ring overlaps it by 10 px and is drawn above it, so the whole arc stays visible as it fills (round 2: the disc hid its last third). Checked in greyscale (`evidence/greyscale-compose.png`).
- **Centred, not corner-anchored**: the mock puts its marks top-left and its labels bottom-left. The brief's non-negotiable is "label centred" (R-6 §3.7: labels in corners draw the eye to the corners), so the composition is centred.

### The word in progress

- A disabled primary keeps its content at 60% (not 32%), because "No word" is a blocked reason the person needs to read (round 4).
- From `pendingGlyphs()`: each typed group shows the candidate's letter in that group's ink, then the predicted rest in tertiary ink as ghost letters ("Yes **outs**ide"). With no candidate, one dot per typed group in the group ink, and Q6 shows "No word", disabled (a rest zone), instead of committing raw ids. Round 1 found accepting a no-match committed "G4·G4·G4".
- Each new glyph fades in over 150 ms. The ghost cross-fades when the prediction changes. On accept, the glyphs settle from group ink to plain ink over 180 ms, colour only.
- The removed glyph on Delete disappears instantly rather than fading out over 120 ms as MOTION lists. A fading glyph would overlap the ghost letters that take its place; nothing moves either way.

### The dwell indicator, built to MOTION.md

- Rest: the 1.5 px track at 30% of the card's ink.
- Focus on a white card steps the face to `#E8E8ED`, so the card keeps its edge against the canvas while dwelt (round 3). The primary steps to `#2A2A2C` (dark: `#48484A`), which keeps the accent arc at 3.05:1 (dark 3.03:1) while it fills (round 4: the lighter step dropped it to 2.97:1).
- 0–150 ms (groups) or 0–250 ms (controls): nothing changes.
- Focus, one static step: the face steps one shade and the track turns opaque.
- Progress: a 3 px accent arc closes clockwise from 12 o'clock, linear, over the remaining dwell. It is two half-rings rotating inside overflow-clipped halves (transform only), so it is compositor work. A trace of a dwell window on the production build shows 0 layouts, 0.42 ms of paint (all of it the 150 ms focus step), a longest task of 1.3 ms, and no main-thread work for the arc (`evidence/perf-dwell.json`). An idle window shows 0 layout and 0 paint (`evidence/perf-baseline.json`).
- Cancel: the arc drains back to 12 o'clock as one arc, the second half first then the first, 150 ms in all with `--ease-out`, retargeting from the current angle (round 2: both halves drained at once and showed two arcs). At rest the half-rings are hidden, so no accent seam shows.
- Commit: the ring turns solid accent at 3 px for 120 ms, the click plays on the same frame, and a copy of the ring blooms (scale 1 → 2.4, opacity 0.35 → 0, 450 ms, `--ease-out`) through the Web Animations API, transform and opacity only. Layout never moves. The solid ring and bloom are drawn on the card itself (measured over the ring's position, removed when finished), not inside the label layer, so they survive a selection that changes the screen (round 4: Menu, Done, Listen from the Menu and Start lost their bloom).
- Latched: the ring stays solid while gaze stays. The moment gaze leaves it fades to the track over 150 ms (it does not unwind: unwinding means "cancelled", the wrong signal right after a commit; round 3), before the engine's 300 ms re-arm, so a solid ring can never sit under a label that has already changed.
- Reduced motion: no bloom and no rotation. The full ring fades in by four opacity steps over the dwell and fades out on cancel; every other change is a fade in place (round 2).
- Keyboard input: no motion at all (MOTION, review-animations). Transitions and animations are cut to zero for the frames after a key.

### Selection safety

- A card is keyed by its quadrant so its face persists across screens; when its action changes, any dwell state from the previous action is cleared, and the painter clears any card it no longer tracks (round 2: a solid "selected" ring stayed on More, OPQRS and the disabled Menu after a menu round trip).
- Accept commits only the word the slot shows: if the composition changed under an armed look (a key typed meanwhile), nothing is committed (round 2).

- **No chaining**: when a gaze selection changes what occupies the quadrant (Menu opens and Q7 becomes More; Done returns and Q6 becomes Listen), the new occupant is held out of the actionable set until gaze leaves the quadrant. Without this, the engine's per-action latch let a resting look fire Menu, then More (found in the T3 recording).
- "Keep looking" (redwell) repeats letter groups only; a control never repeats. Round 1: holding Speak spoke twice and cleared the message.
- A selection that would do nothing returns before the click and the commit cue.
- A digit key or click acts on the slot's current function, never on a label held under the gaze. Space and Enter are the gaze confirm (look + key mode), so they act on the label shown (round 4: Space after speech ended spoke again under a held "Stop").
- Straight after a reopen, Q7 reads "Delete word" ("Delete the word"), because that Delete removes the whole word (round 4).
- Leaving the window streams empty samples, so the engine drops the quadrant after its 200 ms blink grace and an in-progress dwell is cancelled. Round 1: leaving at 84% still fired Speak.

### Contextual slots and capability (changed after round 1)

| State | Q6 (primary) | Q7 |
| --- | --- | --- |
| Ready | Listen | Menu |
| Listening | Stop | One moment |
| Groups pending | the candidate word (No word, disabled, without one) | Delete (last group; right after a reopen, the word) |
| Words, nothing pending | Speak | Menu |
| Speaking | Stop | Menu (disabled) |
| Said (6 s) | Say again | Menu |

- **Deviation from the table above**: Q7 was Delete whenever anything could be deleted, so Menu, Recalibrate, One moment and Clear were unreachable mid-message. Now the Menu's first page leads with what composing needs: Recalibrate (Q1), One moment (Q4), Other word (Q5: reopens the last word at its next candidate, the old "Delete with nothing pending") and Listen (Q8). For a phrase it reads "Delete word" and removes it. The cost: "other word" is two looks instead of one.
- **Capability, honestly counted**: the six capabilities are one look (Listen, Accept, Delete while typing, Speak, Menu) or two (One moment and Listen while composing, Other word, Recalibrate). Menu items one page further are three: Clear, Phrases, and changing a setting (four). One gap remains and is recorded as a non-negotiable not fully met: **while letter groups are pending**, Q7 is Delete, so Menu is reached only after deleting the pending groups. Sol proposed making Q7 Menu during composition as well and moving Delete into the Menu. I declined: deleting a mistyped group is the most frequent repair in this keyboard, and doubling its cost to buy faster access to rare functions mid-word is the wrong trade for the person typing.
- Menu pages, each keeping the geometry (Done in Q6, the next page in Q7, the title in the rest zone): Menu → More (Phrases, Clear) → Display (text size, theme, sound, word colours) → Selection (letter dwell, control dwell, select by, repeat) → Demo (gaze noise, partner, grid in development). Every setting card shows its current value under its name, with the ring alone above (an earlier dot inside the ring read like a selected radio button; round 4); dwell times step through 0.3, 0.45, 0.6, 0.9, 1.2 and 2 s.
- **Spell** is designed, not built: a fifth Menu entry where the corners show the groups, and choosing one splits its letters into halves across the corners, three looks per letter, with Q6 adding the word. Q2 and Q3 stay at rest.

### Listening and speaking

- One moment goes through the same speech outcome as Speak: holding is always released, the microphone always resumes, and a blocked or silent attempt says so with the delayed error tone (round 3).
- If speech cannot start (the browser blocks it, or no voice), nothing is reported as spoken: the message comes back exactly as it was, the status line says in red what is blocked and how to fix it ("Speech is blocked until this page is clicked once." or "Speech did not start. Look at Speak to try again."), and the error tone plays about a second later (round 2). Browsers allow speech only after one user activation; a gaze-only person in a browser needs one click from a helper, which an installed product would not.
- The microphone is a local session (`src/mic.ts`): the transcript is cumulative and never duplicated, a session that ends (including Chrome's silence timeout) restarts with a short backoff so listening never stops on its own and a quiet partner never becomes invented speech (round 3), the device's own "One moment" is not transcribed (the microphone pauses while it speaks), and only a fatal error (no permission, no device, no network) switches to the scripted partner, which is always disclosed ("Listening to the script", Partner: Script). Without speech recognition at all the script is used and disclosed the same way (round 2).

- The read-along highlight follows the speech engine's word boundaries and ends on its `end` event, with an estimate only when the voice reports no boundaries (`src/readAlong.ts`). Round 1: the old estimate kept "Speaking" up after speech had ended.

### Calibration (MOTION.md step by step)

- Position: a 1.5 px ring of 38% of the shorter side; the caption pill types "Sit so your face fills the circle." at 32 ms per character, with a 180 ms rest after punctuation and "face" highlighted. After the 1.2 s check the ring turns accent with a 12% fill and "Good." types; then a 600 ms beat.
- Nine points: 28 px outlines fade in together at 30%. The ink guide travels 1200 ms on `--ease-move`. The point's ring fills in accent over 1800 ms (the app's own arc, so calibration teaches it), then blooms (450 ms), returns to its 30% outline, and a 400 ms beat follows.
- Check: four points, travel 900 ms, settle 1200 ms; "One more look."
- Ready: the title, the result in plain words, then Start (Q6) and Again (Q7). Escape skips; the whole sequence is about 45 s.
- Caption pills are sized by their whole line from the first frame (they appear whole and never grow while typing), wrap within 90% of the screen at large text, and sit in a band no guide path crosses: under the position ring; for the nine points right of centre (72vw, 35vh), between the long diagonal from the end of the first row and the middle row; for the check, top centre. `scripts/regress.mjs` samples every leg of both paths against the caption at 100% and 200% on both viewports (round 3: the caption hid the guide on the first row). The key word is tinted in the accent only when it is about dwell ("Good.", "look"); otherwise in ink.
- Captions are one white pill per line (1 px hairline, radius 12, padding 10 × 14, 20 px/500), placed 24 px beside the active area. Earlier lines settle to secondary ink, and the caret is a still 1 px bar.

### Performance

- Creating the AudioContext cost about 95 ms on the frame of the first commit. It is now created during idle time at startup (`prepareAudio`).
- A cross-fade bug replayed every label's fade-in on the first re-render after load; only layers created by a change animate now.
- A screen or page change (conversation ↔ menu, menu pages, calibration steps) is one cross-fade of the rest zone and every card's content: out 150 ms, in 300 ms from 100 ms. A label change within a screen is the 150 ms label cross-fade. Cards quiet or wake over 300 ms by opacity (round 2). A label change within a screen is staggered: the outgoing label fades in 100 ms and the incoming one starts at 60 ms, so two labels are never legible on top of each other (round 3: "SaStopain").

### Simulator

- The mouse is streamed at 30 Hz as a tracker would be. Proposed for shared in REPORT.md.
- `?phase=<name>` opens any phase directly.
