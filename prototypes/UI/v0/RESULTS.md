# UI v0 results (2026-11-07)

Five layouts, one shared light skin, one engine. Each style was built by its own thread, reviewed by a two-member council (Claude Opus 5.5 at high effort and GPT-6.1 Sol at max effort) over several rounds, and compared side by side with the owner's light-direction mock (`reference/11-light-direction-mock-1440x900.png`). Every folder has a `REPORT.md` with the full round-by-round record, a `DESIGN.md` with the decisions, and an `evidence/` folder with the screenshots, recordings and the side-by-side.

## Where each style landed

Scores are the council's last round, design and interaction / craft and motion, out of 10. "Matches" is the council's verdict on the mock comparison (whitespace, type scale, radius, colour restraint, finish).

| Style | Layout | Rest zones | Opus (last) | Sol (last) | Against the mock | Side by side |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Rails | controls top, message middle, groups bottom | none while a word is pending (confirm step by default) | 8 / 6 (a dot-overlay bug, fixed after the round; Opus said 8 once fixed) | 8 / 8 | matches on all five axes, beats on none | `s1/evidence/compose-vs-mock-1440x900.png` |
| 2 Corners | groups in the four corners, conversation top centre, accept and delete bottom centre | Q2, Q3 | 8 / 7 ("close") | 8 / 8 | matches; Opus: beats on colour restraint | `s2/evidence/side-by-side-mock.png` |
| 3 Stages | one screen per phase, fewest and largest targets | per phase | 8.5 / 8.5 | 8.5 / 8.5 | matches, does not clearly beat | `s3/evidence/compare-compose-vs-mock.png` |
| 4 Split | 2×2 keypad left, controls top right, conversation bottom right | Q7, Q8 | 8.5 / 8 | 7.5 / 8 | matches | `s4/evidence/side-by-side-mock.png` |
| 5 Dialogue | conversation thread top centre, whole-reply suggestion, groups bottom | Q2, Q3 | 8.5 / 8.5 | 8 / 8.5 | matches, does not beat | `s5/evidence/compose-vs-mock.png` |

No style reached the owner's "craft 9 from both members" stop rule; every council stopped at the round limit with both members still naming findings, most of which the builders then fixed without a re-score. Styles 3 and 5 scored highest and most evenly.

Independent check by the coordinating thread: `shared/check-layout.mjs` run against each style's dev server reports zero Backend Quadrant violations in every phase at 1440×900 and 1280×720 (styles 1 to 5, 2026-11-07 afternoon), and `shared/selftest.ts` passes.

## Decisions the owner still owns

1. **Centred versus editorial.** Every build centres the motif and label in the card (the brief asks for the label at the hit region's centre, following the gaze focal-point rule). The mock sets the motif top left and the label bottom left, which reads more editorial. Pick one; it changes the look more than any layout difference.
2. **Settings reach.** With eight quadrants, six actions and two rest zones, Menu and Settings are three to four selections away while a word is pending in every six-action style, and style 1's second page costs a flip. Either accept this for a prototype or allow a quadrant to change meaning mid-word.
3. **Delete mid-word versus More.** Sol wanted the second control slot to offer More while typing; the builders kept Delete because it is the most frequent repair. Styles 2, 4 and 5 record this as open.
4. **Luminance tolerance.** The brief asks for constant screen luminance; the builds measure 8 to 12% swings between states on the light theme and about 50% on style 3's dark theme. State a tolerance or drop the dark theme from v0.
5. **Group ink contrast.** The brief's own group inks for G2 to G4 land at APCA Lc 72–73 against the brief's Lc 75 floor. Darken the inks slightly or relax the floor.
6. **Calibration length.** The brief says about 30 to 40 s; the builds take 37 to 52 s at the measured Neuralink pacing. Shorten the settle per point or accept the time.
7. **Which layout goes forward.** The comparison is now apples to apples: same skin, same engine, same decoder. Styles 3 and 5 are the council's favourites; style 1 is the original sketch and the only one that needs a confirm step.

## Known limits across all five

- The decoder is the stand-in vocabulary in `shared/decoder.ts`; the real engine is wired only into `s0/index.html`.
- No webcam tracking: the mouse is the gaze, with optional noise. Blink or switch confirm is simulated with Space.
- Microphone listening uses the browser's speech recognition in Chrome and a scripted partner elsewhere; the recordings carry no audio, so click sounds are unverified.
- Linear was not reachable from any of these sessions; the findings and decisions above are not yet filed there.
- Evidence folders range from 2.8 MB to 16 MB (style 3's ten-loop recording); none is committed.

## Run them

Each style: `cd prototypes/UI/v0/sN && npm install && npm run dev` (ports 5101 to 5105). `node prototypes/UI/v0/shared/check-layout.mjs http://localhost:510N <out-dir>` walks every phase. The live mock with the real engine: see "Live" in `s0/DESIGN.md`.
