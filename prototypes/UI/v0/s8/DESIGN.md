# Style 8 · Even grid

A copy of style 7 · Cloud (v2, PR #17), made to try one change without touching v2. Everything not mentioned here is style 7's: the Cloud, its 20 faces, the Soft and Vibrant palettes, the thread and the branch. See [../s7/DESIGN.md](../s7/DESIGN.md), and [../s6/DESIGN.md](../s6/DESIGN.md) for what style 7 inherits.

In `s_all` style 8 appears as **S8** (Soft palette) and **S8V** (Vibrant palette). On its own it runs at `http://localhost:5108/?onboarding=off&palette=soft` or `&palette=vibrant`.

## The change (owner, 2026-11-07)

"I don't like how the grids are spaced out. Make them all equal size; it looks weird now with spaces in between."

Style 7's cards float inside their quadrants: 64 px gutters between neighbours, 40 px from the screen edge, and a tall empty band between the rows. In style 8 every conversation card is the same size and fills its quadrant. One even gap, `--grid-gap`, set to 16 px, runs between every card and round the screen's edge.

| | Style 7 | Style 8 |
| --- | --- | --- |
| Card at 1440×900 | 296 × 338 px | Listen and Menu 340 × 533 px, letters 340 × 320 px (second round) |
| Gap between cards | 64 px across, 144 px between the rows | 16 px everywhere |
| Gap to the screen edge | 40 px | 16 px |

**Backend quadrants.** The page is padded by the gap, and the grid has the same gap between its columns and rows. With equal columns, each gap straddles a backend quadrant boundary (8 px either side at 16 px), so every card stays inside its own backend quadrant. At 1440×900, for example, Q1's card ends at x = 356 and Q2 starts at x = 360. Q2–Q3 is still the rest zone. The thread's text stays 40 px inside the row boundary, as before. In the first round `check-layout.mjs` reported zero violations in every phase at 1440×900 and 1280×720, for both palettes. The second round, below, changes that.

Setup keeps style 7's shorter report cards.

## Second round (owner, 2026-11-07)

1. **The letter row is 0.75 of its height** (426 → 320 px at 1440×900), resting on the bottom edge, so the middle has more room.
2. **Listen (Q1) and Menu (Q4) grow down to meet it** (426 → 533 px), so the gap between the rows is the same 16 px as everywhere else.
3. **The Cloud is 0.8 of its size** (`ORB_RADIUS` in `Orb.tsx`), and its face scales with it.

**This breaks the backend quadrant rule, knowingly.** The backend grid always splits the screen at the halfway line (y = 450 at 1440×900). Listen and Menu now reach y = 549, so their lowest ~100 px lies in Q5 and Q8, which already hold A–F and T–Z. `check-layout.mjs` reports it in every conversation phase: Q5 holds `primary` and `G1`, and Q8 holds `delete` and `G4`. With a real tracker, a look at the lower part of Listen or Menu selects A–F or T–Z. The owner chose this after seeing the trade-off. It is a visual experiment, valid for real use only if the tracker's row split moves down to match (about 61% of the height). The alternative that keeps the rule (letter row at 0.75, top cards unchanged, the freed space between the rows) is to delete one line from `styles.css`: `:is(.cell-q1, .cell-q4) > .card { height: 125% }`.

## Menu (owner, 2026-11-07)

One moment and Phrases are gone from the menu, and the Phrases page went with them. The other items keep their places: Back (Q1), Settings (Q6), Recalibrate (Q7) and Demo (Q8). Q4 and Q5 are rest zones on that page. One moment stays on the conversation screen, in Q4 while listening.

## Dark theme (owner, 2026-11-07)

The first round was rejected: solid vibrant cards were "too vibrant" and the light beige cloud looked wrong. The second round:

- **Letter cards are tinted glass:** a translucent wash of the group colour (34% fading to 16%), an edge in the same hue, a thin highlight along the top, and pastel letters. Looking at a card brightens the glass, and a soft light rises over the dwell.
- **Three Clouds to compare** (`?cloud=`): **Glow** (warm peach, the default), **Moon** (silver-lavender) and **Aurora** (soft teal). Each is light, screen-blended onto the page and drawn without a halo, because a halo on a dark page reads as a grey ring. Each face is a deep ink of its cloud's own hue.
- **Glow matches the light theme's Cloud** (owner, 2026-11-07: "make it look like this … it looks worse with those lighter borders"). The light palette is eased a fifth of the way to white and drawn at full strength, so it reads as the same peach. Three things that made the dark Cloud look wrong are gone. The rim no longer lifts to white (on white that is invisible, but on black it was a pale border). The wide halo is off (any faint peach over black reads as a smoky brown ring). The edge is tighter than on white (it fades over the last 5% of the radius, not 10%; owner: less glow on the edges) and tinted slightly towards the Cloud's deepest peach. The face is the light theme's brown. `evidence/dark-cloud-glow.png` shows the result.
- **History over the Cloud** carries a soft dark halo in the page's own colour.
- **Fixed:** the Vibrant palette's darker secondary grey no longer applies in the dark theme. It had made partner turns almost invisible there, and style 7 (v2) still has this bug.

## Sound (NAT-24)

Style 8 plays the shared sound system ([../SOUND.md](../SOUND.md)) instead of style 7's bright clicks, which were 1.3 kHz triangle blips with a 6 ms attack. The cues are soft chords in F that fade in and out, and every cue ducks while Clarte speaks. Choosing a letter group is silent, and a short "not yet" plays a second after "No word" appears. Sounds and Volume now share a third settings page, **Sound**: Sounds cycles All, Fewer and Off, and Volume cycles 25–100%. Sounds' old place on the second settings page (Q5) is a rest zone. Settings saved as Sounds On or Off carry over as All or Off. Every cue is at `sounds.html`.

## Open questions for the owner

1. Should the tracker's row split move down to about 61% so the taller Listen and Menu are valid, or should the top cards stop at the halfway line?
2. Is 16 px the right gap, or should it be tighter (8 px) or looser (24 px)? It is one token, `--grid-gap`.
3. With larger cards, should the corner radius shrink from 40 px to suit the tighter gaps?

## Evidence

In `evidence/`, real renders at 1440×900: `even-grid-idle` (Soft), `even-grid-vibrant` (Vibrant, suggested reply) and `even-grid-dark` (dark theme).
