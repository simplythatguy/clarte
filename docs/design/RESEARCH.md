# Research synthesis for Clarte UI v0

What the literature says about building a gaze-controlled communication aid on a laptop webcam, condensed into the decisions the five style prototypes make. Six reading lanes ran in parallel on 2026-11-07; their full notes, with source tables and reading depth per source, are in `research/`:

| Ref | Lane file | Scope | Sources |
| --- | --- | --- | --- |
| R-1 | `research/lane1-gaze-selection.md` | dwell, confirm, feedback, accuracy, drift, fatigue, speed baselines | 52 |
| R-2 | `research/lane2-ambiguous-keyboards.md` | four-group keyboards, letter assignment, prediction, LLM-era AAC | 34 |
| R-3 | `research/lane3-aac-ux.md` | who the users are, AAC conversation, abandonment, accessibility rules, dignity | 50 |
| R-4 | `research/lane4-visual-perception.md` | colour, contrast, type size, light vs dark, clutter, aesthetics | 43 |
| R-5 | `research/lane5-prior-art.md` | shipping gaze and AAC products, open source, platform guidance | 37 |
| R-6 | `research/lane6-motion-feedback-ux.md` | feedback timing, dwell choreography, calibration UX, motion systems, modes | 51 |

Grades: **strong** means replicated or direct experimental evidence in gaze interfaces; **moderate** means one good study or official platform guidance; **weak** means reasoned from general evidence and untested with gaze. Most target-size and dwell numbers come from infrared trackers; the webcam tracker in this repo is less accurate, which is why the quadrant rule exists. Citations are lane and item, for example R-1 §25.

## 1. The eight-quadrant premise holds

