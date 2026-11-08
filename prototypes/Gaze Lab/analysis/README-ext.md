# Analysis extensions

Four scripts next to `analyze.py`, each run on a session folder as the harness writes it. Frame filter everywhere, as in
`analyze.py`: record-phase frames with a face present and eyes open, final attempt per block; px = CSS pixels of the
recorded viewport. All Python runs with `-I`; the scripts import `analyze.py`'s loader, so they stay on its conventions.

```sh
.venv/bin/python -I analysis/rows.py sessions/<id>            # → rows.md, rows.json, rows.png
.venv/bin/python -I analysis/headvector.py sessions/<id>      # → headvector.md, headvector.json
.venv/bin/python -I analysis/measurements.py sessions/<id>    # → measurements.md, measurements.json
.venv/bin/python -I analysis/quick.py sessions/<id>           # → quick.md, quick.json, quick.png (quick-calibration sessions only)
.venv/bin/python -I analysis/quadrants.py sessions/<id>       # → quadrants.md, quadrants.json, quadrants.png (simple-mode sessions, the default at /)
node analysis/rerun_head.mjs sessions/<id> [--out dir]        # → rerun_head.md, rerun_head.json, rerun_head_calibration.json
node analysis/rerun_head.mjs sessions/<id> --export "recorded · pose frozen · l2 0"   # + candidate-recorded-pose-frozen-l2-0.json (repeatable; recorded-head variants only)
.venv/bin/python -I -m unittest discover -s analysis/tests -p "test_*.py"   # pure parts: tracker, LDA, head-vector port, layout
```

Run `rerun_head.mjs` before `rows.py` when you can: it writes `rerun_head_calibration.json` (the shipped trained network on
the calibration strips), which `rows.py` picks up to derive the network and blend personal boundaries from the calibration
labels; without it those two fall back to the B1 frames and are marked `(B1)`.

- **rows.py** · two-row decision (rows at 25 %/75 %, 10 %/90 % dots count as top/bottom) per block and stream
  (network, geometric, blend = rawNormPog, pointer): fixed midline boundary; personal boundaries from the calibration
  labels (midpoint, 1-D LDA, 1-D logistic); an online tracker (2-means over the last 20 s, dead zone ±10 % of the row
  separation, 400 ms median, causal across blocks) with per-block accuracy and recovery time (trailing 2 s accuracy > 90 %);
  d′ and the near-boundary wrong-row rate; 4-column accuracy within the correctly decided row (fixed and
  calibration-mapped column boundaries). `rows.py score-fixed <session> <json>` scores an external stream (used by rerun_head).
- **headvector.py** · proves `faceRt` is column-major (translation at indices 12-14), ports `translateMatrix → matrixToEuler
  → pyrToVector → getHeadVector` and shows the recorded `headVector` is the row-major read (so it is the rotation's third
  row: yaw and pitch sign-flipped versus the forward axis); correlates both readings with `pose.yawRatio/pitchRatio` and the
  geometric forward axis over B8-B11 (or all blocks when absent); one-line verdict.
- **measurements.py** · M1 bias vs noise per axis/block/estimator (px, cm); M2 translation slope of the geometric branch
  (signed error on faceOrigin3D x/z, y/z; 95 % CI, R²); M3 iris attenuation on B1 (iris y and upper lid vs dot y and face
  pitch, versus the 0.37 px/° rigid-sphere prediction using the eye width from `landmarks.f32`); learning-gate proxy
  (fraction of frames within `HEAD_LIMITS` of the calibration pose, `head-position.ts` ported).
