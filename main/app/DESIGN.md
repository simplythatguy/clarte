# Clarté app (UI v1 · s1)

The first UI v1 prototype (owner, 2026-11-08). It began as UI v0's style 8 ("Cloud, second pass", itself a copy of style 7 · Cloud, PR #17) and moved here from `prototypes/UI/v0/s8`. The sections below record its decisions in the order they were made; where a later one replaces an earlier one, the later one says so. For what it inherits, see v0's [style 7](../../v0/s7/DESIGN.md) and [style 6](../../v0/s6/DESIGN.md).

It now lives in `main/app` as the app itself (owner, 2026-11-08), with v0's shared engine copied into `src/core`, the prediction engine's words, the first run (Welcome, eye calibration, voice cloning) and the webcam eye tracker; see [main/README.md](../README.md). Run it with `./clarte ui` from the repository root, or `npm ci && npm run dev` in this folder, then open `http://localhost:5200/?onboarding=off`, or add `&palette=vibrant` for the Vibrant palette. `npm run check` walks every phase with the layout check while the dev server runs.

## The main card in Q4, Menu and Delete in Q1 (owner, 2026-11-08)

The primary card always sits in Q4 (top right) and the second card in Q1 (top left), so each action keeps one place. The primary card is dark and holds Listen, Stop, Speak, the predicted word, a suggested reply, Say again or Options. The second card holds Menu, Wait!, Delete or Not now. Listen turns into Stop, and Speak into Stop, where they were. Menu opens where the menu's Back button will be. This replaces DEC-100's "Q1 always holds the predicted word"; the word now sits in Q4. Each card keeps its own tone wherever it sits: dark for the primary card, grey glass for the second, and white for Menu (owner, 2026-11-08). The Menu card steps back so it leaves the centre of attention and the screen feels less crowded. It uses the page's own white, has no shadow, and its icon and label are secondary ink (`--ink-2`, 9.4:1 on white, against 17:1 for full ink). A 10% edge keeps it findable as a card on the white page. While it is looked at it darkens to full ink.

## Options (owner, 2026-11-08)

When the typed groups spell two whole words about equally well (`conflictFor`, unchanged), the screen no longer branches with lines to two cards. The Q4 card reads **Options**, with nothing below the word. Above it, in slightly smaller type (36 px against 44 px), are the three most likely words, the likeliest nearest the label and each one dimmer going up (62%, 42%, 27%). A faint ⋯ sits on top only when more than three words fit (owner, 2026-11-08). The words sit 10 px apart, with a little more space above "Options". On windows under 820 px tall the preview words shrink to 26 px and tighten first, so "Options" keeps its 44 px. As typing changes the list, the three words behave like a live leaderboard (`OptionsFace.tsx`, owner 2026-11-08). A word that stays slides to its new rank (FLIP, 320 ms, `--ease-move`). A word that drops out slides off upward and fades (160 ms). A word that arrives slides in from above, beyond third place where the list goes on, once the leavers have cleared its row (from 120 ms). Each word's dimness eases to its new rank. Two words never share a row, and the card itself no longer cross-fades as a whole. Selecting the card opens the Options screen. That screen has Back (to Home) in Q1, the page title in the middle, and every whole word the groups spell, most likely first (`optionsFor`):

- Up to five words: the first four in Q5, Q6, Q7, Q8, and the fifth in Q4.
- More than five: two at a time in Q5 and Q6, with ← in Q7 and → in Q8. An arrow card is just its arrow, and it fades when the list cannot go further that way.

Choosing a word accepts it and returns to the conversation. A word beyond the composer's own top five is still recorded as a decode of the same groups, so Delete can reopen it.

**Paging** (`Pager.tsx`, shared with the menu). An arrow slides the row one card: one card slides out, its neighbour moves over, the next slides in (320 ms, `--ease-move`). The row is a strip clipped to the two cards' own box, so a moving card never crosses into the arrows' quadrants. The strip takes no selection while it moves (it is `inert` for the slide), and only the two cards in view are selectable. Under reduced motion it moves at once. Menu pages use the same paging if one ever holds more than five entries; none does today.

## No state pill (owner, 2026-11-08)

The Listening, Replying and Speaking pill is gone from the screen. A hidden live region in the same place still announces the state to assistive technology, and the row keeps its 48 px height as the docked companion's place, so the history never runs under it. The pill's width animation went with it.

## Letter cards (owner, 2026-11-08)

