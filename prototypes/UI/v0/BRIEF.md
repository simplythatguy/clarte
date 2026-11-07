# Clarte UI v0 brief

The shared brief for the five style prototypes. Every style thread reads this before touching code. [README.md](README.md) defines the vocabulary (backend quadrants, G1–G4, rest zones). [RESEARCH.md](RESEARCH.md) holds the evidence; numbers below cite it as R-n.

## What Clarte is

Clarte gives clarity of speech back to people with dysarthria and motor disabilities. The person looks at a laptop; a webcam gaze tracker classifies each look into one of eight backend quadrants; they type with four letter groups; a language model turns the group sequence into words; the message is spoken aloud to the person they are talking with.

The users are adults and teenagers with dysarthria from ALS, cerebral palsy, MS, stroke, brain injury or Parkinson's. Many also have reduced hand control, imperfect vision (strabismus, nystagmus, light sensitivity), fatigue, and some have executive or memory difficulties (R-3). The person they talk to is sitting across a table, often a family member, sometimes a stranger. They hear normally.

What a good session feels like: the partner talks, the person listens with the device quietly capturing context, then types a few selections, accepts a prediction, and the sentence is spoken within seconds, with the partner able to see that a reply is coming. Nothing on screen happens that the person did not choose.

## The conversation flow

Two phases, repeated:

1. **Context (Listen).** The person starts listening; the partner's words are transcribed and shown quietly. The person stops listening when the partner is done.
2. **Response (Respond).** The person selects letter groups. Each selection adds a coloured token; the top candidate word appears in the autocomplete slot (exact-length words from the first group, longer completions only from the second group on); accepting it commits the word and is the word boundary. Delete removes the last pending group, or, with nothing pending, takes back the last word and reopens it at the next candidate; a second Delete removes the word. The partner's transcript words are passed to the decoder as `context` so they rank higher. When the message is ready, Speak reads it aloud with the spoken word highlighted. Then back to Listen.

Six feature capabilities exist in every style, however they are laid out:

| # | Capability | Behaviour | Why |
| --- | --- | --- | --- |
| 1 | Listen / Respond mode | Start listening, stop listening, start responding, end | the brief's R1/R2 |
| 2 | Autocomplete | the single most likely word for the pending groups; one selection commits it | the brief's AC; one stationary candidate beats a list for gaze (R-2, R-3) |
| 3 | Delete | last pending group; with nothing pending, reopen the last word at its next candidate (so Delete then Autocomplete is "other word"); a second Delete straight after a reopen removes the word | the brief's D; shipping systems separate delete-unit, cycle and delete-word, and avoid character backspace (R-2, R-5) |
| 4 | Speak | speak the message aloud, highlight each word as spoken; afterwards the same slot offers Say again for a few seconds | speaking is the product; repair must be one look away (R-3) |
| 5 | One moment | speaks a short floor-holder ("One moment, I'm answering") without touching the message | partners misjudge silence as incompetence; a one-selection floor-holder is the documented fix (R-3, R-5) |
| 6 | Menu | settings (dwell times, text size, theme, sound, selection mode, token colours), recalibrate, clear message, saved phrases, and the entry point for Spell (letter-exact typing for names; designed in each style, implemented if time allows) | every shipping gaze product exposes these one step away (R-5); dictionary-only decoding fails on names (R-2) |

Capabilities 4 to 6 are the three features proposed to complete the six. In style 1 they live on the second page behind the flip arrow. In the other styles they are reached contextually or through Menu, and each `DESIGN.md` says exactly how.

## Non-negotiables

These apply to every style. A style that cannot satisfy one says so in its report instead of bending it.

**Backend quadrants.** At most one actionable element per quadrant; an element may span quadrants; empty quadrants are rest zones. Mark every actionable element with `data-action="<id>"`. The developer overlay must show no violation in any phase, and `node shared/selftest.ts` plus the style's layout check must pass.

**Hit region is the quadrant; the drawn tile is not.** Selection is decided by the backend quadrant, so a tile does not have to fill its quadrant. It can be any size and sit anywhere inside it, as long as it does not cross into another quadrant (README rule 1). Size tiles for the design, as the reference shot does with cards that float in generous canvas, and keep inactive gutters of at least 1° (about 50 px at 1440×900) between tiles in neighbouring quadrants, with the widest gutter on the row boundary because vertical accuracy is the worse axis (R-1, R-4). Tiles are rounded (radius 32–40 px), flat, with the label centred and no outlines or sharp corners, which pull the eye to edges (R-5 Apple, Meta). The developer overlay still shows the full quadrant as the hit region.

