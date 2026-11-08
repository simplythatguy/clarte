# Style 8 · Cloud, second pass

A copy of style 7 · Cloud (v2, PR #17), made to try one change without touching v2. Everything not mentioned here is style 7's: the Cloud, its 20 faces, the Soft and Vibrant palettes, the thread and the branch. See [../s7/DESIGN.md](../s7/DESIGN.md), and [../s6/DESIGN.md](../s6/DESIGN.md) for what style 7 inherits.

In `s_all` style 8 appears as **S8** (Soft palette) and **S8V** (Vibrant palette). On its own it runs at `http://localhost:5108/?onboarding=off&palette=soft` or `&palette=vibrant`.

## The grid (owner, 2026-11-07)

Style 8 first tried six equal cards on an even 16 px grid (340 × 426 px each, merged in PR #18), then a shorter letter row with Listen and Menu stretched down to meet it. Both are undone at the owner's request ("those are not the normal sizes, I mean the sizes in s6–s7"). The cards are style 6 and 7's again: 296 × 338 px at 1440×900, 64 px gutters and 40 px from the screen edge. `check-layout.mjs` reports zero violations in every phase at 1440×900 and 1280×720, for both palettes.

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

## Open questions for the owner

1. Should the face stay visible while Clarte speaks (above or below the sentence) instead of stepping aside?

## Evidence

In `evidence/`, real renders at 1440×900: `idle` (Soft), `vibrant-suggested` (Vibrant), `speaking` (the green Cloud while Clarte speaks), `listening-wait` (Wait! while listening).
