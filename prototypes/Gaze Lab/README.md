# Gaze Lab

A local test harness for the shipped Clarte eye-tracking pipeline. One person calibrates once at a neutral pose, then
looks at validation dots in blocks at shifted head / body / camera positions, while every frame's estimates, landmarks,
head vector, face origin, geometric features and eye strips are written to disk together with the raw webcam video.
`analysis/analyze.py` then computes per-axis error per block, tries alternative calibration models offline, and writes a
`candidate.json` that the app can re-test prospectively next to the shipped stream.

Everything stays on `127.0.0.1`. The worker, model and wasm are the shipped ones, copied from `prototypes/Eye Tracking` at
`b7b8f98` (`SOURCE.json`); the worker build adds only a debug payload (`ADAPTATIONS.md`), verified identical to the shipped
bundle by `npm run test:parity`. Gaze Lab is not a `clarte` app; run it with npm as below.

Recordings never leave the machine: `sessions/` (webcam video, face landmarks, eye images) and `evidence/` (test output)
are git-ignored, and so is the generated `fixtures/face.y4m`.

## Install and build

```sh
cd "prototypes/Gaze Lab"
npm ci                      # vite, esbuild, vitest, playwright 1.64.1, tfjs, mediapipe (same pins as Clarte)
npx playwright install chromium   # only for the tests and the fixture
python3 -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt   # only for analysis/
npm run build               # debug worker + typecheck + vite build → dist/
npm run start               # http://127.0.0.1:4330
node scripts/copy-source.mjs && node scripts/apply-adaptations.mjs   # only to re-copy from ../Eye Tracking (or --repo=<checkout>)
```

## Run a session (the default flow)

```sh
npm run start               # http://127.0.0.1:4330
```

Open **http://127.0.0.1:4330/** in Chrome (camera permission for 127.0.0.1; turn off macOS Center Stage and video effects) and press **Start**.

1. *Calibration (about 20 s plus training).* "Look at each dot until its ring closes; keep your head still." Eight dots, one per quadrant.
2. *Free look.* No dot: look wherever you like. The quadrant you look at turns blue and fills over 2 s; a 2 s look selects it (green border for 0.4 s). One long look selects once; look away and back to select it again. **Esc** or a click pauses (Continue / Dwell / Finish). With **Dwell** off (or `?dwell=0` from the start) the blue quadrant is the one the tracker picks right now, with no hold, no fill and no selections.
3. *Result.* Selections per quadrant and the calibration time. **Again** runs another session.

The dwell rules (`DWELL_TIMING` and `Dwell` in `src/lab/simple.ts`) follow Clarte's UI v0 gaze engine: 150 ms hold, 300 ms re-arm, no auto-repeat, and no grace window (with a 150 ms hold on the way back it could never forgive a glance).

`?test=guided` runs the measured test instead: 24 trials (about 70 s), "Look at the dot in the light-blue quadrant. Green border = recognised, red = it picked that other quadrant." **Esc** pauses (Continue / Redo trial / Finish); the result shows hits per quadrant and the overall percentage.

Everything is recorded to `sessions/<timestamp>-<tester>/`; `?tester=Name&diag=14.2` set the name and screen diagonal in inches, and for the guided test `rounds=3&feedback=0` set the rounds (× 8 trials) and the feedback borders.
Then `.venv/bin/python -I analysis/quadrants.py sessions/<id>` → `quadrants.md` / `.json`: for free look, the selections (quadrant, dwell, head displacement, what each stream would have chosen) and where the blue mark sat; for the guided test also `quadrants.png` (hit rate per quadrant for the candidate and the baseline, paired difference, two-row variant, head displacement).

Checks: `npm run test:e2e:free` (real worker on the photo camera; plumbing only, since a still photo lands where four quadrants meet after calibration and cannot dwell), `node scripts/e2e-free-demo.mjs` (pointer-driven demo tracker: dwell timing, latch, re-arm, glances), `npm run test:e2e:simple` (the guided test).