**Selection.** Dwell is the primary selector; blink or key confirm is optional (R-1, R-5). Two dwell classes: letter groups 600 ms, controls 900 ms, both adjustable from 300 to 2000 ms (R-1, R-3). Choreography per selection (R-6 §3.1): nothing visible for the first 150 ms on groups and 250 ms on controls, so glances light nothing up; then one static focus cue on the tile; then a progress indicator centred on the tile that contracts or fills toward a visible end state, showing time remaining, with the label staying put; a short non-speech click (≤ 100 ms) at commit; the ring drains back over 150 ms when the dwell is cancelled instead of vanishing. The decoded word may be spoken softly as an option; letters are never spoken (R-1, R-5). After a selection the target does not fire again until gaze has left it; no auto-repeat (R-1, R-5). A dwell survives gaze leaving for up to 150 ms and ignores blink gaps up to 200 ms (R-6). Looking off screen cancels an in-progress dwell. No gaze cursor is drawn by default. Distinct, tiny earcons for commit, phase change and delete; an error tone, if any, delayed by about a second. The shared engine implements the timing rules; styles change its settings, not its rules, and own the visual rendering of these states.

**Rest.** The person must always have somewhere safe to look while reading and thinking. Styles 2 to 5 reserve real backend quadrants for the message and transcript. Style 1 has none during composition, so it defaults to the confirm step, exactly like the current tracking prototype. The centre text is never actionable.

**Nothing happens on its own.** No auto-commit, no auto-speak, no suggestion inserted without a selection, no time limit the person cannot change (R-3). Listening never stops on a timer.

**Luminance.** The page is light by default: canvas `#F5F5F7`, surfaces `#FFFFFF`, ink `#1D1D1F` (the apple.com neutrals the owner chose, see Visual direction below). Mean screen luminance stays constant across every state: no dimming overlays, no flashes, no light-to-dark phase changes (R-4). A dark theme exists only as an explicit option at matched APCA contrast, and it may take the look of the dark reference shot. Reason: positive polarity reads better for all ages and keeps the pupil small, and pupil change shifts measured gaze by about 2.6° on average, a third of a quadrant (R-1, R-4).

**Letter groups show their letters.** A tile never says "A–F": the person would have to work out which range a letter falls in. Each group tile prints all of its letters, "A B C D E F", "G H I J K L M N", "O P Q R S", "T U V W X Y Z" (`groupLetters` in `shared/decoder.ts`), in one row, 28 to 36 px, weight 700, tracked about +0.14em, in the group ink on the group face, with the count glyph beneath or beside it. Eight letters fit one row on a 1440 px wide screen; at 200% text the row may wrap to two lines of four, never shrink below 24 px. The range label is for prose, the overlay and accessible names only. Friendly and minimal means the letters are the only text on the tile.

**Colour.** The screen is neutral: canvas, white surfaces, ink `#1D1D1F`, secondary ink `#6E6E73`, tertiary `#86868B`, hairline `#D2D2D7`. Chroma is spent on four things only: the four letter groups, the conversation state (listening, composing, speaking), the dwell progress, and errors. The one primary target is an ink fill with a white label, the strongest contrast on screen; secondary targets are white surfaces; the dwell indicator fills in accent `#0071E3` and nothing else uses that blue. Group identity is never carried by colour alone: the range label ("A–F"), the fixed position and a count glyph carry it too, because no four-hue palette survives dichromacy (R-4). Each group has a pastel face and a group ink used for its label, its glyph and its token mark: G1 face `#E3F0FA` ink `#1E5A82`, G2 face `#ECE4F8` ink `#59409A`, G3 face `#E2F3EA` ink `#2B6A4C`, G4 face `#FBEADD` ink `#8A4A22`. Group ink on its face measures 5.6:1 to 6.5:1 and on the canvas above 7:1. Known limit: the pastel faces sit at about 1.06:1 against the canvas, so a tile's extent is found by hue rather than luminance; styles may deepen the faces slightly (about 1.25:1 against canvas) or add a 1.5 px group-ink outline on the dwelt tile only, and must say what they chose. The research palettes P2 and P1 remain the fallback for a theme where these faces cannot be used (RESEARCH §4).

**The word in progress.** While composing, the message shows the current best decode, not range tokens: one glyph per typed group, each the candidate's letter in that position set in that group's ink, followed by the rest of the predicted word as ghost letters in tertiary ink (`pendingGlyphs` in `shared/composer.ts`). Each new glyph appears in place with a 150 ms opacity cross-fade; nothing slides. When the word is accepted the glyphs settle to plain ink over 180 ms and the colour is dropped (R-4). When no candidate exists, show one dot per typed group in the group ink. A setting keeps group colours on accepted words so the team can compare it with the original sketch; the evidence says the plain word reads better.