- Real-use tracker error is far worse than datasheets. Without a chinrest a Tobii X2-30 reached 2.46° accuracy against a claimed 0.40° (R-3 §31). Across 80 users the 90th percentile offset was 0.93 cm horizontal and 1.19 cm vertical, a six-fold spread between users (R-1 §25). Webcam pipelines sit at 2.3 to 4.6 cm or about 2.4 to 4.2° (R-1 §28, R-4 §13). **strong**
- At 60 cm on a 1440×900 13-inch laptop, 1° is about 52 px, so one backend quadrant (360×450 px) is about 6.9° × 8.6°, roughly 7.2 × 9.0 cm. That is about the smallest target a webcam tracker can be trusted with after a 2.4 to 3.9° error, and larger than the 3.3 × 3.8 cm needed for 75% of users on infrared trackers (R-1 §25, R-3 §3.1, R-4 §12–13). **strong for the sizes, moderate for the webcam margin**
- Vertical accuracy is worse than horizontal, and precision is worst toward the bottom row and the right edge (R-1 §25). Targets should be taller than wide and the widest inactive gap belongs on the row boundary. Looking down is also the least recognisable camera gesture (75% in GazeSpeak, R-5 §2.15). The first prototype puts the most frequent targets, the letter groups, in the bottom row; styles 2 and 4 test alternatives. **strong**
- The reactive region may be invisible and larger than the drawn control; the eyes land on the centre of a surface most reliably and are drawn to corners and strong outlines, so tiles should be rounded, flat, with the label centred (R-1 §25, R-5 §2.23–2.24, R-6 §26). Platform guidance converges: Apple asks for 60 pt centre spacing or 16 pt margins and rounded shapes, Meta for 3° targets and 1° gaps and warns against two-dimensional button grids (R-5 §2.23–2.24). A 2×4 grid is such a grid, so gutters must be generous. **strong**
- Screen edges help quadrant classification: gaze error past an edge still falls in the edge cell, as long as it is not so far out that it counts as looking away (the tracking prototype's classifier allows 15% slack). Corner placement is therefore a reasonable hypothesis, tested in style 2. **weak**

## 2. Selection: dwell first, with the right choreography

- Dwell is the default selector in every shipping gaze product; blink and switch are alternatives (R-5 §3). Blink confirmation is a strain cost: Jacob rejected it in 1990, Tobii's own guidance says never use blinks or eye gestures as the activation signal, eyes-closed recognition on camera was 75 to 80%, and people with advanced ALS could not always perform it (R-1 §1, §32, §34; R-5 §2.5, §2.15). Keep a confirm step as an option, not the default. **strong**
- Dwell duration: 600 ms was rated easiest for letters, dots and icons by 30 users; 200 ms caused Midas-touch corrections; 1000 to 1200 ms made people think the system had failed; glasses wearers were slower (R-1 §9). Experienced eye typists call 450 ms "just right"; self-adjusted dwell falls from 876 to 282 ms over ten sessions while speed rises from 6.9 to 19.9 wpm (R-1 §11, §18). Cascading dwell that shortens likely keys and lengthens unlikely ones gave +17% speed and 35% fewer corrections (R-1 §13). Defaults for Clarte: letter groups 600 ms, controls 900 ms, both adjustable from 300 to 2000 ms, a tenfold range as WCAG 2.2.1 requires; show it as a speed setting rather than milliseconds (R-1 §3, R-3 §24, R-6 §15). **strong**
- Dwell classes by cost of error are standard practice: Windows separates typing dwell from general dwell, Grid 3 halves dwell on letter cells only, TD Snap allows per-button dwell (R-5 §2.2, §2.6, §2.7). **strong**
- Choreography per selection (R-6 §3.1, built on R-1 §16–19, §21): nothing visible for the first 150 ms (letters) or 250 ms (controls) so glances light nothing up; then one static focus cue on the target; then a progress indicator that contracts or fills toward the target's centre, showing time remaining; a short non-speech click at commit; a gaze exit before the same target can fire again. Feedback placed away from the target pulls the eye and cancels the dwell. The animated progress indicator halved premature exits and users kept it even at very short dwells. **strong**
- Resume grace: a dwell should survive gaze leaving for about 100 to 150 ms and ignore blink gaps up to 200 ms, otherwise jitter resets the ring (R-6 §23, §3.1). Looking off screen is the universal cancel (R-1 §20, R-5 §2.6). No auto-repeat; re-selecting the same target needs exit and return, and a 120 ms extra dwell proved insufficient against double entries (R-1 §18, R-5 §3). Double letters inside one group (LL, OO, SS) are common with four groups, so the re-arm must be fast and visible; the shared engine offers a "redwell" mode to test (R-5 §4.3). **strong for the guard, moderate for the remedy**
- Feedback must arrive within 250 ms of the gaze event, ideally 100 ms; if the camera pipeline is slower, lengthen the dwell rather than shorten the animation (R-6 §5, §3.1). Speech per letter is harmful; speech at word commit alongside visual feedback can help (R-1 §16, R-6 §56). Never draw a gaze cursor by default; it produces a "fleeing cursor" the eye chases (R-3 §31, R-6 §25). **strong**
- Two-step selection with a fixed-position confirm target (Actigaze) suits costly actions; a confirm that appears under the gaze does not (R-1 §21). Prefer undo over warnings everywhere else (R-6 §54). **moderate**

## 3. Rest and the Midas touch

- With labels inside dwell buttons, short dwell was inaccurate at every size; with the readable content moved outside the buttons there were zero wrong selections at any dwell (R-1 §6). Readable text belongs in non-actionable space, and the person needs somewhere safe to look while thinking (R-1 §3 implications, R-3 §3.1). **strong**
- The two documented complaints about rest mechanisms are rest zones that trigger by accident: Look to Speak's snooze gesture and TD Snap's look-down pause (R-5 §2.2, §2.16). A rest zone must be passive, never a trigger. **strong**
- Consequence for the first prototype idea: when every backend quadrant holds an action, reading the middle band is classified as the top or bottom row and arms something. Style 1 therefore defaults to the confirm step the tracking prototype already uses; styles 2 to 5 give the message real empty quadrants. The brief records this as the main thing v0 must test.

## 4. Luminance, theme and colour

- Pupil size moves the measured gaze even when the eye is still: a black-to-white background change shifted gaze by 2.6° on average (0.3 to 5.2°), calibration error was 0.83° on black versus 0.39° on white, and the authors advise bright, constant backgrounds and calibrating at the working luminance (R-1 §27, R-4 §18). A 2.6° shift is a third of a quadrant. Whether appearance-based webcam models suffer the same way is untested (R-4 open question 4). **strong on infrared trackers, weak as extrapolated**
- Positive polarity (dark text on a light page) reads better for younger and older adults across five Ergonomics studies; the advantage comes from higher luminance and smaller pupils (R-4 §16). Dark mode helps objectively only at night at low brightness and hurts older adults (R-4 §17). The warm off-white `#F5F2EC` with `#1A1A1A` ink keeps APCA Lc 97 (R-4 §9). **strong**
- Photophobia affects about half of people after brain injury and is common in MS, so a low-luminance theme is a medical accommodation that must exist as an option, at matched APCA contrast (R-3 §6, R-4 §3.1). **moderate**
- Four categorical colours are well inside perceptual limits (up to seven preattentive, about nine identifiable hues), but no four-hue palette survives dichromacy on colour alone: simulated worst pairs collapse to 8 to 17 ΔE00 (R-4 §1–4). Group identity must also be carried by position, the printed range label and a glyph. Pastel fills are useless for colour-vision deficiency; the hue should live in a saturated bar or underline meeting 3:1 against the page (R-4 §5). **strong on the colour-only point**
- Verified palettes (Machado 2009 simulation, CIEDE2000; scripts in `research/tools/`): P2, lightness-stepped and deutan-aware, light `#172F93` `#1A8757` `#BB80C2` `#B38F39`, dark `#545C9F` `#1A8757` `#D592DD` `#F6C651`; P1, an Okabe–Ito subset, `#0072B2` `#C68800` `#009E73` `#CC79A7`. P2 trades some normal-vision separation for a much better deutan floor (R-4 §3.2). **moderate**
- Colour variability is clutter that slows search, and large chromatic contrasts raise discomfort (R-4 §7). For adults, colour cues on AAC displays helped search when positions were stable (R-3 §34). Spend chroma on the four groups, the conversation state, the one primary action and errors; keep everything else neutral. Per-word colour on finished text has no reading evidence; cross-fade tokens into the plain word at decode (R-4 §15, §3.3). **moderate**

## 5. Type and contrast

- Critical print size for fluent reading is about 0.2° x-height; at 60 cm on this laptop that is about a 20 px font, so 16 px is below it (R-4 §10, §12). Workplace standards ask for 20 to 22 arcmin character height (R-4 §11). Users with low vision need a two to three times acuity reserve (R-3 §33). Sizes: message 40 to 48 px, group labels 28 to 32 px, control labels 24 to 28 px, nothing under 20 px, text scaling to 200% (R-3 §3.3, R-4 §3.4). **moderate, derived**
- Contrast: message Lc ≥ 90 (≥ 7:1), labels Lc ≥ 75, secondary Lc ≥ 60, every boundary, state and group bar ≥ 3:1; luminance contrast, never hue alone, for state changes (R-4 §8–9, §3.5). **strong as standards**
- Humanist sans faces cut glance time about 10% versus a square grotesque; sans beat serif and italic for dyslexic readers; Atkinson Hyperlegible is unproven in peer review but reasonable (R-4 §14). **moderate**

## 6. Motion

- No motion on frequent actions; at most a 150 ms opacity or colour change (R-4 §21, R-6 §39–42). Dwell feedback fills in place and nothing else moves while a target is armed, because moving edges invite pursuit and drag the gaze estimate (R-4 §23, R-6 §3.2). **strong**
- Phase changes by opacity and colour in place, staged in at most two steps, 250 to 400 ms with `cubic-bezier(0.2, 0, 0, 1)`, exits 150 to 200 ms; never slide or scale content across quadrants (R-4 §3.6, R-6 §43, §3.2). Under reduced motion keep the progress cue as a colour ramp that changes no size or position (R-6 §3.6). **strong**
- No idle motion: nothing moving unprompted for more than 5 s, no oscillation near 0.2 Hz, no flashes, no luminance swings of 10% over large areas, no dimming overlays (R-4 §22–23, R-6 §46–47). **strong**
- Spatial stability matters more than any transition: fixed positions let people select from memory instead of searching, and relocating controls between phases breaks that (R-6 §50, R-5 §2.27). **strong**

## 7. The four-group keyboard and prediction

- The split A–F / G–N / O–S / T–Z is the best of all 2,300 contiguous alphabetical four-way splits on English unigram frequencies (77.9% word-level top-1 on the 30,000 most frequent words, 79.7% on the top 10,000; 88% within two candidates, 96% within five); an unconstrained optimum gains only about 2 points, and GazeSpeak, FlexType, Gong & Tarasewich and Tanaka-Ishii all chose alphabetical for learnability (R-2 F1–F2; computation in `research/tools/ambiguity4_pure.py`). With a sentence-level language model the top decode is right about 89 to 91% of the time and two candidates cover 97%; FlexType users cycled only 0.17 times per word (R-2 F3). Four groups is the floor at which an ambiguous keyboard still beats a full keyboard; three is not (R-2 F4). Keep the split fixed, print the ranges on the keys, never rearrange letters (R-2 §3.1). **strong**
- The worst collisions are all short function words (by/at, new/may/get, that/they/what, not/now/how, is/no/go); four-letter words are the weakest at 61% unigram top-1, and words of seven letters or more exceed 90% (R-2 F1). Context from the conversation is what resolves them: one previous dialogue turn more than doubles abbreviation-expansion accuracy, and commodity speech recognition of the partner at 7 to 16% word error gives predictions nearly as good as perfect transcripts (R-2 F16, F18). **strong**
- GazeSpeak, the closest prior art, used four alphabetical letter groups selected by gaze direction with word prediction over 5,000 words: 83.5% of group sequences matched a unique word and 97.7% matched four or fewer; sentences took 81 s against 138 s with a letter board (R-1 §32, R-5 §2.15). Alphabetical grouping was chosen for learnability and first-time gaze users prefer familiar layouts (R-5 §2.9, §4.13). **strong for fixed and alphabetical**
- Extra prediction slots do not raise entry rate under dwell selection (2 to 9 slots all gave 9 to 11 wpm), keystroke savings flatten at about six slots, consulting a list costs two to six times a keystroke for gaze users, and consulting predictions before two letters are typed slows people down; about 60 to 70% suggestion accuracy is the useful threshold, and poor lists train users to ignore them (R-2 F7–F10). So: one actionable slot, the running best decode shown inline, completions offered only from two groups on, and the slot quiet when confidence is low (R-2 §3.2–3.3). **strong**
- Word end: with only eight zones, accepting the candidate is the word-end signal and inserts the space; FlexType auto-committed the top decode at word end and let users cycle, GazeSpeak confirmed every word; the break-even depends on the real top-1 rate (R-2 F13, open question 3). Repairs that work in shipping systems are three distinct things: delete the last unit, cycle to another candidate, delete the whole word; backspace per character is avoided (R-2 F13, R-5 §4.10). The shared composer gives Delete all three by state: last group while typing, reopen the last word at the next candidate when nothing is pending, and remove the word on a second delete. **strong**
- Dictionary-only decoding fails on names: with 15% of rare words missing it was about 30% slower; a letter-exact Spell fallback and a personal lexicon are required in the product (R-2 F15). Probabilistic decoders can absorb a mis-selected group instead of forcing a delete (R-2 F14). Both are backend work; v0 designs where Spell lives and leaves it to the model team. **strong for the need**
- Expect 3 to 4 wpm for novices with four gaze selections, rising to 5 to 12 with practice and good decoding (R-2 F5). **strong**
- Word prediction has repeatedly failed to raise speed because scanning a list costs more than it saves: Koester and Levine found the cognitive cost outweighed the keystroke savings, and SpeakFaster's five phrase options took 12 to 21 s to pick even while adding 29 to 60% speed for two users (R-3 §17, R-5 §2.18). One stationary inline candidate that accepts with a single selection is the right shape for a gaze UI; more candidates must occupy their own quadrant and never shift the first (R-3 §3.6, R-5 §4.9). **strong**
- Repair should swap candidates and delete words, not characters: SpeakFaster removed backspace from its repair path, GazeSpeak needed a wink or a 2 s closure to delete one character (R-5 §4.10). The shared composer's delete therefore reopens the last word at its next candidate. **strong**
- Partner speech is the highest-value context for prediction (SpeakFaster assumes it is available and names ASR of the partner as the way to get it), and users want dialogue context but set privacy and transparency as hard conditions (R-3 §18, R-5 §2.18). **strong**
- Users distrust generated whole replies for tone and for making partners think the device did the talking; they prefer completion of their own letters, and trade agency for speed only for time-critical quips (R-3 §18). Style 5 tests a clearly marked whole-reply suggestion against this finding. **strong**

## 8. Conversation, partner and autonomy

- Users are an intersection, not a diagnosis: speech loss plus poor hand control plus imperfect vision plus fatigue, and in ALS a large minority with executive impairment; oculomotor problems are common in CP, MS and Parkinson's (R-3 §1–8). Operational simplicity is clinical, not polish. **strong**
- Timing drives perceived competence: partners judge a lagging user as less capable, cannot see device state, and read over the shoulder or finish sentences, which erodes autonomy (R-3 §10–12). A state readable from across the table (listening, composing, about to speak), an earcon on transitions, and a one-selection floor-holder ("one moment") are the documented remedies; AACrobat's guidelines are autonomy first, engage the partner, user controls sharing (R-3 §3.4, R-5 §2.30). **strong**
- Speaking: whole utterance by default with real pauses at punctuation, a speed control, highlighting the word being spoken so the partner can read along, gender- and accent-matched voices, support for banked voices, a loud mode (R-3 §13–14, §3.5). Repair ("say again", "not that") frequent and often fails, so it must be one selection away after speaking (R-3 §15). **strong**
- Nothing automatic: no auto-commit, no auto-speak, no time limits the user cannot change; recording the partner must be visibly consensual and processed locally where possible (R-3 §18, §24, §3.4). **strong**
- Training and reliability decide adoption: typical provision is 2 to 6 hours against 96 hours an expert needed; abandonment follows lack of training, unreliability and slowness; recalibration happens up to 50 times a day in some homes (R-3 §19–21). A visible tracking-health cue, one-step recalibration and a guided first session are features (R-3 §3.7, R-5 §4.15). **strong**

## 9. Aesthetic direction

- Perceived usability tracks simplicity and craftsmanship, not colourfulness or diversity (VisAWI); first impressions form in 50 ms and halo later judgments; aesthetics drives perceived usability even when real usability is constant (R-4 §25). **moderate**
- Adults call child-coded AAC infantilising and dislike bright colour when overwhelmed; people want assistive devices that look like mainstream technology and feel "cool", not medical or toy-like, and the colour of the device matters to many (R-3 §36–37, R-4 §26). Warmth comes from the user's words and voice, not from the chrome (R-3 §38). **moderate to strong**
- So the brief's "scientific, monotone with purposeful colour" instinct wins over "bubbly casino", and the tracker's preference for light surfaces means the Neuralink-like restraint is rendered on a light page, not a black one. Playfulness survives as generous rounded tiles, confident type and one orchestrated transition. Style 1 keeps the most of the original playful energy, within the colour rules, so the comparison is real.

## 10. Calibration

- Static-marker calibration is tedious and failure-prone; a guide that leads the eye between small high-contrast points, sampling gated by confirmed attention, points covering the grid extremes (especially the bottom row and right column), immediate validation on different points, resume after interruption, and about 20 to 30 s total are the evidence-backed properties (R-6 §32–38, §3.4). A tiny concurrent task at each point with feedback at the same location doubled accuracy for unsupervised children; a smooth-pursuit path at 6 to 7°/s works for people who cannot hold a static fixation (R-6 §33–34). **strong to moderate**
- Calibrate on the same background and brightness as the working UI (R-1 §27, R-6 §37). The reference video's properties worth keeping: one title at a time, small outlined targets with one semantic colour, a quiet caption, nothing else on screen. Its dark surface is the one property not to copy. **strong**

## 11. Expectations and what to measure

- Shipping gaze typing for people with ALS sits near 10 wpm with a practical cap near 20; novices on dwell keyboards reach 5 to 10 wpm, practised users about 20, Dasher 17 to 25 (R-1 §35, R-5 §3). A four-group keyboard with prediction trades letter certainty for fewer selections, so the win condition is selections per word and time per sentence, not letters per minute; instrument keystroke-saving rate as SpeakFaster did (R-5 §4.19). **strong**
- Fatigue is under-measured in the literature and the largest workload term for users; plan sessions of about 10 minutes with breaks and measure strain in tests (R-1 §34, R-3 §8). **moderate**

## 12. Open questions the prototypes should help answer

1. Measured accuracy and precision of the repo's webcam tracker at 50 to 70 cm with free head movement, by screen region; every target-size number above assumes about 2.5° (R-1, R-3, R-4).
2. Whether a dark page degrades webcam tracking in dim rooms, and whether pupil drift affects appearance-based models (R-4 open questions 1 and 4).
3. Dwell-only versus the current 2 s steady look plus two blinks, benchmarked on the same users (R-3 open question 3).
4. Which dwell indicator form (contracting circle, filling ring, colour ramp) produces fewer errors and less fatigue; no head-to-head exists (R-6 open question 1).
5. Whether reading the middle band in style 1 produces false selections under confirm mode, and how much the confirm step costs in speed.
6. Whether colour on decoded words helps or hurts reading for this population (R-4 open question 2).
7. Whether double letters within one group need the "redwell" repeat or whether look-away-and-back is acceptable.
8. How the partner should see state on a single laptop: top-edge band, audio cue, or a companion device (R-3 open question 5).
9. Whether a whole-reply suggestion is used or resented, and how it must be marked (style 5).

## Numbers used in the brief

| Quantity | Value | Source |
| --- | --- | --- |
| Backend quadrant at 1440×900, 60 cm | 360×450 px, about 6.9° × 8.6° | R-4 §12 |
| Webcam gaze error | 2.4 to 4.2°, 2.3 to 4.6 cm | R-1 §28, R-4 §13 |
| Intent delay before any feedback | 150 ms letters, 250 ms controls | R-6 §21, §3.1 |
| Dwell, letter groups | 600 ms default, 300 to 2000 ms range | R-1 §9, §11; R-6 §3.1 |
| Dwell, controls | 900 ms default | R-5 §4.1, R-6 §3.1 |
| Feedback latency ceiling | 250 ms, 100 ms preferred | R-6 §5 |
| Resume grace, blink tolerance | 100 to 150 ms, 200 ms | R-6 §23, §3 |
| Click length | ≤ 100 ms | R-6 §3.5 |
| Pupil-driven gaze shift on luminance change | 2.6° mean | R-1 §27, R-4 §18 |
| Critical print size | 0.2° x-height, about 20 px here | R-4 §10, §12 |
| Message / labels / controls | 40–48 / 28–32 / 24–28 px | R-4 §3.4 |
| Contrast | Lc 90 message, Lc 75 labels, 3:1 non-text | R-4 §3.5 |
| Phase transition | 250 to 400 ms, exits 150 to 200 ms | R-4 §3.6, R-6 §40 |
| Calibration sampling | 20 to 30 s; pursuit 6 to 7°/s | R-6 §3.4 |
| Speed to expect | about 10 wpm, cap near 20 | R-5 §3 |
