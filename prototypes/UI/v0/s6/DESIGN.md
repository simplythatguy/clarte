# Style 6 · Orb

The owner's concept of 2026-11-07, built on style 5 · Dialogue. The grid stays where style 5 put it. The conversation screen gets one object: a gradient orb in the centre rest zone, which holds the message like the jewel in the owner's reference, reacts to the conversation and leans towards whatever card the person is looking at. Two words that fit the typed groups equally well branch into two choices. The first run is a three-page setup in the look of a data report. Every word is set in Atkinson Hyperlegible Next.

The second round of references (owner, 2026-11-07, three Pinterest pins) made it simpler: frosted glass cards with a plain icon and words at the lower left that turn white as they are looked at, a light-orange orb, the menu opening over the blurred conversation, and the word in progress drawn as a selected object with two handles. The owner then took the page back to plain white: the orb's light orange is the only orange on the screen.

Everything else (the thread, the suggested reply, the dwell indicator, the guards, calibration, the menu) is style 5's. Its decisions are in [../s5/DESIGN.md](../s5/DESIGN.md) and are not repeated here.

## The owner's references

| Reference | Taken | Left out |
| --- | --- | --- |
| A product page with one sculpted object in the centre, small labels in the corners | one object at the centre; everything else quiet | 8–10 px corner labels (Clarte's floor is 20 px) |
| A health app's soft lavender orb over a warm wash, with white cards | the orb's material: soft edge, lighter rim (its lavender, the wash and the white cards gave way to the round below) | the greeting and copy |
| A Lottie blob morphing in a slow loop, and a pastel blue, violet and pink blur | the orb's slow organic change of shape; the colour points | the orange–pink colours |
| A grey data report (step counter, bold name and quiet qualifier, small-caption metrics, one large figure with a bar, a chart, hairlines, a warning in a corner) | the setup pages | dense microtype |
| A node graph with curved edges between ports | the branch's lines and ports | the canvas, zoom and the many nodes |
| A banking app's menu (pin 683984262186417711): orange frame, warm white panel, frosted tiles with an icon top left and a label bottom left; the pointed-at tile turns white; the page blurs when the menu opens | the glass cards, white as the dwell, the blurred conversation behind the menu, the orange of the orb | the orange frame and warm panel (tried, then the owner took the page back to white), the small round side buttons, the avatar |
| A sketch editor (pin 1030339221020635460): white page, a selected text box with a handle at each end, a small toolbar whose delete is red | the word in progress as a selected object with two handles (the branch leaves from them); Delete's icon in red | the toolbar itself (every action is a card) |
| A morphing dock (pin 1083678729128794236): a pill of icons whose active item widens to show its label | the state pill: white, a coloured dot, and its width eases to each new label | icon-only items (Clarte always names an action) |

## Quadrants

Conversation and menu: exactly style 5. Q1 is the primary slot, Q4 is Delete, Menu, Not now or One moment, Q5–Q8 are the letter groups, and Q2–Q3 is a rest zone in every state. During a branch, Q4 offers the second word (see below).

Setup:

| Page | Q1 | Q4 | Q5 | Q6, Q7 | Q8 | Rest zones |
| --- | --- | --- | --- | --- | --- | --- |
| Eyes | rest | Next | rest (warning) | rest (report) | Calibrate | Q1, Q2, Q3, Q5, Q6, Q7 |
| Voice | Back | Next, or Skip for now when there is no ready voice | rest (warning) | rest (report) | Make a voice | Q2, Q3, Q5, Q6, Q7 |
| Ready | Back | Start | Text size | Letter dwell, Button dwell | Orb motion | Q2, Q3 |

`check-layout.mjs` reports zero Backend Quadrant violations in all 29 phases at 1440×900 and 1280×720.

## The orb (`src/Orb.tsx`)

One WebGL fragment shader on a canvas behind the thread. It has no library and no texture, and renders at 0.6× device pixels because the orb is soft anyway.

- **Shape.** A circle whose radius is modulated by three low harmonics (2, 3 and 5 lobes) drifting at different rates. That gives the Lottie's slow organic loop: about one full change of shape every 24 s, or 0.04 Hz. That is well under the 0.2 Hz the HIG says people are most sensitive to.
- **Fill.** Light orange (owner, 2026-11-07), drawn at 60% opacity on the white page so it reads as a tint (one token, `--orb-opacity`; the dark theme keeps 100%). Four colour points, from light orange to near white, blended by inverse distance drift inside the shape. The rim towards the lower left lifts to white, like the health app's orb. The core is slightly deeper, the edge is soft but defined, and a faint halo in the orb's own colour surrounds it.
- **Mood.** The conversation state gives the orb a theme within orange: idle is peach, Listening leans coral, Replying apricot (its own theme, owner 2026-11-07) and Speaking tangerine, all light. The theme cross-fades over 600 ms. The state pill stays the text twin, so colour is never the only cue.
- **Lean** (owner, 2026-11-07). The orb leans towards the card gaze is on: a letter group, a word choice, Delete on the right, a menu item, anything with an action. The body shifts about 45 px that way and bulges on that side. It aims at the card's centre, never at the raw gaze point, so it is not a cursor to chase. It eases there at its own unhurried pace (time constant 1.2 s, so a 600 ms letter dwell is over before it arrives) and drifts back to centre when gaze returns to a rest zone. The wobble keeps the same speed throughout. Evidence: `evidence/lean-rest-delete-g1-g4.png` shows rest, Delete, A–F and T–Z after 3.5 s.
- **Pulse.** Each new word heard from the partner, and each word as it is spoken, swells the orb by 3.5% and lets it settle on a spring (Motion).
- **Off.** Reduced motion, or Menu → Settings → Orb motion: Still, keeps one shape and never leans. Only the theme colour still cross-fades.
- **Luminance.** Each palette's deepest orange has relative luminance 0.58 to 0.66, and moods shift hue, not lightness. At 60% opacity the deepest point is lighter still, so these are minimums: on it ink keeps at least 10:1, secondary ink 5.5:1, ghost letters 3.4:1, and the typed group inks 3.8:1 or more (52 px text).
- **Cost.** The frame loop stops whenever nothing is changing: when the orb is set to Still and settled, or when the tab is hidden.

The live message is centred on the orb. History keeps style 5's left and right alignment above it, and the hairline is gone because the orb is the frame.

## The branch (`src/conflict.ts`, `src/Branch.tsx`)

When the typed groups spell two whole words about equally well, the screen offers both instead of guessing. Q1 shows the first word, as it always would. Q4 shows the second word in place of Delete. The word in progress is drawn as a selected object: a hairline box with a handle at each end (the editor reference). Two lines grow from the handles, the left to Q1 and the right to Q4. Each drops below the word, runs beneath the message and rises into a port on the card's inner edge.

**When it branches.** This is the contract for the language model:

- Both are whole words for the typed groups.
- p(second) / p(first) ≥ 0.6.
- p(first) + p(second) ≥ 3 × the summed probability of longer words with the same start.
- At least two groups have been typed, nothing has been reopened, and the decoder is on its first ranking.

The stand-in decoder approximates p with Zipf's law (1 / rank). A word the conversation already used has a context boost and never conflicts with one it did not use.

The factor 3 was measured. Typing every prefix of all 1,256 vocabulary words, a factor of 1 gave 161 conflicts on whole words and 240 mid-word. A factor of 3 gave 98 and 38. Mid-word branches cost Delete for a look, so 3 it is. Example pairs: me/he, them/when, good/more, might/night, room/soon, well/tell.

**Motion.** A branch appears after a group is committed, a few dozen times a day, so each line draws once over 480 ms on the ease-out curve. A small head dot travels the line's front, and the end port fades in as it arrives. Nothing moves afterwards. The owner's note said the line "keeps moving until it reaches a new tracking point". Here it moves until it reaches the place to look, then stops, because a line that kept flowing while the person decides would be idle motion beside an armed target. Leaving is a 150 ms fade. Under reduced motion the finished drawing fades in.

**Recovery.** Typing another group continues the word and the branch goes. Delete is not reachable during a branch. To undo, accept either word and then choose Delete word, which reopens it with the next candidate. A screen-reader status line says "Two words fit: might or night."

## Setup (`src/Setup.tsx`)

There are three report pages before the first conversation. The counter reads "1 of 3"; then come the location label, the section in bold with a quiet qualifier, a row of metrics, a progress hairline, one large figure with a bar, and a chart. Each half of the report lines up with one backend row, and text keeps 40 px from the row boundary. The pages share the conversation's white page, so going from setup to the first conversation changes no luminance.

- **Eyes.** The metrics are the gaze source (Mouse in this prototype), calibration, the selection mode and the letter dwell. The figure and the 2 × 4 map count the places the gaze engine has seen a look in since the page opened. These are real engine data: looking at the five rest zones reads "5 of 8". Calibrate runs style 5's calibration sequence and returns here. "Not calibrated" sits in Q5 until it has run.
- **Voice.** This page reads the local voice service (`prototypes/Voice`, port 4322) and never writes to it. The metrics are the source, pieces used, other voices flagged and status. The figure shows seconds of clear speech against the 60 s recommended. Recordings appear on a two-minute strip, clearest first, with a one-minute mark, and up to three files are listed. Make a voice opens the Voice prototype, which owns recording, consent and the clone. If the service can't be reached, the page says "Clarte cannot reach the voice service on this computer." and Next becomes Skip for now. The service only answers the origins it lists. To let this page read it, start it with `CLARTE_VOICE_ORIGINS=http://localhost:4321,http://localhost:5106`. The debug phase `setup-voice-sample` shows sample data, and the page then says "Setup · Sample".
- **Ready.** The report shows what setup found (eyes, voice, selection, sounds). The four settings are cards in Q5–Q8, and Start goes to the conversation.

`?onboarding=off` (used by the switcher) skips setup. Setup is remembered as done after Start.

At 200% text the cards scale fully. The report's own type grows to about 150% and keeps its two halves by showing the first two metrics, one file row and no chart key. Every action stays on a card.

## Type and legibility

The typeface is **Atkinson Hyperlegible Next** (Braille Institute, 2025), bundled with `@fontsource-variable/atkinson-hyperlegible-next`, so no font request leaves the machine. It is designed for low-vision readers. Its letterforms are deliberately distinct (I l 1, O 0 with a slashed zero, rn m, b d p q), with open counters and a large x-height. Style 5 measured an x-height ratio of 0.496 for it before the shared skin moved to Satoshi.

Why this face for Clarte. Dysarthria is a motor speech disorder, but the people who have it often have the conditions that cause it: stroke, ALS, cerebral palsy, multiple sclerosis, Parkinson's or brain injury. These often bring reduced acuity or contrast sensitivity, visual-field loss, nystagmus, fatigue or reading difficulty. Atkinson addresses letter confusion and low vision directly. OpenDyslexic was not chosen because studies have not found that it helps reading. Lexend is the alternative to try if the owner prefers a rounder face.

How it is set:

- Weights are 450 for reading text, 600 for messages and labels, and 650 for letter tiles and the state pill. Nothing uses a thin weight, and bold is used sparingly (the HIG prefers regular to bold).
- Tracking is never negative. Style 5's −0.025em was removed. Letter tiles are tracked +0.1em, so each letter stands apart.
- Line height is 1.16 for messages and 1.4 for thread turns.
- Text is sentence case, never all caps, with no italics.
- Nothing is smaller than 18 px. Strip labels are 18 px; everything else is at least 20 px.
- Text size goes to 200% across the whole task.
- Secondary greys are darker than style 5's (`#4A4650`, `#69646F`), so they pass on the orb as well as on the page.
- Orb motion can be turned off for anyone sensitive to movement.

## Look

- **White page** (owner, 2026-11-07: "back to white; only the gradient is light orange"). No frame, no wash. The orb is the only orange on the screen.
- **Glass cards.** Cards are frosted glass: a soft neutral veil (about `#F3F3F4` on white) with a hairline edge and a backdrop blur. Each control has a plain 36 px icon at its top left and its words at its bottom left. The two-circle motif and its ring are gone. The ink primary card in Q1 stays dark, so its luminance is constant.
- **The dwell is the card turning white.** After the intent delay the glass clears a step and its edge darkens (the focus cue). Then a white wash rises from the bottom edge, linearly over the remaining dwell, until the card is solid white. A selection adds an ink edge while gaze remains. A look that leaves early drains the wash over 150 ms, and after a selection it fades. The wash is one element scaled with `transform`, so a dwell does not paint. Under reduced motion it steps up in quarters. On the dark Q1 card the wash is a light veil instead of white. In confirm mode a preview shows the full wash at half strength.
- **Letter cards show only their letters** (owner, 2026-11-07), at the lower left in their group inks (5.8:1 or more on glass). Style 5's count dashes were a colour-blind backup for group identity and repeated what each card already shows, so they are gone.
- **Delete is red** (`#D42A1E`, 4.6:1 on glass, a 36 px icon), as in the editor reference. Only the icon is red; the label stays ink.
- **The state pill** is white glass with a coloured dot (red, magenta, green, as in style 5). Its width eases to each new label over 300 ms, like the reference dock.
- **The menu** opens over the conversation. The thread stays where it was and blurs (14 px, 300 ms) behind the menu's title, instead of being replaced.
- The selection edge and keyboard focus are ink, so nothing else competes with the orb's orange.
- Dark theme: near-black page, glass as a light veil, deep ember orb palettes, and light group inks.

## Libraries

- **Motion 14.6.0** (MIT) is used, in its imperative `animate()` form. It drives the orb's mood cross-fade, the stillness ease and the pulse spring, plus the branch's line draw. No React wrapper is needed. The card wash and the pill's width use the browser's Web Animations directly.
- **Custom WebGL** draws the orb. It is about 60 lines of GLSL, and it gives exact control over the two rules a library would not know: stop while gaze is on an action, and never change luminance.
- **Paper Shaders** (`@paper-design/shaders-react`, Apache-2.0) was evaluated and not used. Its mesh and grain gradients are the closest library match to the pastel reference, and it is the first thing to try if the owner wants a richer material. Its frame loop and parameters would need wrapping to freeze on gaze.
- **Lottie** (`lottie-web`, dotLottie) was not used. It plays authored vector animations. The reference blob would need re-authoring in orange, and it could not respond to state, freeze mid-loop or render a mesh gradient.
- **GSAP** (free, with all plugins) was not used. It could do everything above, but Motion already covers it at a smaller size.

## Departures from the contract

The owner's newest explicit decision wins (precedence 1, `docs/skills-for-clarte.md`). This style departs from the 2026-11-07 shared skin and the stillness rule in three places. Each departure is limited, so the others stay comparable.

1. **Gradients and glass.** The skin says "no gradients". This style has the orb and frosted (backdrop-blurred) cards.
2. **Idle motion.** The contract says "no idle motion" and "nothing moves while armed". The orb wobbles at 0.04 Hz all the time and leans slowly towards the looked-at card, even during a dwell. Mitigations: it is never attached to the gaze point, it stays in the rest zone, it moves at the same slow pace whatever the person does, and Orb motion: Still turns it off.
3. **Typeface.** The skin uses Satoshi. This style uses Atkinson Hyperlegible Next, which the voice prototype already uses.

## Open questions for the owner

1. Should the branch keep Delete reachable? The alternative would be offering the second word somewhere other than Q4, which has no free quadrant in this layout. Or is accept-then-Delete-word an acceptable recovery?
2. Should the orb's motion stay on by default, or default to Still with the motion as an option? This needs a test with the real webcam tracker: does a lean in the centre pull gaze back off the card mid-dwell?
3. Should the Voice prototype itself move to the report look? Its screens are pointer-operated and have their own skin, and this style only reports on them.
4. Should Clarte speak with the person's cloned voice in the conversation? That needs `POST /voices/{id}/speak` and timer-driven word highlighting. Today it uses the system voice.
5. Should Atkinson Hyperlegible Next become the type for every style, or Lexend? The decision belongs in the shared skin, not only here.

## Evidence

The screenshots are in `evidence/`, all real renders of the running app:

- idle, branch, listening, menu (the blurred conversation), worst case and dark at 1440×900;
- a card mid-dwell (the white wash rising on Menu);
- the orb's lean (rest, Delete, A–F, T–Z);
- branch and the voice report at 1280×720 with 200% text;
- the three setup pages.

The voice page in these is the sample phase. No real recordings, transcripts or voices appear.