**Type and contrast.** Satoshi (Fontshare, free licence) at weights 500 and 700, with SF Pro and the system sans as fallbacks; if Satoshi cannot be loaded, a humanist or neo-grotesque sans with x-height ratio ≥ 0.5 and distinct I, l and 1. At 1440×900 and 60 cm: message 44–52 px weight 700 tracked −0.025em, group range labels 44–64 px weight 700, group letters 22 px weight 500 tracked +0.18em, control labels 26–44 px weight 700, partner words 26 px weight 500, nothing below 20 px (R-4). Message contrast APCA Lc ≥ 90 (≥ 7:1), labels Lc ≥ 75, every state change, dwell ring and group mark ≥ 3:1 against what it sits on. Text size setting up to 200%.

**Motion.** Frequent actions get no motion: at most a 150 ms opacity or colour change. Dwell feedback fills in place. Phase transitions are one orchestrated 250–400 ms moment with `cubic-bezier(0.2, 0, 0, 1)`, exits 150–200 ms, and under `prefers-reduced-motion` everything becomes an opacity cross-fade (R-4, R-6). No idle motion anywhere: no breathing rings, no pulsing dots, no blinking caret above 1 Hz. Nothing moves while a target is armed.

**Partner awareness.** The state (Listening, Composing, Speaking) is readable from across a table: a band or field at the top edge in the state colour, with a short earcon on transitions (R-3, R-5). Recording the partner is visibly indicated. The last partner turn stays visible while composing.

**Capability.** Everything in the six capabilities is reachable within one or two selections from the screen where it matters. Nothing is removed to make a screen look simpler. One major thing per screen (the message while composing, the transcript while listening, the spoken sentence while speaking), per the user's minimal-ui rules.

**Fixed positions.** A function may change label with context, but never moves between quadrants within a style (R-3, R-5).

## Visual direction (decided by the owner, 2026-11-07)

All five styles share one skin so the comparison isolates layout. The look is the reference shot `reference/09-style-ref-fintech-dark.png` (a finance app: soft oversized radii, pastel ice-blue and lavender cards, geometric sans, pill highlights, thin outline icons, generous empty space) rendered **in light mode** with colours inspired by apple.com; the owner supplied the canvas swatch `reference/10-light-canvas-swatch.png` (`#F5F5F7`). The token mapping, measured contrast and a mock of the style 2 compose screen in this look are in `s0/DESIGN.md` and `s0/static.html` (open it in a browser; press G for the quadrant grid). Treat the mock as the reference for proportion and mood, not as the layout for your style.

**The mock is the minimum visual quality bar, not only a reference for proportion and mood.** The owner saw it next to the first builds and called it "much more beautiful than the UI the threads are currently working on". Its screenshot at 1440×900 is `reference/11-light-direction-mock-1440x900.png`. Every style's reskinned compose screen must look at least this calm and polished, while keeping its own layout, quadrant map and interactions. Before a style reports done, its builder puts its compose-screen screenshot next to this mock at the same viewport (one image, side by side, saved in `evidence/`), and the builder and both council members say plainly whether it matches or beats the mock on whitespace, type scale, radius, colour restraint and finish. If it does not, it is not done. One correction to the mock: it leads each group tile with a large "A–F" range label; per the owner's later decision, the group's letters themselves are the primary label (see "Letter groups show their letters"), and the range label is not shown.

Carry over from the reference: cards that float in canvas rather than tiles that fill their quadrant; one pill-shaped highlight for the active state; the two-overlapping-circles motif, where the solid circle is the group ink and the second circle is the dwell ring that fills clockwise in accent blue; thin outline icons (1.6 px stroke on a 24 px grid, rounded caps); typographic hierarchy by weight and size, not by boxes. Do not carry over: the dark canvas (dark is the optional theme), decorative gradients, drop shadows, or more than one accent.

The earlier per-style visual directions in each `DESIGN.md` are superseded where they conflict with this section; each style keeps its layout, its quadrant map, its dwell-indicator form and its interaction decisions.

## Quality bar (owner, 2026-11-07)

The owner judged the first builds "nowhere near" the Neuralink Link calibration flow in quality and motion, and the bar is **equal or better, minimum equal**. [MOTION.md](MOTION.md) measures that flow frame by frame and translates it: tokens, the dwell indicator, the choreography of every frequent event, the captions, the calibration sequence and a ten-point acceptance list that the council verifies on a recording. Treat the visual layer of a build that predates this section as a draft to redo; keep the engine, the layout and the quadrant map.

