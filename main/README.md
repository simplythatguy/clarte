# Clarté

`main/` is the app: the latest work from the prototypes, put together. New product work goes here. `prototypes/` keeps the explorations it came from.

| Folder | What it is | From |
| -- | -- | -- |
| `app/` | The app: UI v1's conversation screen, the first run, the webcam eye tracker and the prediction client. Vite, React and TypeScript. | `prototypes/UI/v1/s1`, with v0's shared engine, v0 s6's prediction client and Gaze Lab's tracker |
| `engine/` | The word-prediction engine and its HTTP contract ([`engine/CONTRACT.md`](engine/CONTRACT.md)). Python. | `prototypes/Word Prediction` (PR #24), moved |

## Run it

From the repository root:

```sh
./clarte ui               # Windows: clarte ui
```

The launcher installs what both parts need, starts the engine on port 8765 and the app on port 5200, and opens http://localhost:5200/. The engine takes 40 to 80 seconds to load its models. Until it answers, the app uses its local decoder, so typing works from the first second.

To run the app alone, run `npm ci && npm run dev` in `main/app`. The app finds an engine on ports 8765 to 8769, or the one that `?engine=<origin>` names.

## What the person sees

Every launch starts the same way (owner, 2026-11-08):

1. **Welcome**, with **Get started** as a tall ink card over Q4 and Q8, and the orb and the words centred in the three columns to its left. **Keyboard and mouse** is quiet text at the foot of Q6, not a card: the owner wants people to try calibration, and the people who skip it point and click. Until calibration the eyes cannot select, so Get started counts down and starts by itself after 20 seconds. A key, a click or a mouse movement stops the countdown, since the person can then select another way.
2. **Eye calibration**, after Get started. Get started slides off to the right and Keyboard and mouse fades. The orb becomes the point to look at. It glides to the centre of each of the eight backend quadrants, and a blue ring closes round it while the tracker collects there. The run takes about 20 seconds, then the tracker trains. The new calibration is saved on this browser. There are no captions. If the camera fails or a run does not train, the page says why and offers **Try again**. Escape during a run, or **Keep the old one** after a failed run, keeps the saved calibration from an earlier launch.
3. **Making your voice**, until the person has finished these pages once, by **Continue** after making a voice or by **Not now**. Later launches go from calibration straight to the conversation. **Menu › My voice** opens the voice pages at any time. The voice made and the voice chosen stay across launches.
4. **The conversation screen.**

**Keyboard and mouse** skips calibration. No camera starts, and the session runs on the keyboard and the mouse, as **Use the mouse** does after a camera failure. A click or keys 1 to 8 select, and hovering never does.

**Menu › Recalibrate** runs a new calibration in a fresh tracker worker. The new calibration replaces the saved one only once it has trained. Escape keeps the calibration in use, and so does **Keep the old one** after a run that did not train. If the camera fails during the conversation, or the calibration no longer fits the camera or the window, the calibration screen opens.

## Input

- **Eyes**, by default. Looks come from the webcam tracker. A look never selects (owner, 2026-11-08: no dwell): a steady look closes the line round a card and waits, and the person's **sound**, Space or Enter, a click or a switch selects it.
- **The person's sound** (DEC-128). The person says "yeah" to select a card their look has armed. **Menu › Settings › My sound** teaches Clarté their own "yeah" in about 30 seconds; after that only their "yeah" selects, and other people talking, someone beside them, claps, coughs and traffic do not (`src/listen/`). Before it is taught, a generic rule stands in: a voiced sound that rises clearly out of the room. The microphone is raw (no echo cancellation, noise suppression or automatic gain), and listening pauses while the partner is heard or Clarté speaks. Without a calibrated tracker the pointer stands in for the eyes, except on Welcome and calibration.
- **Keyboard and mouse.** **Keyboard and mouse** on Welcome, `?input=mouse`, or **Use the mouse** after a camera failure: no camera. A click or keys 1 to 8 select; hovering never does.
- **Hearing the partner.** **Listen** turns the partner's speech into text in the conversation. It uses the browser's own speech recognition where it works (Google Chrome, which sends the audio to Google). Where it is missing or fails (Chromium builds, Electron, Brave, no network), the engine's Whisper takes over on this computer for the rest of the session and nothing leaves the machine (`src/listen/partner.ts`, the engine's `POST /api/v1/transcribe`). If neither can listen, Listen stops and its card says it couldn't hear, with the reason in its name; nothing is ever put in the partner's mouth. **Menu › Settings › Dev Tools › Partner voice** chooses Microphone (that order), This computer (Whisper only) or Script (the demo lines, only by choice).
- **Keys and clicks**, always. Keys 1 to 8 select the quadrant with that number, and a click selects a card.

