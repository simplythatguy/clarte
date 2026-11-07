# Eye Tracking

A standalone local webcam gaze prototype for Clarte, imported from a pinned Still prototype. It uses WebEyeTrack 0.0.2 source at `75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c`. The requested light surface uses dark text, blue reference circles and blue navigation targets. The calibration flow is preserved; navigation now uses eight blank targets in four columns and two rows.

## Run

From the Clarte repository root:

```sh
cd 'prototypes/Eye Tracking'
npm ci --ignore-scripts
npm run build
npm run preview
```

Open **http://localhost:4318**. Requirements: Node **22.12+ on the 22.x line, 24.x, or 26+**, npm, Python 3 for the source/privacy audits, and a modern browser with camera access. The import was checked with Node 26.8.2 and npm 11.19.1. Camera capture requires localhost or HTTPS. Initial npm/browser installation needs network access; model loading, inference and personalization use the included local assets.

For development, run `npm run dev` (HMR is disabled). Both commands use port 4318 with strict port checking. If it is already occupied, keep the existing process and use `npm run preview -- --port 4320` or `npm run dev -- --port 4320`, then open http://localhost:4320. Serve this folder as its own app at `/`; model URLs are absolute to that origin. It is not a route inside a parent Clarte app.

## Use

1. **Start camera**, then **Calibrate**. A compatible saved model offers a separate **Use saved calibration** action.
2. A three-second introduction starts nine eye-reference circles with three fresh labels each.
3. **Calibrate head movement** starts its three-second introduction and five references with three more labels each. Labels describe instructed positions; actual eye/head movement is not independently verified.
4. **Calibrating** trains the gaze head on all 42 labels, on this device (settings chosen on recorded data, see [docs/ACCURACY-LOG.md](docs/ACCURACY-LOG.md)): one sample per dot is held out, training keeps the best held-out weights and stops when they stop improving, so it can never end worse than the pretrained head with an affine correction. The same labels also fit a second, geometric estimator from the face landmarks alone (iris position and eyelid heights in each eye, depth, head yaw and pitch: twelve numbers, one bounded ridge regression). The pointer follows a blend of the two, weighted by their held-out errors. **Cancel** releases the camera.
5. **Calibrate free flow movement** starts a separate, frozen-model check lasting 60 active seconds, then opens navigation automatically. **Skip** on its ready page also opens navigation.
6. Eye-openness thresholds for blink detection adapt to the person after about two seconds of frames, within fixed bounds. The learned screen correction is kept per head pose as well as globally, so returning to a posture reuses what was learned there.
7. After the check, **Settings → Check results** shows the measured error, how each correction model would have scored on that run, the pointer offset at each reference, and how the gaze network, the geometric estimator and their blend each scored. The check picks the blend weight with the lowest error and navigation (and the saved calibration) switches to it. Navigation also uses the check's measured offsets and noise before the first selection.
8. If the laptop lid is tilted or the laptop is nudged, the camera moves with the screen. The worker notices this from the background behind you (it must move together with your face, over several frames) and the app re-anchors: during navigation one centre dot re-measures the pointer offset in about two seconds, a running check is cancelled with **The screen moved**, and a running calibration pauses with the same message. Blank walls give the detector nothing to match, so it then stays silent.
9. **Settings → Profile** keeps one saved calibration per named person on this browser (up to six). Switching profile with the camera on starts a fresh calibration for that person and offers their saved one.
6. Navigation shows eight blank, named buttons in four columns and two rows. A steady estimate for about two seconds followed by one bilateral blink previews a target; a second blink confirms it. Looking away cancels a preview. Mouse, touch, Enter and Space also activate targets.

A Settings button is always available: top left on every page and on the start page. Capture screens show a circle, that button and one top-right diagnostic toggle. Diagnostics start off; when enabled, the amber area shows recent estimates, without claiming confidence or verified gaze. Escape or background click/tap opens controls; background Space pauses capture. Continue is explicit after interruption, including pending saved restore and the final free-flow handoff. Settings includes selection mode, pacing, saved-model deletion and an explicitly labelled pointer/B-key simulation. The current navigation prototype has no speech or phrase-composer action.

## Privacy and saved state

Camera images, eye patches, landmarks and labels stay in memory. There are no accounts, uploads, analytics or remote inference, and production builds make no recordings (see the development-only test sessions below). The app's request guard allows known same-origin model GETs; CSP restricts workers and connections to the same origin. Stop releases the owned worker, video and camera tracks.

One bounded `localStorage` record (`still.local-calibration.v1`, at most 512,000 characters) stores only six learned estimator tensors, affine/face-width normalization, the twelve-by-two geometric estimator with its blend weight, and version/camera/window metadata. Named profiles add one directory record (`still.local-profiles.v1`): profile names and, for the profiles that are not active, the same bounded calibration record each; with a single unnamed profile nothing extra is written. Camera start and saved-model choice remain explicit after reload. Geometry/model/schema checks and revocable leases reject stale work. Storage is scoped to the browser origin, and localStorage is not a cross-tab transaction. Delete it in Settings with **Delete saved calibration** or clear this site's browser data. Raw samples, gaze history, validation results, selections and settings are not persisted.

