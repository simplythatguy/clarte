# Tracker and license provenance

This standalone package preserves both the active WebEyeTrack implementation and the inactive WebGazer history needed by its audits and safety regressions. Sources, licenses and model files remain separate; no tracker has been substituted or relicensed.

## Active WebEyeTrack

- Official source: [RedForestAI/WebEyeTrack at 75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c](https://github.com/RedForestAI/WebEyeTrack/tree/75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c), JS package metadata **0.0.2**.
- `vendor/webeyetrack/UPSTREAM.json` pins all **199** pristine snapshot files and the source archive digest. The original examples, Python files and upstream documentation assets are intentionally retained because the audit covers the complete snapshot. No upstream installers, training pipelines or CI workflows are executed by this app.
- Source and BlazeGaze model/weights retain the original [MIT license](../vendor/webeyetrack/LICENSE), copyright (c) 2025 Eduardo Davalos, Yike Zhang, Amanda Goodwin, Gautam Biswas. No separate model license is present in the retained snapshot; its repository MIT grant and notices are retained alongside the model.
- `vendor/webeyetrack/ASSETS.json` records origins, bytes, SHA-256 hashes and licenses for **seven** essential local model/WASM assets. MediaPipe Tasks Vision/WASM is **0.10.18**; the FaceLandmarker task is the official float16 version 1, licensed Apache-2.0. WebEyeTrack model JSON/weights come from the pinned upstream minimal example.
- TFJS **4.22.0** is Apache-2.0; ml-matrix **6.12.1** is MIT. Exact versions and transitive packages are locked in `package-lock.json`. Distributed dependency license files are copied to `public/vendor/webeyetrack/licenses/`, with the full notice in `NOTICE.txt` and linked bundle legal comments.

The adapter bypasses the upstream proxy's implicit camera start/global-click training and owns one camera/session/worker. It preserves the upstream preprocessing, metric head features, BlazeGaze architecture and adaptation mechanism. Normalized `(x,y)` maps to viewport position using `(point + 0.5) * size`.

## Reproducible adaptations

`vendor/webeyetrack/js/src` is pristine; `local` contains reproducible adaptations. `scripts/adapt-webeyetrack.py` and `vendor/webeyetrack/LOCAL-ADAPTATIONS.patch` describe the changes:

- Local model/WASM URLs, CPU FaceLandmarker with disposal, TFJS WebGL with CPU fallback.
- Explicit bounded batch personalization, no global-click labels, estimator-only gradients and SVD affine solve; the encoder stays frozen.
- Support/optimizer/tensor/model disposal, fresh filters, camera matrix reconstruction and intrinsics flag correction.
- Separate raw pre-Kalman estimates for held-out checks, without changing prediction/adaptation math.
- Export/restore only six learned estimator tensors plus affine and face-width normalization.
- Fresh face presence and bilateral EAR hysteresis expose open/closed/unknown separately. Missing faces never become blink events.

`vendor/webeyetrack/worker.ts` is the local message boundary. `public/vendor/webeyetrack/BUILD.json` records exact worker inputs and outputs. The worker excludes the upstream `WebcamClient`, global-click proxy and WebGazer. `npm run build:vendor` rebuilds it from these sources, the pinned installed dependencies and linked legal comments. No model download runs during build/startup.

Read-only reproduction checks:

```sh
python3 scripts/check-webeyetrack-adaptations.py
python3 scripts/check-adaptations.py
node scripts/check-webgazer-historical.mjs
```

The first verifies the entire pristine WebEyeTrack snapshot, replays the adapter in a temporary directory and compares the portable patch. `scripts/fetch-webeyetrack-assets.mjs` is an optional development-time restoration utility only; it accepts bytes only when their hashes match `ASSETS.json`. It is not run by install, build or the app.

## Historical WebGazer

[Official source at b12701dd7b6d7b00d4b8dbebf87fdec840c24999](https://github.com/brownhci/WebGazer/tree/b12701dd7b6d7b00d4b8dbebf87fdec840c24999), manifest version **3.5.3**, is retained under `vendor/webgazer`. Its source, GPL/LGPL texts, pristine changed-file originals, adaptation patch, public runtime/model assets and safety tests remain. It is **not loaded by the current app**. The standalone package retains **GPL-3.0-or-later** and the exact original package LICENSE; this import does not change Clarte's repository-wide licensing.

The historical adapter removes localforage persistence and incidental global mouse training, requires explicit fresh calibration labels, owns all tracks/async cleanup, and adds decoded-frame freshness/head geometry metadata. `scripts/check-adaptations.py` replays all three changed source files from the retained originals. `scripts/check-webgazer-historical.mjs` verifies upstream hashes, identical served MediaPipe copies and retained build fingerprints. `scripts/build-webgazer-historical.mjs` is the optional historical bundle regeneration command; the normal `build:vendor` builds only WebEyeTrack. Historical source and bundle GPL/BSD/Apache/MIT copyright notices remain intact in `vendor/webgazer`, `public/vendor/licenses` and bundle legal comments.

Keeping those artifacts makes the clone larger (about 114 MB of files before npm/build). The largest file is the upstream WebEyeTrack demo GIF (about 17.2 MB), below GitHub's 100 MB file limit. It is retained to preserve the audited 199-file snapshot. These are upstream demonstration/model resources, not captured user camera data.

## Verification boundaries

The [current flow](MINIMAL-FLOW.md) describes the imported behavior. Original scratch verification logs, screenshots and build output are excluded. Fresh import checks must use this folder's build and local dependencies. Unit/hook fixtures, synthetic tensors and browser fake-device/worker tests are labelled separately from physical-user acceptance. No human gaze/blink accuracy, clinical/AAC suitability or production/device acceptance is asserted.
