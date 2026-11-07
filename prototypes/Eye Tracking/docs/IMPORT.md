# Standalone import

Imported into `prototypes/Eye Tracking` from the corrected parent prototype source pin:

```text
88545f48e22aaa59b66d987d0923c3cb708344148a37c10113c8dac8c0d3402d
```

The parent's 715-file manifest covered scratch source, models and build outputs. Its SHA-256 is `79e38b330fc3c3044a1317a4956c8f484e4d0f9b5724caa643865c5f6f0bef96`. It is an origin receipt, not the fingerprint of this differently packaged folder. [IMPORT-SOURCE.json](IMPORT-SOURCE.json) lists the original path, byte count and SHA-256 for every imported file, with an explicit list of packaging adaptations. `npm run check:import` verifies every unchanged copy without needing the original workspace.

Vendor/public assets, Vite/TypeScript config and LICENSE are exact copies. App integration and tests include the two narrowly scoped post-import review fixes described below. `src/styles.css` and the HTML theme-color metadata implement the latest user request for light mode. This includes the parent's fixed App and eight regression cases for saved-choice/model reset, interrupted restore completion, and interrupted completed-free-flow promotion. The gaze model, worker, tracking and persistence engines and third-party sources remain unchanged. App pause gates were corrected after independent import review.

Packaging adaptations and the requested light-mode styling:

- `.gitignore`: Ignore dependencies, builds, local test evidence, reports, environment files and logs.
- `README.md`: Standalone nested-path setup, current flow, privacy, license, verification commands and acceptance limits.
- `package.json`: Add exact existing Playwright 1.64.1 dev dependency, compatible Node engine and import-integrity command.
- `package-lock.json`: Lock Playwright and its dev-only dependencies; preserve all original package versions.
- `scripts/runtime-browser-check.mjs`: Resolve Playwright from this package instead of a machine-specific npm cache.
- `scripts/check-fixture-camera.mjs`: Resolve Playwright from this package instead of a machine-specific npm cache.
- `scripts/check-server.mjs`: Accept an explicit loopback origin/output, keep receipts ignored, compare app asset bytes and verify HEAD/POST behavior.
- `scripts/fingerprint.mjs`: Fingerprint committed source/model/assets/docs without requiring excluded dist or old scratch receipts.
- `docs/MINIMAL-FLOW.md`: Keep current behavior and parent lifecycle fixes; remove scratch-only paths and prior verification claims.

- `src/styles.css`: requested light palette, visible blue reference circles, contrasting target borders, selection/focus states and amber diagnostics.
- `index.html`: white browser theme-color metadata.

Added import metadata/integrity checking and concise source/license documentation. The locked production dependencies and all previously locked dependency versions are preserved. Playwright is development-only. The retained production license inventory therefore remains unchanged.

Excluded: `node_modules`, `dist`, local test captures/logs, personal attachments, calibration/camera data and historical scratch verification reports. The checked upstream source snapshots, models, WASM, patches, source maps and license notices remain so their audits work in a fresh clone. `docs/PROVENANCE.md` replaces old phase-specific reports as the current source/license guide. Clarte's existing root files and `sources.lock.json` continue to describe its skills and are unchanged.

[WEBEYETRACK-SOURCE-FINGERPRINT.json](WEBEYETRACK-SOURCE-FINGERPRINT.json) is this import's **source/model/asset** manifest. It excludes itself, `dist`, dependencies and evidence. Verify it before building or after reproducible checks with `node scripts/fingerprint.mjs --verify`; regenerate only after reviewing intentional source changes. `public/vendor/webeyetrack/BUILD.json` separately pins the generated worker/dependency inputs. The browser report separately pins tested HTML/JS/CSS build bytes, and the HTTP audit compares the served build/model/license assets to local hashes.

Fresh checks and runtime commands are in the [README](../README.md). Historical source tests do not imply that the inactive WebGazer runtime is used. Fake cameras, synthetic workers and tensor fixtures do not establish physical gaze or blink accuracy. Browser screenshots are test fixtures; no externally recorded or T3 demo is included by this import worker. The parent owns final independent review, media inspection and publication.

## Independent import review corrections

Review found two additional event-ordering cases. A free-flow pause can itself advance the timer to completion, so its completed-state gate now runs after pause. A final calibration acknowledgement can arrive after blur/hide and refocus, so pausing while collecting retains an explicit controls latch until Continue. Accepted labels are preserved; training still begins exactly once after continuation. Eight boundary cases cover both blur and hidden documents, the failure orderings and adjacent controls. The full suite now contains 184 tests. These App/test adaptations are explicit exceptions to the original-copy audit, while the source manifest pins their new bytes.

## Accuracy and layout changes after import

Requested after real-webcam use found selection unreliable. These are deliberate adaptations, listed in [IMPORT-SOURCE.json](IMPORT-SOURCE.json); the gaze model, worker and third-party sources remain unchanged.

- `src/core/webeyetrack.ts`: request 1280x720 capture and run inference at up to 1280 pixels wide, instead of 640x480, so the eye-patch crop has more detail. Saved calibrations from 640x480 are rejected as a camera change and need recalibration.
- `src/core/target-snap.ts` (new) and `src/App.tsx`: in two-blink mode, camera estimates snap to the nearest target within reach, using a three-frame median and hysteresis, instead of requiring an exact hit. Estimates far from every target or well past the screen edge still count as looking away.
- `src/core/selection-learning.ts` (new), `src/App.tsx` and `src/components/Settings.tsx`: confirmed gaze selections pair the estimates that settled on a target with its centre and fit a bounded offset, then offset and scale, correction. It applies only to navigation, stays in memory, resets on recalibration and can be turned off with **Learn from selections**. Raw samples, gaze history and selections are still never persisted.
- `src/components/Targets.tsx` and `src/styles.css`: navigation is eight blank targets in four columns and two rows.
- `src/core/calibration-models.ts` (new), `src/core/validation.ts`, `src/core/check-report.ts` (new), `src/components/CheckReport.tsx` (new) and `src/components/Settings.tsx`: the free-flow check scores affine, robust affine, quadratic and thin-plate screen corrections leave-one-reference-out on its own samples and keeps only aggregates; **Settings → Check results** shows them with the per-reference offsets.
- `src/core/target-classifier.ts` (new) and `src/App.tsx`: two-blink mode decides the looked-at target with a probabilistic classifier over the targets plus looking away, seeded by the check's measured offsets and noise.
- `src/core/one-euro.ts` (new) and `src/core/webeyetrack.ts`: the on-screen pointer follows the unclipped estimate through a One Euro filter (tuned by simulation against the previous Kalman output: about half the jitter and about five times faster settling). Held-out checks and blink selection still use the unfiltered estimate.
- `src/core/head-position.ts`, `src/core/tracking.ts`, `src/core/worker-engine.ts` and `src/App.tsx`: frames now carry image-geometry head pose computed from face landmarks. It is fed to the existing head guard, and learning from selections pauses while the head is away from where navigation was checked.
- `src/core/worker-engine.ts`, `vendor/webeyetrack/worker.ts`, `src/core/webeyetrack.ts`, `src/core/replay-file.ts` (new), `dev/`: development-only replay recording of instructed frames and an offline experiment page, as described in the README. The worker only accepts these commands when a development page initializes it.
- Tests and the browser check follow the new target names and count; `tests/selection-accuracy.test.ts` (new) covers snapping and learning. None of this establishes physical gaze accuracy.