- **rerun_head.mjs** · headless Chromium (WebGL, as the harness) on a port from 4335-4338: encodes every eye strip once with
  the frozen encoder, checks fidelity (F1 pretrained head vs the recorded pre-training network, F2 the learned head +
  affine vs the recorded network, F3 a full `adapt()` re-run vs the shipped head and training report), then re-trains the
  head for head vector {recorded, column-major} × pose columns {trainable, frozen (kernel rows 512-517)} × l2 {0, 1e-3}
  plus affine-only rows, scoring each per block (median px, |dx|, |dy|, bias, p90, fixed-boundary row accuracy).
  `--export "<variant>"` writes that variant as a `GAZE-LAB-CANDIDATE-1` file whose `head` is the saved-calibration layout
  (six tensors + affine, `faceWidthCm`/`geometric` from `calibration.json`), loadable in Setup → Candidate and by
  `scripts/e2e.mjs --candidate`; the file records the export fidelity (exported weights vs the variant's predictions). Column-major
  variants are refused: the shipped worker computes the head vector itself.

Calibration labels: `frames.jsonl` logs the *next* dot on the third accepted label of each dot (12 of 42 rows); the scripts
take the labels from `eyestrips/replay.json` or correct them by the three-labels-per-dot rule, and say which in their output.

## Video replay of the fixes (2026-11-07, `scripts/replay-blocks.mjs`, `analysis/replay-compare.py`)

```sh
node scripts/replay-blocks.mjs sessions/<id> --fixes none|layout|freeze|both [--port 4335-4338]   # → replay-<fixes>.{jsonl,json,md}, replay-align.json
.venv/bin/python -I analysis/replay-fidelity.py sessions/<id> [none]     # → replay-fidelity-<v>.{md,json}: replay vs live per block/dot/frame
.venv/bin/python -I analysis/replay-compare.py sessions/<id>             # → replay-compare.{md,json,png}: paired per-dot Δ vs none, 5000-resample bootstrap
node scripts/replay-strips.mjs sessions/<id>                             # → replay-strips.{md,json}: re-decoded vs live eye strips on the 42 label frames
```

- **replay-blocks.mjs** · decodes `video.webm` with WebCodecs in headless Chromium (SwiftShader WebGL) and steps, for every live
  `frames.jsonl` row, the decoded frame nearest to `videoT` + a clock offset (40 ms limit) through the gaze-lab worker with the
  fixes from `init {fixes}`; the 42 `.clarte-session` labels are collected on their recorded frames, `train` runs at the recorded
  moment, every block is scored with analyze.py's statistics plus per-dot medians, 4×2 cells and rows. The offset is measured once
  per session (60 sampled rows, five frames each, best landmark match against `landmarks.f32`) and reused by every variant, so all
  variants step identical frames. Fidelity vs the live run is in the `none` report; `replay-fidelity.py` details it per block.
- **replay-compare.py** · per block and pooled (all blocks; translation B2/B3/B5/B6/B7, pitch B10/B11/B13, yaw B8/B9, neutral B1/B12,
  B4 alone): mean paired per-dot difference of each variant vs `none` with a 95 % bootstrap interval over dots, for blend, network
  and geometric (control); checks that the variants stepped identical frames; one PNG per session.

## Calibration budget (2026-11-07, `analysis/budget.py` + `analysis/budget.mjs`)

```sh
.venv/bin/python -I analysis/budget.py sessions/<id> [--no-network] [--rerun-network] [--port 4334]   # → budget.{md,json,png}, budget_designs.json, budget_network.json
```

- **budget.py** · simulated short calibrations drawn from B1's record frames (8 cell centres × first w s of the 1.6 s window, w ∈ {0.3, 0.6, 1.0, 1.6}; 4, 6 and 16-dot variants; a 0.3–1.3 s onset probe) against the shipped `C0` (42 labels) and `C0-eyes` (27). Shipped geometric fit ported (verified 1e-9 px vs the worker's stream), leave-one-dot-out MSE, blend weights by the shipped inverse-MSE rule (scalar and per axis), per-dot median scoring on every block but B1 (cell-centre dots and all 16; neutral vs pose), paired Δ vs C0 with a 5000-resample bootstrap over dots, modelled cost 2 s + dots × (0.4 s + w) + training, one PNG. Notes that B1 gave the eyes 0.9 s before its window (optimistic for a 0.4 s design) and that the validation dot animates 600 ms (no `+onset` variants).
- **budget.mjs** · the network side on port 4334 only: encodes the strips once, then `rerun_head.mjs`'s `adapt()` reproduction per design × {shipped, pose frozen} plus leave-one-dot-out re-trainings, predictions on every usable record strip; F1 fidelity and the C0 re-train vs `rerun_head.md` are reported by budget.py. Only sessions with `eyestrips/replay.json`.

## Quick-calibration test (2026-11-07, `analysis/quick.py`)

- **quick.py** · for sessions recorded with Setup → Quick calibration test (`?quick=1`): per block and pooled (all 16 dots; the 8
  cell-centre dots where Q8 was trained), per-dot median error, 4×2 cell / row / column hit rates for `quick blend`
  (`quick.rawNormPog`, the Q8 head blended at the capped share), `quick network`, shipped `blend` (`rawNormPog`, C0) and shipped
  `network` (geometric branches listed as extra rows); paired per-dot differences quick − shipped for blend and network with a
  5000-resample bootstrap over dots (seed 7, mean); both calibration wall times (Q8 intro → trained; C0 start → trained, with the
  key-press wait before the head stage split out), label counts per Q8 dot and the collection-window span; one PNG. It states that
  Q8 ran first and that the C0 baseline has no freezePose fix, so a Q8 gain mixes design and freeze (budget.py separates them).

## Quadrant test (2026-11-07, `analysis/quadrants.py`, simple mode at `/`)

- **quadrants.py** · for sessions recorded in the default flow (`session.json` `mode: simple`): per trial (final attempt; record-phase frames with a
  face present and eyes open) the per-axis median estimate of `candidate blend` (`quick.rawNormPog`, the shadow worker with the pose rows frozen and
  the geometric share capped), `candidate network`, `baseline blend` (`rawNormPog`, the primary worker trained on the same Q8 frames with the shipped
  rule) and `baseline network`, decided onto the app's 4×2 navigation rectangles (a point in a gap or margin selects the nearest rectangle, as the
  app does); hit / row / column rate overall and per quadrant; paired candidate − baseline hit per trial with a 5000-resample bootstrap over
  trials (seed 7); a two-row variant (top/bottom by the midpoint of the mean estimated y over the top- and bottom-row Q8 label frames of the same
  stream, which is the pretrained head's estimate since both workers were untrained then; a test-frame boundary is listed as an optimistic
  reference; a fixed midline as control) combined with the decided column; hit rate per bin of median head displacement from the calibration pose
  (median `faceOrigin3D` over the Q8 label frames); a per-trial table that also lists what the app showed live. `quadrants.png` is the 2×4 hit-rate
  heatmap for the candidate and the baseline blend. The offline candidate-blend decision equals the app's recorded decision on every trial
  (`scripts/e2e-simple.mjs` checks this).