The letter-group cards use the same grey glass as every other card. Their letters stay 36 px in one row, now at the card's centre like every card's words (see below). Centred two-row letters at the Menu label's size were tried and undone at the owner's request. Only their letters carry colour, from the owner's palette (2026-11-08), Q5 to Q8: purple `#8338EC`, orange `#FB5607`, pink `#FF006E` and blue `#3A86FF`. The palette's yellow (`#FFBE0B`) was 1.5:1 on the grey. It would have to darken to about `#B07800`, a mustard-brown, to reach 3:1, so the same palette's purple takes its place, the owner's pick from three rendered options (golden yellow, purple in yellow's place, a warm-to-cool reorder). The typed word's letters use the same inks. On the grey glass: purple 5.2:1, orange 3.0:1, pink 3.5:1, blue 3.2:1, all at or above the 3:1 bar for large text (the letters are 36 px semibold). The Vibrant palette keeps its deeper inks, since it sets white letters on solid group colours.

## The grid (owner, 2026-11-08)

One space, 32 px, everywhere. It is the gap from the screen's edges to the cards, and between cards across and down. Each card fills its quadrant less those spaces: four columns share five spaces and two rows share three. Cards are 25vw − 40 px wide and 50vh − 48 px tall, which is 320 × 402 px at 1440×900, 280 × 312 px at 1280×720 and 440 × 492 px at 1920×1080. Measured at all three sizes, every gap is exactly 32 px. In CSS (`.cell`), a card in column c sits 32 × (1 − c/4) px into its quadrant and a card in row r sits 32 × (1 − r/2) px down. That keeps every card inside its own backend quadrant, and `check-layout.mjs` reports zero violations in every phase at 1440×900 and 1280×720. The setup reports use the same full-size cards. The thread keeps its own 40 px gaze inset from the row boundary.

Earlier grids, in order: six equal cards on a 16 px grid (PR #18); a shorter letter row; then style 6 and 7's 296 × 338 px cards with 64 px gutters, 32 px from the side edges and 40 px from the top and bottom (owner, 2026-11-07).
## Words at the card's centre (2026-11-08)

The eye tracker is most accurate toward a card's centre, so every card's words, label or letters now sit at its centre instead of bottom left. Each card is three rows whose outer two are always equal, so the middle row, the words, is centred exactly (`.card` in `styles.css`). One-line words across a row of cards share one line. The icon is centred just above the words, so icon and words read as one. A face is three rows too: the small line above the words (the crumb over Back, a setting's name) and a hint below them ("Accept", "Last group", "Starts in 20 s") mirror each other's height, so the words themselves, not the words and their hint, are centred. On a face with a hint and nothing above it, the icon steps down into the empty top row so it still rests on the words.

- **The Options card** keeps its icon in the top-left corner, out of the flow. Its face is already a tall stack (three words over "Options"), and the stack centres in the whole card. The leaderboard measures each word from the card rather than the stack, so a word that stays never jumps when the stack recentres.
- **Letters** are centred in their one row. At large text they wrap into two centred rows, as before.
- **Tall cards** (Try again, Record my voice) centre their label in the whole card, which owns both quadrants.
- **Content too tall for the middle** (two-line labels at 200% text on small windows) pushes the bottom row out first, so the words slide down a little rather than under the icon. `fit.ts` shrinks the text only when the words would pass the card's bottom padding.
- The selection fill's copy of the words is laid out with the same rows, so it inverts exactly over them, and the circle now grows from the words.

Kept as they were: the cards, their quadrants, sizes, colours, typefaces and icons. Only positions and alignment changed.

## Speaking (owner, 2026-11-07)

The Cloud turns green and livelier while Clarté speaks, as in style 6. Style 7 hid it whenever text filled the middle, and the spoken sentence counted, so the green was never seen. In style 8 the Cloud stays while Clarté speaks, with the sentence over it. Its face steps aside (it erases at Speak and redraws when the speech ends), so it never sits under the words.

## Second round (owner, 2026-11-07)

- **The Cloud is style 7's size again.** A 0.8× Cloud was tried and undone at the owner's request.

## Dwell feedback (owner, 2026-11-08)

Looking at a card draws a line round its edge: it starts at the top left, runs clockwise at an even pace, and closes the loop exactly when the dwell completes, so the line's length is the time left. It starts after the existing intent delay (150 ms for letters, 250 ms for buttons), so a glance that passes over a card shows nothing. Leaving early retracts it in 150 ms, once the engine's blink grace (about 300 ms) has passed. The colour follows the card: ink on grey and white cards, the group's ink on letter cards, white on dark cards.

A selection fills the card (owner, 2026-11-08): a solid circle in the card's own vivid colour (the group colour on letter cards, ink on grey and white cards, white on dark cards) grows from the centre until it covers the card (260 ms, `--ease-state`) and holds a beat (120 ms). Then the filled card, its line and its words fade out together as one piece to the card as it was (280 ms). Nothing runs backwards (owner, 2026-11-08). A selection that turns the card into a different button, as on any screen change (Settings giving way to Sound, Menu becoming Back), drops the fill at once: the new button appears clean, with no exit animation carried over (owner, 2026-11-08). Before, the old button's fill played out on the new one. The fill also keeps the colours it started with, and it hands over without an exit if the card under it already has the fill's colour. The card's words and icon change colour exactly as far as the circle has reached: white on colour and ink, ink on white. This is done with a copy of the card's content in that colour, laid out exactly like the card and clipped to the same circle. The copy refreshes two frames in, so a selection that changes the card's words (Listen to Stop) inverts the new words. The card is back at rest about two thirds of a second after the selection, even while gaze stays on it, and its words are readable throughout, so nothing waits for it. Tried and rejected first: a soft blurred oval tint, then a sharp wavy water line with a ripple. Under reduced motion the line steps round in quarters and a selection shows the fill fading out, without the circle growing.

## Menu (owner, 2026-11-08)

The menu is a small tree, kept in one table in `Menu.tsx` (title, parent, entries per page):

| Page | Cards |
| -- | -- |
| Menu | Recalibrate (Q5–Q6), Settings (Q7–Q8): two wide cards |
| Settings | Dwell (Q4), Appearance (Q5), Suggested replies (Q6), Sound (Q7), Dev Tools (Q8) |
| Dwell | Selection, Letter dwell, Button dwell |
| Appearance | Text size, Motion, Word colours |
| Sound | Sounds, Volume |
| Dev Tools (was Demo) | Gaze noise, Repeat, Partner voice |

A page lays out up to four entries along the bottom (Q5–Q8), and a fifth takes the top right (Q4). There is no More card. A page with more than five entries would page two at a time with ← in Q7 and → in Q8 (see Options), but the grouping keeps every page at five or fewer. Back (Q1) steps up one level. The small faded word above "Back" names where it goes: Home (the conversation), Menu or Settings. The path (Menu › Settings › Dwell) sits above the page title in the middle, from Settings down. A wide card is two card widths and the space between, and it owns both of its quadrants. The card it covers is hidden at once, since its fade would show through the glass.

Earlier (owner, 2026-11-07): One moment and Phrases left the menu, and the Phrases page went with them. One moment stays on the conversation screen while listening, renamed **Wait!**. Selecting it says "Wait! I'm answering."

## No dark theme (owner, 2026-11-07)

There is no dark theme. The owner tried several dark looks and then asked for the whole theme to go: solid vibrant cards, tinted glass, a light peach Cloud, and an iridescent "dream" palette with white text. Removed with it:

- the Theme setting
- every dark-theme style
- the Cloud's dark palettes and shading, and the `?cloud=` alternatives

The Cloud renders exactly as style 7's in the light theme.

## Sound (NAT-24)

This app plays the shared sound system ([UI v0's SOUND.md](../../v0/SOUND.md)) instead of style 7's bright clicks, which were 1.3 kHz triangle blips with a 6 ms attack. The cues are soft chords in F that fade in and out, and every cue ducks while Clarté speaks. Choosing a letter group is silent, and a short "not yet" plays a second after "No word" appears. Sounds and Volume share the **Sound** settings page: Sounds cycles All, Fewer and Off, and Volume cycles 25–100%. Settings saved as Sounds On or Off carry over as All or Off. Every cue is at `sounds.html`.

## The companion (owner, 2026-11-08)

The owner rejected the Cloud ("I don't like the cloud in general") and a redrawn cumulus, and asked for their reference component exactly, colours included. It is in `src/components/ui/shader-svg.tsx`: a ghost silhouette clipped over a `@paper-design/shaders-react` mesh gradient (pastel pink, sky blue, medium blue, and two grey-whites, #DADDE3 and #ECEEF1, in place of the reference's dark blue-grey and very dark blue at the owner's request, 2026-11-08), with two eyes that follow the pointer and blink every 3 s, floating up and down 8 px every 2.8 s. The reference also stretched it 8% taller on each float; that is removed so the ball is always a circle (owner, 2026-11-08). `?demo` shows it alone.

The owner then asked for it to be a ball (2026-11-08). The clip is a circle, with the eyes a little above its centre. Lighting comes from the upper left: a soft highlight there (22% white at most), and a shadow on the ball's own edge all round, deepest at the lower right (16% at most). Both are meant to go unnoticed and only make it read as a sphere. A floor shadow under it was tried and removed at the owner's request.

Three changes from the given file. Two were needed to run here. styled-jsx is Next.js only, so its rules sit in a plain `<style>`. It measured `document.querySelector("svg")`, which in Clarté is the Listen card's icon, so it measures its own svg through a ref. The third (owner, 2026-11-08) makes the eyes white. With `currentColor` they took Clarté's dark ink and sank into the gradient's navy; a white ring around ink eyes was tried and declined. On the original palette white eyes measured median 3.4:1 against the companion over 20 s; on the grey-white palette they measure median 1.8:1, worst 1.3:1, so they read by shape rather than contrast.

To take the component as given, the app now has shadcn's structure: the `@/` alias to `src`, `src/components/ui/`, and Tailwind 4 (theme and utilities only, no preflight, so style 8's own styles are unchanged).

Removed with the Cloud: its 20 reaction faces, the mood colours, the word pulse, `sentiment.ts`, `expressions.ts`, `SketchFace.tsx`, `Orb.tsx` and the `?gallery` page. The Orb motion setting is now **Motion**: Still, or the system's reduced-motion preference, stops the bob and the blink. The gradient keeps flowing, because the component has no way to stop it.

### Docking (owner, 2026-11-08)

The ball floats at the centre of the top row, halfway between the top of the screen and 50% (owner, 2026-11-08), only while the middle holds no text at all. Its float rises 8 px, so it rests 4 px low and floats ±4 px about that centre. Any text there sends it to the top-left of Q2, where it docks as a 44 px mark in the thread's 48 px top row. That includes the conversation history (owner, 2026-11-08: "even for this"), as well as words heard, the message typed, the sentence spoken and a menu title. In practice it sits at the centre at the start of a conversation and flies back only when the middle is empty again.

- **Path.** One curve that rises first and then drifts left along the top. It clears the new words instead of crossing them, and stays 40 px inside Q2, away from Q1. Going home it retraces the same curve.
- **Timing.** Leaving makes room for words being read, so it launches at once and glides in over 620 ms (`--ease-state`). Coming home, nothing is waiting on it, so it eases out and in over 680 ms (`--ease-move`). It shrinks early on the way out and grows late on the way back.
- **Body.** It leans up to 9° into the turn. It stays a perfect circle throughout: no stretch in flight and no squash on landing (owner, 2026-11-08).
- **Face.** The eyes go first, 90 ms before the body, looking where it is heading and narrowing as if into the wind. On landing, momentum carries them further up-left (260 ms), they glance up-right (520 ms), and then they return to following the pointer. The landing glances reach about 2.5 times the pointer's range so they still read at 44 px.
- **Interruption.** Position, size and lean all come from one progress value from 0 (centre) to 1 (docked). If the middle fills and clears mid-flight, the ball turns round from where it is.
- **Still or reduced motion.** No flight. It fades out (150 ms), moves, and fades in at the other place, with the face at rest.

## Every launch starts at Welcome (owner, 2026-11-08)

Each launch opens on Welcome, then eye calibration, not only the first. The saved calibration stays as the fallback: Get started starts the camera, the saved calibration is restored, and the run trains over it, so Escape during the run and **Keep the old one** after a failed run keep it. The voice pages follow calibration only until the person finishes them once, by Continue after making a voice or by Not now (`voiceDone` in `clarte.v1`; a store from before with `setupDone` counts). Menu › My voice reaches them at any time. `?onboarding=off` still skips the whole flow, and `?input=mouse` skips calibration.

Welcome is laid out like a voice page with two actions: two wide cards in the bottom row, **Keyboard and mouse** (grey glass, keyboard icon) over Q5–Q6 and **Get started** (ink, still with "Starts in 20 s") over Q7–Q8. The words and the orb are centred in the whole top row, a rest zone. As calibration starts, Get started slides off to the right as the tall card did (520 ms, `card-slide`) and Keyboard and mouse fades. Get started keeps one body key with or without its hint: the press that stops the countdown would otherwise swap the body under the pointer, and the click would never fire.

**Keyboard and mouse** skips calibration and starts no camera, the same as Use the mouse after a camera failure. With keyboard and mouse nothing selects by dwell (owner's standing rule): a click or keys 1–8 select, and hovering never does. So the pointer no longer feeds the gaze engine in a keyboard-and-mouse session, and it never does on Welcome or calibration, where the eyes cannot select yet and only a mouse could dwell. Elsewhere, without a calibrated tracker (`?onboarding=off`), the pointer still stands in for the eyes. Dwell stays the default for the eyes.

## Open questions for the owner

1. The eyes follow the mouse pointer, as in the reference. With a real eye tracker there is no pointer; should they follow the looked-at card instead?

## Evidence

In `evidence/`, real renders at 1440×900: `empty` (an empty conversation, the ball at the centre), `idle` (Soft, history on screen, the ball docked), `vibrant-suggested` (Vibrant), `speaking` (the companion docked while Clarté speaks), `companion-demo` (`?demo`), `companion-flight.webm` (docking and returning, recorded in Chromium; recordings stay local, as in v0), `listening-wait` (Wait! while listening), `menu`, `menu-settings` and `menu-dwell` (the menu tree), `composing` (the word in progress in group colours).