### Test sessions (development only)

Testing a tracker change used to mean calibrating and checking by hand every time. Instead, record each tester once and replay the recordings against every new build:

1. `npm run dev`, then **Esc → Settings**: type a **Tester name (dev)** (for example `Mukhtar`) and turn on **Record test sessions (dev)**. Turn off macOS Center Stage and video effects first.
2. **Calibrate**, finish the head stage and the full 60-second free-flow check. Each Calibrate records one numbered sample (`Mukhtar #1`, `Mukhtar #2`, …; change the name for the next person, e.g. `Omer #1`). Recording stops when the check ends, or on Stop or Recalibrate.
3. In Settings, each sample has **Save session** (one `.clarte-session` file: the raw webcam video plus a timeline of every dot position, calibration label and check sample, and the live check score) and **Download video** (a plain `.webm` to watch). Samples stay in memory only until the page is closed.
4. Put saved sessions in `sessions/` (git-ignored) and run `npm run test:sessions`, or open `/dev/session.html` and load them. Each session is decoded frame by frame and pushed through the current tracker build: the same calibration labels, training and check, so results are comparable across builds. Reports go to `evidence/sessions/`.

Recordings are identifiable face video. They are created only in development builds, only while the switch is on, and only leave the page when someone presses Save.

Development builds also offer **Pose-normalized eye crop (dev)**: the eye strip and head vector are taken from a virtual camera that faces the eyes without roll (a pure-rotation image warp), as gaze-estimation data normalization does. The shipped network was not trained on such crops, so this is off by default and only for comparison: `npm run test:sessions -- --normalize` replays recordings with it, and replay sets record which crop they used.

Development builds also offer **Record replay set (dev)** in Settings. When turned on, the worker keeps the estimator's inputs for instructed frames only (the 512×128 eye strip, head vector, 3D eye origin, landmarks and the instructed label; never free viewing) in memory, and **Save replay set** writes them to a file the person chooses to keep. The dev page `/dev/replay.html` replays such a file through the shipped model to compare personalization methods offline. Production builds contain none of this.

## Verify

Run inside this folder after installation:

```sh
npm test
npm run typecheck
npm run build
npm run check:privacy
npm run check:import
npm run check:model
node scripts/fingerprint.mjs --verify
```

The model check uses the actual pinned model with synthetic tensor inputs. It checks estimator updates, a frozen encoder, learned-state round trips and tensor disposal; it does not measure human gaze accuracy.

The browser runner uses the exact local `playwright@1.64.1` development dependency. Install its matching Chromium once:

```sh
npx playwright install chromium
npm run check:runtime
node scripts/runtime-browser-check.mjs --ui --evidence-root=.artifacts/browser
```

It owns an isolated ephemeral loopback server and synthetic camera context. The first check loads the real shipped worker/model and verifies resource cleanup, storage and network guards. `--ui` additionally runs desktop/narrow synthetic-worker fixtures through calibration, training, frozen free flow, blink selection, pause, saved restore/delete and camera errors. It writes screenshots and JSON receipts to the chosen ignored evidence directory. It never replaces a preview process. Playwright's `PLAYWRIGHT_BROWSERS_PATH` can select an existing installation of the matching browser.

With your own built preview running, audit its bytes and headers on the chosen port:

```sh
npm run check:server -- --origin=http://localhost:4320
```

The audit writes `.artifacts/http-check.json` (override with `--output=...`), compares 94 app/model/runtime/license files with local hashes, checks the worker CSP, and checks HEAD/POST behavior. It will reject a server serving a different build. It does not start or stop servers. Test evidence, `dist` and `node_modules` are ignored. The committed source/model fingerprint works before building; after an intentional reviewed change, regenerate it with `node scripts/fingerprint.mjs`.

## Source, licenses and acceptance limits

[Import provenance](docs/IMPORT.md) records the parent pin and packaging changes. [Tracker provenance](docs/PROVENANCE.md) documents the active MIT-licensed WebEyeTrack source/model, Apache-2.0 MediaPipe/TFJS assets and retained GPL-3.0-or-later WebGazer history. Original notices, patches and upstream manifests are preserved; the standalone package retains its GPL-3.0-or-later declaration and [LICENSE](LICENSE). Clarte's skill lockfile is unrelated and unchanged.

Synthetic tests and screenshots do not establish physical webcam compatibility, human face/gaze/blink accuracy, comfort, head-motion benefit, clinical/AAC suitability or production/device acceptance. See [current flow details](docs/MINIMAL-FLOW.md). This is a local input experiment.
