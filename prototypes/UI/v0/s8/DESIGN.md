# Style 8 · Cloud, second pass

A copy of style 7 · Cloud (v2, PR #17), made to try one change without touching v2. Everything not mentioned here is style 7's: the Cloud, its 20 faces, the Soft and Vibrant palettes, the thread and the branch. See [../s7/DESIGN.md](../s7/DESIGN.md), and [../s6/DESIGN.md](../s6/DESIGN.md) for what style 7 inherits.

In `s_all` style 8 appears as **S8** (Soft palette) and **S8V** (Vibrant palette). On its own it runs at `http://localhost:5108/?onboarding=off&palette=soft` or `&palette=vibrant`.

## The grid (owner, 2026-11-08)

One space, 32 px, everywhere. It is the gap from the screen's edges to the cards, and between cards across and down. Each card fills its quadrant less those spaces: four columns share five spaces and two rows share three. Cards are 25vw − 40 px wide and 50vh − 48 px tall, which is 320 × 402 px at 1440×900, 280 × 312 px at 1280×720 and 440 × 492 px at 1920×1080. Measured at all three sizes, every gap is exactly 32 px. In CSS (`.cell`), a card in column c sits 32 × (1 − c/4) px into its quadrant and a card in row r sits 32 × (1 − r/2) px down. That keeps every card inside its own backend quadrant, and `check-layout.mjs` reports zero violations in every phase at 1440×900 and 1280×720. The setup reports use the same full-size cards. The thread keeps its own 40 px gaze inset from the row boundary.

Earlier grids, in order: six equal cards on a 16 px grid (PR #18); a shorter letter row; then style 6 and 7's 296 × 338 px cards with 64 px gutters, 32 px from the side edges and 40 px from the top and bottom (owner, 2026-11-07).
## Speaking (owner, 2026-11-07)

The Cloud turns green and livelier while Clarte speaks, as in style 6. Style 7 hid it whenever text filled the middle, and the spoken sentence counted, so the green was never seen. In style 8 the Cloud stays while Clarte speaks, with the sentence over it. Its face steps aside (it erases at Speak and redraws when the speech ends), so it never sits under the words.

## Second round (owner, 2026-11-07)

- **The Cloud is style 7's size again.** A 0.8× Cloud was tried and undone at the owner's request.

## Menu (owner, 2026-11-07)

One moment and Phrases are gone from the menu, and the Phrases page went with them. The other items keep their places: Back (Q1), Settings (Q6), Recalibrate (Q7) and Demo (Q8). Q4 and Q5 are rest zones on that page. It stays on the conversation screen, in Q4 while listening, renamed **Wait!** (owner, 2026-11-07). Selecting it says "Wait! I'm answering."

## No dark theme (owner, 2026-11-07)

Style 8 has no dark theme. The owner tried several dark looks and then asked for the whole theme to go: solid vibrant cards, tinted glass, a light peach Cloud, and an iridescent "dream" palette with white text. Removed with it:

- the Theme setting (its place on Settings page 1 is now a rest zone)
- every dark-theme style
- the Cloud's dark palettes and shading, and the `?cloud=` alternatives

The Cloud renders exactly as style 7's in the light theme.

## Sound (NAT-24)

Style 8 plays the shared sound system ([../SOUND.md](../SOUND.md)) instead of style 7's bright clicks, which were 1.3 kHz triangle blips with a 6 ms attack. The cues are soft chords in F that fade in and out, and every cue ducks while Clarte speaks. Choosing a letter group is silent, and a short "not yet" plays a second after "No word" appears. Sounds and Volume now share a third settings page, **Sound**: Sounds cycles All, Fewer and Off, and Volume cycles 25–100%. Sounds' old place on the second settings page (Q5) is a rest zone. Settings saved as Sounds On or Off carry over as All or Off. Every cue is at `sounds.html`.

## The companion (owner, 2026-11-08)

The owner rejected the Cloud ("I don't like the cloud in general") and a redrawn cumulus, and asked for their reference component exactly, colours included. It is in `src/components/ui/shader-svg.tsx`: a ghost silhouette clipped over a `@paper-design/shaders-react` mesh gradient (pastel pink, sky blue, medium blue, and two grey-whites, #DADDE3 and #ECEEF1, in place of the reference's dark blue-grey and very dark blue at the owner's request, 2026-11-08), with two eyes that follow the pointer and blink every 3 s, floating up and down 8 px every 2.8 s. The reference also stretched it 8% taller on each float; that is removed so the ball is always a circle (owner, 2026-11-08). `?demo` shows it alone.

The owner then asked for it to be a ball (2026-11-08). The clip is a circle, with the eyes a little above its centre. Lighting comes from the upper left: a soft highlight there (22% white at most), and a shadow on the ball's own edge all round, deepest at the lower right (16% at most). Both are meant to go unnoticed and only make it read as a sphere. A floor shadow under it was tried and removed at the owner's request.

Three changes from the given file. Two were needed to run here. styled-jsx is Next.js only, so its rules sit in a plain `<style>`. It measured `document.querySelector("svg")`, which in Clarte is the Listen card's icon, so it measures its own svg through a ref. The third (owner, 2026-11-08) makes the eyes white. With `currentColor` they took Clarte's dark ink and sank into the gradient's navy; a white ring around ink eyes was tried and declined. On the original palette white eyes measured median 3.4:1 against the companion over 20 s; on the grey-white palette they measure median 1.8:1, worst 1.3:1, so they read by shape rather than contrast.

To take the component as given, style 8 now has shadcn's structure: the `@/` alias to `src`, `src/components/ui/`, and Tailwind 4 (theme and utilities only, no preflight, so style 8's own styles are unchanged).

Removed with the Cloud: its 20 reaction faces, the mood colours, the word pulse, `sentiment.ts`, `expressions.ts`, `SketchFace.tsx`, `Orb.tsx` and the `?gallery` page. The Orb motion setting is now **Motion**: Still, or the system's reduced-motion preference, stops the bob and the blink. The gradient keeps flowing, because the component has no way to stop it.

### Docking (owner, 2026-11-08)

The ball floats at the centre of the top row, halfway between the top of the screen and 50% (owner, 2026-11-08), only while the middle holds no text at all. Its float rises 8 px, so it rests 4 px low and floats ±4 px about that centre. Any text there sends it to the top-left of Q2, where it docks as a 44 px mark beside the state pill, which steps 48 px right to make room. That includes the conversation history (owner, 2026-11-08: "even for this"), as well as words heard, the message typed, the sentence spoken and a menu title. In practice it sits at the centre at the start of a conversation and flies back only when the middle is empty again.

- **Path.** One curve that rises first and then drifts left along the top. It clears the new words instead of crossing them, and stays 40 px inside Q2, away from Q1. Going home it retraces the same curve.
- **Timing.** Leaving makes room for words being read, so it launches at once and glides in over 620 ms (`--ease-state`). Coming home, nothing is waiting on it, so it eases out and in over 680 ms (`--ease-move`). It shrinks early on the way out and grows late on the way back.
- **Body.** It leans up to 9° into the turn. It stays a perfect circle throughout: no stretch in flight and no squash on landing (owner, 2026-11-08).
- **Face.** The eyes go first, 90 ms before the body, looking where it is heading and narrowing as if into the wind. On landing, momentum carries them further up-left (260 ms), they glance up-right (520 ms), and then they return to following the pointer. The landing glances reach about 2.5 times the pointer's range so they still read at 44 px.
- **Interruption.** Position, size and lean all come from one progress value from 0 (centre) to 1 (docked). If the middle fills and clears mid-flight, the ball turns round from where it is.
- **Still or reduced motion.** No flight. It fades out (150 ms), moves, and fades in at the other place, with the face at rest.

## Open questions for the owner

1. The eyes follow the mouse pointer, as in the reference. With a real eye tracker there is no pointer; should they follow the looked-at card instead?

## Evidence

In `evidence/`, real renders at 1440×900: `empty` (an empty conversation, the ball at the centre), `idle` (Soft, history on screen, the ball docked), `vibrant-suggested` (Vibrant), `speaking` (the companion docked while Clarte speaks), `companion-demo` (`?demo`), `companion-flight.webm` (docking and returning, recorded in Chromium), `listening-wait` (Wait! while listening).