Under the hood: the quick Q8 calibration trains two models on the same frames, the **candidate** (shadow worker: `freezePose`, limits 200/24/8, geometric share ≤ 0.2) and the **baseline** (primary worker: the same limits, shipped training and blend rule); the blue mark, the selections, the feedback and the result follow the candidate; `frames.jsonl` carries both. The `.clarte-session` file is not written in this mode.

## Research mode

The full harness (setup form, shipped calibration, 13 head/body/camera blocks, candidate re-test, paired quick test) is unchanged at **`?mode=research`**.


Open **http://127.0.0.1:4330/?mode=research** in Chrome. Sessions land in `gaze-lab/sessions/<ISO-timestamp>-<tester>/`.

Keyboard: **Space / Enter** = the primary action on every screen · **Esc** = pause · on a paused block **R** = redo the
block, **S** = skip it, or use the buttons (Continue, Redo block, Skip block, Finish).

### Tester script (about 10 minutes with all 13 blocks)

Say roughly this:

1. *Setup.* "Type your name and the screen diagonal in inches (the Mac model's spec, e.g. 14.2). Leave video and eye strips on. Press Full screen, sit as you normally would, check the line under the form says `face · eyes open` and that moving left makes the head `x` number grow (that confirms the sign convention), then press Begin."
2. *Calibration (same as the app, ~45 s).* "Press Space. Look at each dot until it moves; keep your head still. When it says *Calibrate head movement*, press Space again and follow the dot with your head as well as your eyes. Then it trains for a few seconds."
3. *Blocks (16 dots each, 40 s).* Each block shows one title, one instruction, and a live line with your head offset from the calibration pose in cm and degrees. "Move as the instruction says, use the line to hit about the right amount, then press Space and look at each dot until the ring closes. Blink normally. Esc pauses."
   B1 neutral · B2 left 10 cm · B3 right · B4 up 8 cm · B5 down · B6 closer 10 cm · B7 farther · B8 turn left 15° · B9 turn right · B10 chin up 10° · B11 chin down · B12 return to normal · B13 tilt the lid back 5° then sit normally.
4. *Results.* A table per block appears and everything is already saved.

Blocks can be chosen in Setup (or `?blocks=B1,B2`); `?tester=Name&diag=14.2` prefill the fields (all on top of `?mode=research`).
`?demo=1` runs the whole flow on a synthetic estimate stream without a camera (labelled "Demo · no camera").

### Candidate re-test

Setup → **Candidate**: load a `candidate.json` written by the analysis (or hand-written in the same schema:
`geometric` feature names + 2×k weights, per-axis `blend`, an `affine`/`quadratic` screen `correction`, and/or a
replacement `head` in the saved-calibration format). The candidate is evaluated on every frame from the same inputs as
the shipped stream (a `head` runs in a second worker through `restoreCalibration`) and appears as a `candidate` row in
the summary and in `frames.jsonl`.

### Quick calibration test (Q8 vs the shipped calibration, one session)

Setup → **Quick calibration test** (or `?quick=1`). The session then runs an ~18 s calibration first, in a second worker
(`init {fixes:{freezePose:true}, limits:{maxSamples:200,minSamples:24,minTargets:8}, blend:{geometricShareMax:.2}}`), then
the shipped ~50 s one in the primary worker, and every block frame goes through both. Q8 runs first so any recency
advantage goes to the shipped calibration. The candidate head is not run alongside (one shadow worker). Open:

```
http://127.0.0.1:4330/?mode=research&quick=1&tester=Name&diag=14.2&blocks=B1,B2,B3,B6,B10,B12
```

Tester script (about 6 minutes):

1. *Setup.* "Name, screen diagonal, Full screen, sit normally, check `face · eyes open`, then Begin."
2. *Quick calibration (18 s, starts at once).* "It says *Look at each dot* for two seconds, then eight dots: just look at each one until the ring closes. Keep your head still."
3. *Shipped calibration (~50 s).* "Now the normal one: Space, look at each dot until it moves; at *Calibrate head movement* Space again and follow the dot with your head too."
4. *Blocks (6 × 40 s).* "Each screen says how to move; use the live line for the amount, Space, look at each dot until the ring closes. Esc pauses." B1 neutral · B2 left · B3 right · B6 closer · B10 chin up · B12 return.
5. *Results.* "The tables have `quick blend` / `quick network` rows next to the shipped ones, and one line with both calibration times."

