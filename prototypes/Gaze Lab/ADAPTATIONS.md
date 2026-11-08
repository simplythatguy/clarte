# Adaptations to the copied Clarte sources

Source: Clarte `prototypes/Eye Tracking` at commit `b7b8f98f169f71a7c87e31d71cade3df06c6b3af` (see `SOURCE.json` for the exact
commit string and the sha256 of every copied file). Files are copied by `scripts/copy-source.mjs` and the edits below
are applied by `scripts/apply-adaptations.mjs` (idempotent; fails loudly if an anchor moved). `scripts/check-source.mjs`
verifies that every file not listed here is still byte-identical to its source hash.

The shipped math is unchanged everywhere by default. The behavioural additions are a debug payload, a larger replay buffer, two candidate fixes and three quick-calibration options (collect/train limits, a geometric blend cap) that are off unless `init` turns them on (sections below).

## `src/core/worker-engine.ts`

1. `Observation` gains an optional `durations` field (the tracker already reports per-stage timings; the type did not expose them).
2. New exported type `DebugStep` (head vector, face origin, 16-value face matrix, flat 478×3 landmarks rounded to 1e-5, `GazeFeatures`, the 12-element geometric feature vector, timings).
3. `REPLAY_LIMIT` 600 → 4000, so one block's record-phase eye strips fit in a single export (strips are exported and cleared after every block).
4. `CalibrationEngine.setDebug(enabled)` and a private `debug` flag.
5. `step()` returns `WorkerGaze & { debug?: DebugStep }`: the result object is built exactly as before, then `debug` is attached when the flag is on. `featureVector` is imported for it. Two `performance.now()` reads were added for the timings.

## `vendor/webeyetrack/worker.ts`

`init` reads `payload.debug === true` and calls `engine.setDebug(true)`. Everything else is as shipped (including the
`development` gate for replay recording, which gaze-lab turns on).

## `scripts/build-vendor.mjs`

Banner text names the gaze-lab debug build; `worker.shipped.js` (the untouched shipped bundle kept for parity checks) is
excluded from the `BUILD.json` file list. The license copying reads gaze-lab's own `package-lock.json`, so
`public/vendor/webeyetrack/licenses/DEPENDENCIES.json` is regenerated for this package (fewer runtime dependencies: no React).

## Candidate fixes behind `init` flags (2026-11-07, after the first two live sessions)

Two fixes measured by `scripts/replay-blocks.mjs` (video replay) live in the copied worker behind `init` payload flags
`fixes: { matrixLayout?: boolean; freezePose?: boolean }`. Both default to **off**, which keeps the worker byte-for-byte
in behaviour with the shipped one (`npm run test:parity` is the proof); `node scripts/fixes-check.mjs` proves what each
flag does; `npx vitest run tests/fixes-math.test.ts` proves the pure math. `scripts/make-fixes-patch.mjs` turns the same
edits, with the flags removed and the fixes simply on, into `patches/clarte-eye-tracking-fixes.patch` against the Clarte
paths (generated from the pristine text rebuilt by reversing these edits; verified with `git apply --check`).

### `vendor/webeyetrack/local/utils/mathUtils.ts`

6. `translateMatrix(matrix, columnMajor = false)` (line 259): with `columnMajor`, `M(i, j) = data[j * rows + i]`. MediaPipe
   packs `facialTransformationMatrixes[0].data` column-major (translation at indices 12-14); the shipped read gives the
   transposed rotation. Off = shipped read.
7. `faceReconstruction(..., initialZGuess = 60, columnMajor = false)` (line 473): with `columnMajor` the Euler angles come
   from `inverse(faceR)` (line 506), as Python `model_based.face_reconstruction` does (`np.linalg.inv(face_r)`). The shipped
   row-major read *is* that inverse for an exact rotation, so the fix changes the head vector but not the face origin
   (`tests/fixes-math.test.ts`: identical metric face to 1e-3 cm, the pixel-rounding floor of `refineDepthByRadialMagnitude`;
   `fixes-check`: faceOrigin3D max |Δ| 7e-15 cm on the fixture).
   `getHeadVector` is unchanged and, fed the column-major matrix, returns the face's forward axis `[m8, m9, −m10]`
   (shipped: the third row `[m2, m6, −m10]`). `geometric-gaze.ts` and `pose-normalize.ts` already read the raw data
   column-major and are untouched.

### `vendor/webeyetrack/local/WebEyeTrack.ts`

