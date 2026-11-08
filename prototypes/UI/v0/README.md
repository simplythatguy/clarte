# Clarte UI v0

The first UI explorations for Clarte's eye-tracking communication aid. Five styles, built in parallel from one brief, so the team can compare layouts and visual directions side by side before committing. Everything here is a prototype: the goal is to decide, not to ship.

This page defines the vocabulary every style, review and future conversation about the Clarte UI uses. If someone says "backend quadrant", this is what they mean.

## Backend Quadrants

The gaze backend does not report a precise point. It classifies where the person is looking into a fixed grid of **2 rows × 4 columns**. Each of the eight cells is a **backend quadrant**, named Q1 to Q8 in reading order:

```
┌──────┬──────┬──────┬──────┐
│  Q1  │  Q2  │  Q3  │  Q4  │
├──────┼──────┼──────┼──────┤
│  Q5  │  Q6  │  Q7  │  Q8  │
└──────┴──────┴──────┴──────┘
```

The backend grid is **always constant**. It never moves, resizes, rotates or changes count, whatever the screen shows. Our own testing found that webcam gaze is unstable at finer resolutions and reliable at this one.

Rules:

1. **At most one actionable element per backend quadrant.** An actionable element is anything the person can select with their eyes: a letter group, a button, a suggestion. Text, labels and pictures are not actionable. The element does **not** have to fill its quadrant. It can be any size and sit anywhere inside the quadrant, as long as it doesn't cross into another one. Size it for the design, not for the grid; looking anywhere in the quadrant still selects it (rule 4).
2. **An element may span several quadrants.** A button in the middle of the screen is fine. It then owns every quadrant it touches (the four centre quadrants Q2, Q3, Q6, Q7), and no other actionable element may touch any of them.
3. **A quadrant may hold zero actions.** Such a quadrant is a **rest zone**: looking there does nothing. Rest zones are where the person reads and thinks.
4. **Selection is by quadrant, not by pixel.** When the backend says Q6, the UI selects whatever single action owns Q6. If nothing owns it, nothing happens.

Reference sketch: [reference/01-backend-quadrants.png](reference/01-backend-quadrants.png).

### Frontend quadrants

A screen may draw any visual grid it likes, from one cell to as many as it wants. Those are **frontend quadrants**. The only requirement is that the actionable elements inside them still satisfy the backend rules. Example: a 3-row × 4-column visual layout with controls in the top row, text in the middle row and letter groups in the bottom row is valid, because the top-row controls each sit inside one backend quadrant of the first backend row and the bottom-row groups each sit inside one backend quadrant of the second backend row. See [reference/02-style1-layout-sketch.png](reference/02-style1-layout-sketch.png).

Important consequence: in that example every backend quadrant holds an action, so there is **no rest zone**. Reading the text in the middle row is classified as the top or bottom backend row, which means a dwell timer starts on whatever action owns that quadrant. A layout with no rest zone needs a selection method that reading cannot trigger (a confirm step such as a blink, a switch or a key), or must deliberately give up one or more quadrants to the text. Each style below states which it does.

### Checking a layout

`shared/quadrants.ts` is the single source of truth for the rules. UIs mark every actionable element with `data-action="<id>"`. `validateLayout` reports violations, `actionIn` resolves a quadrant to its action, and the developer overlay (`shared/overlay.ts`, toggled with the backquote key) draws the grid, the gaze point, the dwell progress and any violation live. A layout that breaks rule 1 logs a `console.error` and shows red cells. Run `node prototypes/UI/v0/shared/selftest.ts` for the headless checks.

## Letter groups

Typing uses four letter groups, selected one group per letter. The sequence of groups is decoded into the most likely word by a language model (in progress; `shared/decoder.ts` is the stand-in).

| Group | Letters shown on the tile | Short name (prose and accessible names only) |
| --- | --- | --- |
| G1 | A B C D E F | A–F |
| G2 | G H I J K L M N | G–N |
| G3 | O P Q R S | O–S |
| G4 | T U V W X Y Z | T–Z |

Tiles print every letter of their group (`groupLetters` in `shared/decoder.ts`); a range label such as "A–F" makes the person work out which range a letter falls in, so it is never the tile's label. Reference: [reference/03-letter-groups.png](reference/03-letter-groups.png). While a word is being typed the screen shows the word in progress as the current best decode, one glyph per typed group in that group's colour, with the rest of the predicted word as ghost letters (`pendingGlyphs` in `shared/composer.ts`). When the word is accepted the glyphs settle into plain ink. Concept sketch: [reference/04-colored-words-concept.png](reference/04-colored-words-concept.png).

## Conversation flow

Clarte is for a face-to-face conversation. The flow has two phases:

- **Context phase (Record).** The person starts recording what their conversation partner says, then pauses it. The transcript is context for the language model and for the person.
- **Response phase (Respond).** The person types with the letter groups, accepts predictions, and the message is spoken aloud.

Controls named in the first prototype idea: **R1/R2** (Record → Respond mode button), **AC** (autocomplete: the single highest-probability completion), **D** (delete: removes the last typed group, or the last word when no group is pending), and a **page flip** (↔) that swaps the three feature buttons for three more. Six feature buttons in total; the other three are proposed in [BRIEF.md](BRIEF.md).