Then `.venv/bin/python -I analysis/quick.py sessions/<id>` → `quick.md`, `quick.json`, `quick.png` (paired per-dot differences quick − shipped with bootstrap intervals, per block and pooled; both wall times).

## What lands in `sessions/<id>/`

| file | content |
|---|---|
| `session.json` | tester, screen (diagonal, dpr, cm per CSS px), viewport, window position/size per block, camera geometry, source commit and worker hashes, settings, block list with instructions, measured head shift per block, training report, geometric fit, blend weight |
| `frames.jsonl` | one row per processed frame: `t` (performance.now), `videoT` (ms on the video clock), screen/block/point/phase, target (px and normalized), `rawNormPog` (shipped blend), `network`, `geometric`, `normPog`, `pointer` (One Euro px), `pose`, `headVector`, `faceOrigin3D`, `faceRt`, `features12`, `gaze` (GazeFeatures), `eyeState`, `facePresent`, `camera` motion, timings, `landmarkRow`, `candidate` |
| `landmarks.f32` | 478×3 float32 per `landmarkRow` |
| `video.webm` | MediaRecorder VP9 at 5 Mbps, the whole session |
| `<id>.clarte-session` | `CLARTE-SESSION-1` file (calibration + B1 events and dots, the full video) for the teammate's `npm run test:sessions` |
| `eyestrips/*.png`, `eyestrips/replay.json` | the worker's 512×128 eye strips for labelled calibration frames and record-phase block frames, with block/point in the side table |
| `calibration.json` | the learned head (six tensors), affine and face width exported after training, usable with `restoreCalibration` |
| `quick-calibration.json` | quick sessions only: the Q8 shadow worker's learned head in the same format, plus its training report and worker options |
| `summary.json` | the on-screen summary |
| simple mode (`/`) | the same files, no `.clarte-session`; `session.json` has `mode: simple`, the 8 `quadrants` (rects and centres), `rounds` (seed and order), `trials` (target, attempts, the live `shown` decision and the final `decision` per stream), the two-model `calibration` block and the `result`; `frames.jsonl` rows carry `quick` (candidate) and `trial` |

Block ids in `frames.jsonl` are `B3` for the first attempt and `B3#2` for a redo; `session.json` lists which attempt is kept.

Quick sessions add, and only they add (default sessions are byte-for-byte as before): a `quick` object on every `frames.jsonl`
row (`rawNormPog` = the Q8 blend at the capped share, `network`, `geometric`, from the shadow worker), `Q8` rows for the quick
calibration itself (`screen` `quick`, phases `intro`/`move`/`wait`/`collect`, `quick:label` on accepted labels), a `quick`
block in `session.json` and `summary.json` (worker options and the flags the worker echoed, the 8 targets, Q8 start/trained
times and wall time, labels, pauses, training report, and `c0` with the shipped calibration's start/trained times, wall time
and how long it waited for the key press before the head stage), `settings.quick`, and `quickBlend`/`quickNetwork` summaries.

## Analysis

```sh
.venv/bin/python -I analysis/analyze.py sessions/<id>
```