Review against the full skill set before calling anything done: `skills/apple-hig-ui` (Apple's Human Interface Guidelines distilled for Clarte), the Emil Kowalski skills in `skills/` (`review-animations` with its STANDARDS.md, `choreograph`, `animation-performance`, `emil-design-eng`, `apple-design`, `break-ui`, `find-animation-opportunities`, `remove-animations`, `animation-vocabulary`, `prototype`), `skills/better-ui`, `skills/frontend-design`, `skills/design-html/sections/doctrine.md` and `craft.md`, `skills/lintapple-ui`, and the owner's `minimal-ui`. Run `review-animations` and `break-ui` on your own build and put their tables in REPORT.md.

## Calibration and first-run sequence

**Superseded (owner, 2026-11-07):** onboarding is out of scope for v0; the product keeps the existing calibration flow from `prototypes/Eye Tracking`. The section below records what the styles were built against.

Each style includes a short simulated calibration sequence that opens the app the first time and is reachable from Menu as "Recalibrate". It does not track anything; it demonstrates the motion language, which must be very close to the reference video in `reference/08-calibration-motion-reference.webm` (stills in `reference/calibration-frames/`): one title at a time, outlined circle targets that fill with one semantic colour when active, a quiet caption that types itself, nothing else on screen. Keep the reference's simplicity and pacing but on this style's light surface, because luminance must match the working UI and calibration must happen at the working brightness (R-1, R-4). Steps: a positioning check (one circle, "Sit so your face fills the circle"), nine points covering the grid extremes in reading order with a guide dot that travels between points at the tracking prototype's pace (move 1200 ms, settle 1800 ms) and a small high-contrast dot at the centre of each outlined target, a short validation with four different points, then "Ready" with the result in plain words. About 30 s in total. Skippable with a key for demos. Evidence for each property is in R-6 §3.4.

## The simulator

There is no tracker in these prototypes. The shared engine takes the mouse as the gaze point (`attachPointer`) with an optional jitter setting that reproduces webcam noise (set `noiseSigma` to 0.06 to feel it), keys 1–8 select the action in Q1–Q8 directly, Space or Enter confirms a preview, Escape cancels, and the backquote key shows the developer overlay with the grid, the gaze point, dwell progress and any rule violation. Every style exposes these in its Menu as a "Demo" section: gaze noise on/off, selection mode, dwell times.

Listening uses the browser's speech recognition when it exists (Chrome, online) and a scripted partner utterance otherwise. Speaking uses the browser's speech synthesis.

## Deliverables per style

Inside `prototypes/UI/v0/sN/`:

- A Vite + React 19 + TypeScript app with its own `package.json`, importing `../shared/*.ts` directly. `npm install && npm run dev` serves it on the port in the README. No UI kit, no CSS framework; plain CSS or CSS modules with design tokens in `:root`. Fonts: a system stack or a self-hosted or Google-hosted humanist sans; no icon fonts, inline SVG only.
- `window.clarteDebug = { phases, phase(), setPhase(name), validate(), engine }` so `node ../shared/check-layout.mjs http://localhost:PORT out-dir` can walk every phase, assert zero violations and save screenshots.
- `DESIGN.md` (already written, keep it updated with decisions made while building).
- `REPORT.md`: what was built, the screenshots and demo recording paths with what each shows, the layout check output, the council rounds table with scores, what was changed after each round, open questions, and a "Methods used" receipt.
- No commits. Leave the work in the working tree; the team reviews all five together.

## Quality gates

1. `node prototypes/UI/v0/shared/selftest.ts` passes and `check-layout.mjs` reports zero violations in every phase at 1440×900 and at 1280×720.
2. The user path works with the mouse as gaze, with keys only, and with noise on: listen, type a word with the groups, accept the candidate, delete and reopen, speak, one moment, open and close the menu, recalibrate.
3. Keyboard focus is visible, every control has an accessible name, reduced motion is honoured, text scales to 200% without overlap.
4. The screenshots are opened and looked at before they are reported. The minimal-ui "Verify a screen" pass is run on them and its findings fixed or justified.
5. Council review (see below) reaches agreement.

## Council

Each style runs the council from `skills/council` (the tstack council skill, read it in full). The user named the members: Claude Opus 5.5 at high effort and GPT-6.1 Sol at max effort, started in parallel with `delegate_task` after resolving them with `orchestrator_capabilities`. Give each delegate this brief, the style's `DESIGN.md`, `MOTION.md`, the research synthesis, the screenshots and recording, and the code paths; keep their work read-only; ask for findings, disagreements, two scores out of 10 (one for the design and interaction, one for craft and motion against MOTION.md's acceptance list, scrubbed on the recording), and whether the style honours the backend quadrant rule, the non-negotiables, the user's minimal-ui rules and the `review-animations` standards. Apply what you agree with, say what you declined and why, request a fresh round, and stop when both delegates are satisfied or when a round changes nothing. Fight scope creep: the deliverable is this style, not a product.
