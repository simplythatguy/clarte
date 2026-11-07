# Style 4 · Split

A keypad and a screen. The four letter groups form one 2×2 block on the left half, squarer and closer together than a row, so the eye travels less between letters. The right half reads at the bottom and acts at the top. Six actions, two rest zones, no page flip.

Quadrant map: [quadrant-map-compose.svg](quadrant-map-compose.svg).

## Layout

| Quadrant | Action id | Label and behaviour |
| --- | --- | --- |
| Q1 | `G1` | A–F |
| Q2 | `G2` | G–N |
| Q5 | `G3` | O–S |
| Q6 | `G4` | T–Z |
| Q3 | `primary` | Contextual: **Listen** when idle with an empty message · **Stop** while listening or speaking · the **candidate word** while groups are pending (**Spell** when they match no word) · **Speak** when the message has words and nothing is pending · **Say again** for 6 s after speaking · the forward action on every page |
| Q4 | `delete` | **Delete** while a word is being typed · **More** everywhere else in the conversation (see below; superseded the original One moment / Menu mapping after council round 1) · **Back / Close** on every page |
| Q7 + Q8 | rest | The message (44 px) with pending tokens, the partner's last words above it (24 px, secondary) |

The keypad reads in the familiar reading order: A–F top-left, G–N top-right, O–S bottom-left, T–Z bottom-right. The controls sit in the top-right so the frequent accept action is adjacent to the keypad's G–N key and the corner holds the less frequent Delete.

Rest zones: Q7 and Q8 in every state.

## Selection

Default `mode: 'dwell'`, groups 600 ms, controls 900 ms. The keypad block is one bounded region, so a glance from one key to a neighbour is short; the engine's dead band on the grid lines prevents flicker between neighbours.

## Visual direction (original; superseded by the shared light skin, see below)

Bold and tactile, the ToyCAD reference's confidence without its colour count.

- Page `#F5F2EC`. The keypad block is one rounded container (radius 36 px) in `#E7E2D8` holding four keys (radius 24 px, face `#F5F2EC`) separated by 20 px gutters, so the block is the single surface and the keys are cut-outs in it. Each key: 36 px range label weight 700, a 6 px group bar along its outer edge, the dot glyph.
- Controls: two tiles in the top-right, `#ECE8E0`, radius 24 px, 28 px labels. The primary tile uses the accent `#172F93` face with light ink when it offers Speak.
- The conversation (bottom-right) is bare page: no box, message in ink, partner words in secondary.
- State band at the top edge in the state colour.
- Type: a geometric-humanist sans with heft (for example Manrope at 700 for labels, 500 for the message). One orchestrated moment: when a word decodes, the tokens cross-fade to the word and the primary tile's label fades to the next state; nothing else animates.
- Calibration sequence on the same page colour, circles outlined, accent fill.

## What this style tests

- Whether a compact 2×2 keypad lowers travel and fatigue compared with a four-wide row.
- Whether people tolerate the message sitting bottom-right rather than centre.
- Whether one container with cut-out keys reads as "one thing" per the user's minimal-ui rules while still giving four clear targets.

## Acceptance

All brief gates, plus: Q7 and Q8 show "rest" in every state; the keypad container is the only surface on the left half; the dead band keeps the overlay's current-quadrant indicator from flickering when the pointer traces the vertical line between Q1 and Q2.

## Decisions made while building

Recorded by the style 4 builder. Where these differ from the sections above, the reason is given and these win. The visual layer was redone on 2026-11-07 for the owner's shared light skin (BRIEF "Visual direction", "Quality bar") and MOTION.md; the earlier warm-paper skin, Atkinson type, slab and contracting outline are gone.

### Geometry

- Cards float in canvas `#F5F5F7` and are sized for the design, not stretched to the grid (README rule 1). Each card is centred on its backend quadrant's column: width `25vw − 3.889vw` (304 px at 1440, 270 px at 1280), height `39.111vh` (352 px at 900). Column gutter 56 px at 1440 (50 px at 1280); row gutter 116 px at 900 (93 px at 720), the widest, on the row boundary; top and bottom margins 40 px.
- No slab around the keypad. The four group cards read as one keypad by proximity and the shared 2 × 2 rhythm; a container around cards would be a box around boxes (minimal-ui rule 6), and the mock floats its cards bare.
- Radius 40 px on every card. Q7 + Q8 are bare canvas (the conversation) and rest in every state, including the menu, More, Spell and calibration.
- Every card hangs its content from one line (`card-h / 2 − 84 px`), so rings and labels align across each row.