Writes into the session folder: `report.md` (per-block table with per-axis medians, biases, p90 and the measured head
shift; offline refits; what was not done), `scatter_x.png` / `scatter_y.png` (predicted vs true per axis per block for
network, geometric, blend), `quiver.png` (offset map), `error_vs_shift.png` (per-axis error vs measured head shift),
`candidate.json` (best variant in the app's schema), `analysis.json` (the numbers). Every table states its units and
the frame filter: record-phase frames with a face present and eyes open, final attempt per block.

Refits: geometric ridge variants trained on the calibration labels (shipped 12 features; + perspective `origin.x/z`,
`origin.y/z`; + openness; without lids; other ridge strengths per axis), evaluated on every block with a sanity row
comparing the shipped-12 refit to the worker's own geometric estimate; per-axis blend weights and affine / quadratic
screen corrections fitted on B1 and leave-one-block-out; and the geometric ridge trained on calibration + the other
blocks' frames (simulated pose-diverse calibration), leave-one-block-out. Retraining the network head from the eye
strips is not implemented here (the strips, labels and `calibration.json` are there for it).

## Verify

```sh
npm test                    # vitest: protocol, layout, head math, frame batching, summary, candidate, engine debug mode, server + .clarte-session round trip
npm run test:parity         # shipped vs debug worker on identical frames → evidence/parity.json
npm run fixture             # rebuilds fixtures/face.y4m (synthetic camera: a face photo from the vendored WebEyeTrack docs)
npm run test:e2e            # real worker + fake camera through calibration and two blocks, files checked, analysis run → evidence/e2e/
npm run test:e2e:simple     # the guided test: Start → Q8 (both models) → 8 dot trials → result, files checked, quadrants.py run → evidence/e2e-simple/
npm run test:e2e:free       # free look on the real worker: screen, pauses, Dwell switch and recording (the photo cannot dwell) → evidence/e2e-free/
node scripts/e2e-free-demo.mjs   # free look driven by the pointer: 2 s dwell timing, latch, re-arm, glances, Dwell off → evidence/e2e-free-demo/
npx vitest run tests/simple.test.ts   # quadrant geometry, nearest-quadrant decision (gaps and margins), trial scheduler, rounds
node scripts/e2e.mjs --blocks=B1 --candidate=sessions/<id>/candidate.json --head=sessions/<id>/calibration.json   # prospective candidate re-test incl. the shadow-worker head path
node scripts/e2e.mjs --quick --blocks=B1   # quick-calibration test: Q8 → C0 → B1, shadow worker trains on 8 targets with > 42 samples, quick stream in frames.jsonl, quick.py → evidence/e2e-quick/
npx vitest run tests/engine-limits.test.ts tests/quick.test.ts   # the worker options (cap, 8-target training, blend cap) and the Q8 timing/order
node scripts/replay-check.mjs [sessions/<id>/<id>.clarte-session]   # replays the file through the Clarte test-session runner (dev/session.html, copied unchanged) → evidence/replay/
node scripts/check-source.mjs   # copied files unchanged except the listed adaptations
```

The synthetic camera proves plumbing only: a photo cannot move its eyes, so nothing measured on it says anything about
gaze accuracy.

## Fixed after the first real session (2026-11-07)

Builds before 13:00 annotated the third accepted label of each calibration dot with the *next* dot's target in `frames.jsonl` (the logger read the calibration state after `capture` had advanced it; 12 of 42 rows). The worker always received the right label (`eyestrips/replay.json` holds it), so training and the `.clarte-session` file were unaffected. The app now records the label's own dot, and `analysis/analyze.py` rewrites the logged target from `replay.json` for sessions recorded with the old build (falling back to the three-labels-per-dot rule) and reports how many rows it corrected.

## Conventions and caveats

- Head offset: `faceOrigin3D` is the tracker's eye midpoint in camera space (cm): +x image right (your left on an
  unmirrored webcam), +y image down, +z farther. Yaw/pitch come from the face matrix forward axis (+yaw = turned to your
  left, +pitch = chin up). Check the sign on the Setup readout before trusting the words.
- `blend` = the worker's `rawNormPog` (network blended with the geometric estimate at the shipped weight);
  `normPog` = the worker's clipped blend, or the Kalman-filtered network when no geometric fit exists;
  `pointer` = the One Euro-filtered cursor the app shows.
- Ports: the server uses 4330; the e2e tests use 4331 (guided), 4333 (pointer demo) and 4334 (free look); `npm run dev`
  uses 4332; video replays 4335–4338; the smoke test 4339.