## Shared engine

`shared/` is framework-free TypeScript that all five styles import. It fixes behaviour so the styles differ only in presentation:

| File | Purpose |
| --- | --- |
| `quadrants.ts` | Backend quadrant geometry, layout validation, DOM collection of `[data-action]` elements |
| `gaze.ts` | Gaze engine: quadrant hysteresis, dwell and confirm selection modes, latching, pointer and keyboard adapters |
| `decoder.ts`, `vocabulary.ts` | Letter groups, word signatures, stand-in decoder with context boost |
| `composer.ts` | The message model: committed words, pending groups, candidate index, and the reducer for group / accept / next / delete / clear / phrase |
| `speech.ts` | Listening (Web Speech API in Chrome, scripted fallback elsewhere) and speaking (speech synthesis) |
| `overlay.ts` | Developer overlay and live actionable tracking |
| `sound.ts` | The sound system: calm, generated cues in one key, with levels, volume and ducking under the voice ([SOUND.md](SOUND.md)) |
| `selftest.ts` | Headless checks, run with Node |

The shared folder is owned by the v0 brief, not by any one style. A style that needs a change proposes it in its report rather than editing `shared/`.

## Styles

| Folder | Idea | Rest zones | Port |
| --- | --- | --- | --- |
| `s0/` | Light mock: the owner's light-direction compose screen, wired to the real prediction engine (`index.html`; the original static mock is `static.html`) | Q2, Q3 | served by `s_all` |
| `s1/` | Rails: the first prototype idea as drawn (controls top, text middle, groups bottom) | none, selection needs a confirm step | 5101 |
| `s2/` | Corners: letter groups in the four corners, text top-centre, accept and delete bottom-centre | Q2, Q3 | 5102 |
| `s3/` | Stages: one screen per phase (listen, compose, speak), fewest and largest targets | per phase | 5103 |
| `s4/` | Split: a 2×2 letter keypad on the left, controls top-right, text bottom-right | Q7, Q8 | 5104 |
| `s5/` | Dialogue: the conversation as a thread, whole-reply predictions from the partner's words | Q2, Q3 | 5105 |
| `s6/` | Orb: the owner's 2026-11-07 concept on style 5's grid. A white page, frosted glass cards that turn white as they are looked at, and a light-orange orb that holds the message and reacts to the conversation. Two equally likely words branch into Q1 and Q4, a report-style setup comes first, and the type is Atkinson Hyperlegible Next | Q2, Q3 | 5106 |
| `s7/` | Cloud: a copy of style 6 (v1 stays as it was). The orb with a hand-drawn face lives in the blank middle and leaves whenever text appears there: the face erases itself and the orb fades, then both return when the text is gone. It has 18 reactions to what is said, plus faces for at rest and listening, and two palettes: Soft (style 6) and Vibrant (solid letter cards with white letters). `s_all` shows it as S7 (soft) and S7V (vibrant) | Q2, Q3 | 5107 |
| `s8/` | A copy of style 7 (v2 stays as it was) with the owner's mesh-gradient ball (`s8/src/components/ui/shader-svg.tsx`) in place of the Cloud; it docks at Q2's top-left whenever the middle holds text. The menu drops One moment and Phrases, and there is no dark theme. Cards keep style 6 and 7's sizes. `s_all` shows it as S8 (soft) and S8V (vibrant) | Q2, Q3 | 5108 |
| `s_all/` | Preview of every style: one page with a vertical S0–S8V switcher at the top right | — | 5100 |

Run everything with one command from the repository root: `./clarte ui` (Windows: `clarte ui`) sets up Node, the six styles and the prediction engine, starts them all and opens http://localhost:5100; see the root README. With your own Node and engine set up, the underlying script does the same and starts any style server and the engine that are not already running:

```sh
node prototypes/UI/v0/s_all/serve.mjs
```

The engine is the ported prototype in `prototypes/Word Prediction/v0`. Set up its `.venv`, native build and models once, as its README describes; until then S0 shows "Engine offline". Engine errors print in this terminal. `PORT` moves the switcher (default 5100); the styles then take the eight ports after it.

Then open http://localhost:5100. Each of `s1`–`s8` is a self-contained Vite + React + TypeScript app with its own `package.json` (`npm install && npm run dev` inside its folder). Each has a `DESIGN.md` with its brief; `s1`–`s5` also have a `REPORT.md` written by their builders with evidence, council scores and open questions.

**Onboarding is out of scope for v0.** The product keeps the calibration and onboarding flow from `prototypes/Eye Tracking`. The styles still contain the simulated calibration they were built with, but `?onboarding=off` opens any of them straight into the app, and `s_all` always loads them that way.

## Sound

[SOUND.md](SOUND.md) holds the sound rules, the cue map and the measurements. Style 8 plays the cues; its dev server also serves a listening page with every cue side by side at http://localhost:5108/sounds.html.

## Reference material

`reference/` holds the sketches and style references from the brief and still frames from the calibration motion reference (`reference/calibration-frames/`, taken at the second marked in each file name from `08-calibration-motion-reference.webm`).

## Research

[RESEARCH.md](RESEARCH.md) is the synthesis of the literature review behind these designs, with the per-topic notes it was built from under `research/`. Design decisions in each `DESIGN.md` cite it.