### Faces and colour

- Q3 is always the ink card (`#1D1D1F`, white label): the one primary target. Q4 and page items are white surfaces. Group keys wear their pastel faces (ice, lavender, mint, peach) with their group inks. Because every card keeps its face in every state, mean screen luminance stays constant; the only state-dependent surfaces are the 6 px strip and the quiet (32% content) keys while listening or speaking.
- Faces are the brief's values; the focus cue deepens the dwelt card one step (`#E3F0FA → #D3E6F6` and so on; white → `#ECECEF`; ink → `#2C2C2E`), which is also how a dwelt card's extent becomes visible to low-vision users (the brief's known 1.06:1 limit).
- State: a 6 px strip along the top edge in the state colour (listening `#D70015`, composing ink, speaking `#248A3D`) plus a status line with a matching 8 px dot above the partner's words. Accent `#0071E3` is used only by the dwell ring and the calibration fill.
- Dark theme (Settings): the dark reference's look at matched contrast, primary card light.

### Type

- Satoshi 500/700 (Fontshare), SF Pro and system fallbacks. At 1440 × 900: letters 32/700 tracked +0.10 em (28 px below 1400 px wide, so all eight of G–N fit and every group stays the same size); Q3 label 44/700; Q4 and page labels 40/700 and 32/700; values 20/500; message 52/700 tracked −0.025 em; listening transcript 44/500; partner 26/500; status 20/500; spelled word 64/700. Fitted labels (long candidates, "Recalibrate") shrink in 4 px steps, never off the scale.
- Group cards print only their letters ("G H I J K L M N", real spaces, so the accessible name is the letters) plus a 1–4 pip count glyph; no range label.
- From 150% text the letter rows wrap to two lines of four, the partner turn keeps one line, and the status line yields its height (the strip still shows the state).

### The dwell indicator: the two-circle motif

- Group cards: a solid 64 px dot in the group ink overlapped by the 64 px dwell ring (the reference card's motif). Controls: the same ring around a 1.5 px outline icon. The ring is present at rest as a 1.5 px track at 30%: an instrument, not a box.
- Intent delay 150 ms (letters) / 250 ms (controls): nothing changes. Focus cue: the face steps one shade and the track becomes opaque.
- Progress: a 3 px accent arc fills clockwise from 12 o'clock, linear, over the time left. Built from two clipped half-rings that rotate with `transform`, run as Web Animations, so the compositor runs the fill (measured: 2 paints, 0.07 ms, in a 250 ms fill window). Cancel drains it back from its live value over 150 ms.
- Commit: ring solid accent, the click, and the bloom (a copy of the ring, scale 1 → 2.4, opacity 0.35 → 0, 450 ms, `cubic-bezier(0.23, 1, 0.32, 1)`) on the same frame; the face returns to rest. Keyboard selections get no bloom. Re-arm: the ring stays solid while the eyes stay; a relabel caused by the selection waits until the eyes have left, then cross-fades.
- Setting values are the time from the eyes arriving to the commit (600 / 900 ms): the engine's 150 ms quadrant hold is subtracted from its `dwellMs`. Repeat ("Keep looking") applies to letter keys only; controls always need a look away.
- Reduced motion: no arc, no bloom; the ring's opacity steps in quarters.

### The word in progress

- `pendingGlyphs`: typed glyphs in their group ink, the predicted rest as ghost letters in `#86868B`; one dot per group in the group ink when no word matches (and Q3 offers Spell, labelled "No word"). A changed letter fades in where it stands (150 ms); accepting settles the letters from group ink to ink (180 ms). The Word colour setting keeps group inks on accepted words.

### Capability and positions (council round 1)

- Q4 is **More** in every conversation state except mid-word (Delete) and speaking (quiet). More: Q1 Other word (shows the next candidate and replaces the last word: 2 selections, as Delete → Accept was), Q2 Delete word, Q5 One moment, Q6 Menu, Q3 Listen or Stop, Q4 Back. Each function has one home: One moment only in More, Menu only in More, Recalibrate only in Menu.
- Menu: Phrases, Spell, Settings, Clear message (shown only when there is a message); Q3 Recalibrate; Q4 Close. Settings 1 of 2 and 2 of 2 (Demo is Settings Q6). Q3 is the way forward, Q4 the way back, on every page.
- Spell is reachable from Menu, and from Q3 when typed groups match no word; Add replaces those groups with the spelled word.
- Stop while speaking keeps the draft; a speech failure keeps it and shows "Speech didn't play. Look at Speak to try again." Only a completed utterance moves the message to "said".

### Calibration (MOTION.md)

- Light canvas; 28 px targets with 1.5 px outlines at 30% ink; the active target shows a 6 px centre dot and fills clockwise in accent over the settle (the app's own ring), then blooms. Ink guide dot travels with `cubic-bezier(0.77, 0, 0.175, 1)` (1200 ms nine points, 900 ms check), settles 1800 / 1200 ms, 400 ms beat. Captions in a white hairline pill type at 32 ms per character with 180 ms rests after punctuation; the keyword ("dot", "look") in accent on a 14% tint; earlier lines settle to secondary. Position ring 38% of the short side turns accent with a 12% fill when "found". Ready: title, plain-words result, Start in Q3. About 44 s; Escape skips.

### After council round 2

- The arc's two halves are each hidden until their own turn starts (opacity keyframes at 0 and 0.5), so the clip edges where they meet never draw a hairline at 12 or 6 o'clock, at rest, filling or draining.
- Relabels within one scene (word start, accept, candidate change) cross-fade in 150 ms with no delay; only a change of scene (page, view, listening, speaking) uses the 300 ms phase cross-fade. Keys going quiet change opacity only.
- No motion after keyboard input: content swaps without animation until the pointer moves again (`data-input` on the root). Nothing animates on the first render either.
- Secondary pages carry a 1.5 px outline icon in every ring (swap, delete, hand, menu lines, speech bubble, letter A, sliders, bin, timer, Aa, half-disc, speaker, eye, three circles, flask, scatter, repeat, microphone, grid, quote). Labels sit on the floor of a fixed label row, trimmed to cap height and baseline, so labels of different sizes share a baseline across a row (within 2 px).
- Page forward action is "Next" (with "1 of 2"); "More" means only the conversation's options page.
- Opening Menu from More while listening keeps listening.
- Spell's group level prints letters like the typing keys.
- Large text (150% and up) budgets each card's height: 48 px ring, 12 px gaps, page labels capped at 1.4×, 16 px × scale values. The message always keeps one whole line; the partner turn yields first, and is hidden while an error shows at large text.
- Speech: only the speech API's end event counts as said. No synthesis, no start within 3 s and the watchdog are failures that keep the draft. The recordings use a synthesis test double that starts, reports word boundaries and ends at a speaking pace.
- Letter tracking is +0.10 em, not the brief's "about +0.14 em": at +0.14 em the eight letters of G–N need 266 px at 32 px and the card's inner width is 264 px; +0.10 em keeps every group at the same size.
- The status line is ink, not secondary ink: at 20 px, secondary ink rendered at 4.3:1. Ghost letters use `#7A7A7F` instead of tertiary `#86868B`, which rendered at 2.95:1 once anti-aliased.
- Calibration: the target's ring fills over the settle time (1800 / 1200 ms), as MOTION.md's step list says; "the same rate as the app's dwell ring" is read as the same ring (geometry, colour, flat ends, clockwise from 12), since the settle and the dwell differ by design. The Ready result says what happened: "Simulated run: thirteen points shown, nothing measured."

### After council round 3

- Listening: a local live-recognition wrapper restarts Chrome's recognition when it ends after a silence (the person has not stopped listening), keeps what was heard, and on a microphone error ends listening with "The microphone isn't available. Listening stopped." The scripted partner runs only where the recognition API does not exist (or when chosen in Demo); invented words never stand in for a silent microphone. Recalibrate ends listening. Menu and Spell show the recording status and any notice.
- Arc: it freezes at its live value the moment the gaze point leaves the card's quadrant (the engine's hold and grace keep the dwell alive about 300 ms longer), and drains when the engine cancels. After a commit the solid ring fades to the track over 150 ms instead of unwinding like a cancel.
- Luminance: page items (menus, More, Settings, phrases) take a neutral face `#EDEDF0` at the pastels' luminance; inactive items stay in place, quiet (Other word and Delete word with no word, Clear message with no message); Settings has three pages ending in Demo, so Q3 is always a card. Measured mean relative luminance across every app state: 0.797–0.836 (`evidence/luminance.json`). Calibration is 0.91 on the bare canvas MOTION.md specifies; recorded, not hidden.
- Quick relabels: outgoing 100 ms, incoming 120 ms from 50 ms, so two labels never sit at half opacity together.
- Reduced motion: the ring's track becomes a 3 px accent ring stepping 0.2 → 1 in quarters.
- Keyboard input zeroes animation durations instead of removing animations, so nothing replays when the pointer moves again.
- Speech: the estimated highlight schedule starts on the voice's `start` event.
- Calibration: the guide starts between targets, appears only while it travels and gives way to the target's centre dot on arrival; each target holds, then fills its ring over the final 600 ms of the settle, the letter-dwell pace the app uses.
- Large text centres each card's content; the error dot aligns with the first line; the word in progress is kept out of the live region (only accepted words are announced).
- Page values use `#5F5F64` on the page face (secondary measured 4.34:1 there).

### After council round 4

- The arc follows the engine, not the raw gaze point: it keeps filling while the engine still counts the look (a commit is still possible) and freezes only in the engine's grace, when it cannot commit; it drains on cancel and resumes from its live value if the eyes return. A hold or completion animation always has two keyframes, so the arc never blinks for a frame.
- A key press on a card whose label is still held after a gaze selection only releases the label; the next press acts on what the card says. Nothing acts behind a label it is not showing.
- Speaking: the partner sees Composing until the voice's start event, then Speaking.
- Listening: network and unsupported-language errors, and three back-to-back recognition sessions that end within 2 s without a result, end listening with the microphone notice; the recording status stays visible in words at every text size.
- The Listen icon is drawn in the card's ink; red means listening and appears only on the strip and status dot while recording.
- Calibration's bare screens use the canvas tone `#E9E9EC`, whose luminance matches the app's measured mean, so the calibrated brightness is the working brightness (all states 0.797–0.836); the Ready screen, which carries the ink Start card, keeps the app canvas. The target ring fills over the last 450 ms of the settle: the visible arc of a letter dwell (600 ms setting minus the engine's 150 ms hold).
- Under keyboard input the strip, faces and quiet-key opacity change without transitions too. Blank cards carry no `data-action`.
- At large text the conversation may use the 31 px of Q7/Q8 beside the row line (inside the engine's dead band side) and most of the bottom margin, and the hairline's margins stop scaling, so two message lines fit at 200% on 1440 × 900.

### After council round 5

- A card whose meaning changes while the eyes rest on it (Stop becoming Say again as speech ends, Stop becoming Listen when the microphone fails) is stale until the eyes leave. It shows no progress, and a gaze selection on it does nothing. A key press always acts. A new meaning needs a new look.
- Calibration's canvas tone never fades. Only the scene on it does, so entering calibration cannot flash the screen brighter. Leaving it, the keys arrive with the 300 ms phase cross-fade.
- The status line fades in over 150 ms instead of popping.
- At large text the Q4 label grows to at most 1.4×, so the way back never out-shouts the way forward.
- Q3 stays the ink card on every page (kept): fixed faces hold luminance constant across states.
- The stale rule covers every card, not only Q3 and Q4: a new partner turn can change the word More's Other word offers, and an armed look must not commit the new word.
- A click or a screen reader acts on what the card shows: it clears the stale mark. A click on a card still showing its previous label only releases the label, the same rule as a key press.
- Entering or leaving calibration is one cross-fade. The outgoing stage stays as an inert, still copy (no `data-action`, so the engine and layout check never see it) and fades out over 150 ms while the new scene fades in on the static canvas. Nothing moves under keyboard input.
- Kept (declined in rounds 2–5): Delete stays in Q4 mid-word. The most frequent repair is one selection; One moment and Menu are three while a word is pending (accept or delete it, then More).
