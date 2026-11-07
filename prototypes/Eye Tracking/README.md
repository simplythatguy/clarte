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
4. **Calibrating** waits for the real local training acknowledgement using all 42 labels. **Cancel** releases the camera.
5. **Calibrate free flow movement** starts a separate, frozen-model check lasting 60 active seconds, then opens navigation automatically. **Skip** on its ready page also opens navigation.
6. Navigation shows eight blank, named buttons in four columns and two rows. A steady estimate for about two seconds followed by one bilateral blink previews a target; a second blink confirms it. Looking away cancels a preview. Mouse, touch, Enter and Space also activate targets.

Capture screens show a circle and one top-right diagnostic toggle. Diagnostics start off; when enabled, the amber area shows recent estimates, without claiming confidence or verified gaze. Escape or background click/tap opens controls; background Space pauses capture. Continue is explicit after interruption, including pending saved restore and the final free-flow handoff. Settings includes selection mode, pacing, saved-model deletion and an explicitly labelled pointer/B-key simulation. The current navigation prototype has no speech or phrase-composer action.

## Privacy and saved state

Camera images, eye patches, landmarks and labels stay in memory. There are no accounts, uploads, analytics, recordings or remote inference. The app's request guard allows known same-origin model GETs; CSP restricts workers and connections to the same origin. Stop releases the owned worker, video and camera tracks.

One bounded `localStorage` record (`still.local-calibration.v1`, at most 512,000 characters) stores only six learned estimator tensors, affine/face-width normalization and version/camera/window metadata. Camera start and saved-model choice remain explicit after reload. Geometry/model/schema checks and revocable leases reject stale work. Storage is scoped to the browser origin, and localStorage is not a cross-tab transaction. Delete it in Settings with **Delete saved calibration** or clear this site's browser data. Raw samples, gaze history, validation results, selections and settings are not persisted.

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
