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

1. **Welcome**, with **Get started**. Get started is one tall card over Q4 and Q8. Until calibration the eyes cannot select, so it counts down and starts by itself after 20 seconds. A key, a click or a mouse movement stops the countdown, since the person can then select another way.
2. **Eye calibration.** The card slides off to the right, and the orb becomes the point to look at. It glides to the centre of each of the eight backend quadrants, and a blue ring closes round it while the tracker collects there. The run takes about 20 seconds, then the tracker trains. The calibration is saved on this browser. There are no captions. If the camera fails or a run does not train, the page says why and offers **Try again**.
3. **Voice cloning.** A placeholder that says "This is being worked on", with **Continue** on the tall card. There is no countdown here: the eyes select it.
4. **The conversation screen.**

On later launches the app opens on the conversation screen and restores the saved calibration. It runs calibration first only when the camera's shape or the window size has changed enough that the saved calibration no longer fits, or when the camera fails. **Menu › Recalibrate** runs a new calibration in a fresh tracker worker. The new calibration replaces the saved one only once it has trained. Escape keeps the calibration in use, and so does **Keep the old one** after a run that did not train.

## Input

- **Eyes**, by default. Looks come from the webcam tracker. While the tracker is not calibrated, the mouse stands in.
- **Mouse.** Add `?input=mouse` for no camera. Pointer position is the look. **Use the mouse** after a camera failure does the same for the session.
- **Keys and clicks**, always. Keys 1 to 8 select the quadrant with that number, and a click selects a card.

Other URL options: `?reset` forgets everything the app saved on this browser (first-run state, settings, the calibration) and starts the first run again, `?onboarding=off` opens straight into the conversation, `&palette=vibrant` uses the vibrant letter colours, and `#phase=<name>` opens a debug phase (`window.clarteDebug.phases` lists them).

## Check it

Run these in `main/app` while `./clarte ui` runs:

- `node scripts/selftest.ts` checks the gaze engine, the quadrant rules and the composer.
- `npm run check` puts every debug phase through the backend-quadrant layout check at four window sizes.
- `node scripts/e2e-first-run.mjs` drives the first run in Chromium on a fake camera. It needs Gaze Lab's face fixture (`npm run fixture` in `prototypes/Gaze Lab`). A photo cannot move its eyes, so this check proves the plumbing, not gaze accuracy.
- `npx tsc --noEmit -p tsconfig.json` typechecks the app.

## Where things live in the app

- `src/App.tsx` routes every selection and holds the first-run flow, including the Get started countdown.
- `src/model.ts` holds the state, the reducer and what Q1 and Q4 offer.
- `src/words.ts` decides which word the word card shows and when Options opens (PR #24's rules).
- `src/prediction/` holds the engine client and the local decoder. Rebuild its tables from `engine/models` with `scripts/build-*.mjs`.
- `src/eyes/` holds the tracker, the calibration run and the saved calibration. `src/GuideOrb.tsx` draws the orb and drives the run. `src/eyes/core/` and `public/vendor/webeyetrack/` are byte-identical copies from Gaze Lab, listed with their hashes in `src/eyes/SOURCE.json`.
- `src/core/` holds the gaze engine, the quadrant rules and the composer, from UI v0's shared folder.
- `DESIGN.md` records the conversation screen's design decisions.