Other URL options: `?reset` forgets everything the app saved on this browser (first-run state, settings, the calibration) and starts the first run again, `?onboarding=off` opens straight into the conversation with no camera, `&palette=vibrant` uses the vibrant letter colours, and `#phase=<name>` opens a debug phase (`window.clarteDebug.phases` lists them).

## Check it

Run these in `main/app` while `./clarte ui` runs:

- `node scripts/selftest.ts` checks the gaze engine, the quadrant rules and the composer.
- `npm test` runs those checks plus the always-open Options regression tests, the centre guards and the partner speech cutter (`scripts/test-partner.ts`).
- `npm run test:ui -- http://localhost:5200` checks the Options flow, late prediction updates, and all debug layouts at both supported sizes and 200% text against a running Vite dev server. Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge instead of Playwright's Chromium.
- `npm run check` puts every debug phase through the backend-quadrant layout check at four window sizes.
- `node scripts/e2e-first-run.mjs` drives the first run and a second launch in Chromium on a fake camera. It needs Gaze Lab's face fixture (`npm run fixture` in `prototypes/Gaze Lab`). A photo cannot move its eyes, so this check proves the plumbing, not gaze accuracy.
- `node scripts/e2e-sound-select.mjs` checks the generic sound rule on a fake microphone: a look arms a card, steady noise does not select, and a short "ah" does.
- `node scripts/e2e-partner-listen.mjs http://localhost:5200 http://127.0.0.1:8765` plays a spoken sentence (macOS `say`) into a fake microphone in Chromium, which has no Google speech service: Listen must hand over to the engine's Whisper and show the real words, never a demo line.
- `node scripts/e2e-listen.mjs` teaches one person's sound on a fake microphone (CNVVE recordings in `fixtures/listen`): their held-out takes match; two other people's and a clap do not; with a card armed, only their own sound selects it.
- `node scripts/listen-eval.ts <data dir>` scores the listener offline on public recordings against the old loudness detector (see its header for the data).
- `npx tsc --noEmit -p tsconfig.json` typechecks the app.

## Where things live in the app

- `src/App.tsx` routes every selection and holds the launch flow, including the Get started countdown and whether the voice pages are done.
- `src/model.ts` holds the state, the reducer and what Q1 and Q4 offer.
- `src/words.ts` orders the inline prediction and Options choices. During grouped typing Q4 always opens Options, including when just one word is predicted. Choosing a word there accepts it; opening Options never accepts or speaks. The chooser snapshots its list until Back or acceptance, so a late response cannot change the selected word.

- `src/prediction/` holds the engine client and the local decoder. Rebuild its tables from `engine/models` with `scripts/build-*.mjs`.
- `src/eyes/` holds the tracker, the calibration run and the saved calibration. `src/GuideOrb.tsx` draws the orb and drives the run. `src/eyes/core/` and `public/vendor/webeyetrack/` are byte-identical copies from Gaze Lab, listed with their hashes in `src/eyes/SOURCE.json`.
- `src/core/` holds the gaze engine, the quadrant rules and the composer, from UI v0's shared folder.
- `DESIGN.md` records the conversation screen's design decisions.

The demo keeps the current fetched candidate bounds: up to 20 exact-length alternatives, plus the fetched prediction page and its current best completion. Confidence no longer hides the chooser, and longer completions remain selectable. Full-vocabulary API paging and a literal spelling screen are separate follow-ups; this change does not claim that every possible word is reachable.

Opening Options changes only Q1 (Back) and the bottom row, where the words appear, most likely first; more than four page two at a time with arrows. Q4 keeps the Options card, and selecting it again closes Options. The conversation stays exactly as it was, with no blur and no title (owner, 2026-11-08).