8. Public flags `fixMatrixLayout` and `fixFreezePose` (after `normalizeCrop`, lines 58-61).
9. `computeFaceOrigin3D` passes `this.fixMatrixLayout` to `faceReconstruction` (line 106); `prepareInput` passes it to both
   `translateMatrix` calls (lines 147 and 165; `normalizeFaceRt` returns column-major data, so the pose-normalized path stays consistent).
10. `adapt()`: `let poseMask` next to `bestWeights` (line 195); before the step loop (lines 230-234) the first Dense kernel
    `[518, n]` is located and, with `fixFreezePose`, a `[518, n]` mask (ones for rows 0-511, zeros for rows 512-517: the
    head-vector and face-origin inputs) is built; each step then runs `tf.variableGrads` on the unchanged loss, multiplies
    that kernel's gradient by the mask and calls `opt.applyGradients` (exactly `analysis/rerun_head.mjs`'s offline path);
    with the flag off the shipped `opt.minimize(...)` call runs unchanged. The mask is disposed in the `finally` (line 272).

### `vendor/webeyetrack/worker.ts`

11. `init` reads `payload.fixes.matrixLayout` / `payload.fixes.freezePose` (`=== true`) into the tracker flags before
    `initialize()`, and the init response (line 37) gains `fixes: { matrixLayout, freezePose }`, `limits` and `blend` so a caller can assert what is on.

## Quick-calibration test options behind `init` (2026-11-07, after the offline calibration budget run)

The Q8 quick calibration (8 cell-centre dots, ~1 s of frames each) needs the copied engine to accept more than 42 labels, to
train on 8 distinct targets, and to keep the geometric branch from dominating the blend. All three live behind `init`
options whose absence means the shipped constants, so `npm run test:parity` still proves the default worker shipped-identical;
`npx vitest run tests/engine-limits.test.ts` proves each option.

### `src/core/worker-engine.ts`

12. `EngineLimits`, `SHIPPED_LIMITS = { maxSamples: 42, minSamples: 27, minTargets: 9 }` and `readLimits()` (lines 42-51: positive
    integers per field, anything else the shipped value, `maxSamples ≥ minSamples`). Fields `limits` (line 86, a copy of
    `SHIPPED_LIMITS`) and `geometricShareMax` (line 88, `boundWeight(1)` = the shipped `weightRange` top, 0.85); setters
    `setLimits()` (line 99, refused once a label is collected) and `setGeometricShareMax()` (line 101, bounded by `boundWeight`,
    invalid = shipped top).
13. `collect()` compares against `this.limits.maxSamples` instead of the literal 42 (line 144); `train()` against
    `this.limits.minSamples` / `minTargets` instead of 27 / 9 (line 155; the error text names the configured target count,
    the shipped text when it is 9).
14. `fitGeometric()` caps the trained weight at `geometricShareMax` (line 171) and `setBlend()` caps the measured one the same way
    (line 182). With the default cap (0.85) both are the shipped `blendWeight` / `boundWeight` results.

### `vendor/webeyetrack/worker.ts`

15. `init` passes `payload.limits` to `engine.setLimits()` and `payload.blend.geometricShareMax` to `engine.setGeometricShareMax()`
    (lines 33-36) and reports both in the init response (line 37, see 11).

## Generated / kept artefacts

- `public/vendor/webeyetrack/worker.shipped.js`: byte copy of the shipped `worker.js` (hash in `SOURCE.json`).
- `public/vendor/webeyetrack/worker.js`, `.map`, `.LEGAL.txt`, `BUILD.json`: rebuilt from the adapted sources.

## Parity

`npm run test:parity` feeds the same frames to `worker.shipped.js` and the debug `worker.js` (init `{debug:true}`), through
30 frames, 42 collected labels, training, and 30 more frames, and requires identical `rawNormPog`, `estimates`, `normPog`,
`pose`, `camera`, `eyeState`, `facePresent` (and identical training reports). Result in `evidence/parity.json`.

## Calibration reproduction (not a source change, but a faithfulness note)

gaze-lab drives the copied `CalibrationRun` state machine directly (pace `quick`: 700 ms move, 1000 ms settle, 400 ms
between labels, 3 labels per dot, 9 eye dots then 5 head dots, 3 s reading intro per stage) and the copied worker's
`collect`/`train` with the shipped defaults. Differences from `App.tsx`:

- Start retries automatically until the readiness gate opens (the app shows "Face not detected" and waits for another click; gaze-lab shows it only after 1.5 s of waiting).
- No saved-calibration offer, profiles, settings, team model, or pose-normalized crop (all off/absent in the app's default path too).
- A viewport resize during calibration is not detected (the app restarts calibration). Keep the window still.
- The app pauses on blur; gaze-lab pauses on `visibilitychange` and Esc only.
