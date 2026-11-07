# Accuracy log

Measured results on recorded data, newest first. Every row is one person and one session unless stated; treat single-person results as provisional. Pixels are CSS pixels on the recorded viewport.

## 2026-11-07 · Abdel and Mukhtar · full test sessions replayed (`npm run test:sessions`), viewport 1512×789, camera 1280×720

Same recordings, same labels, same check frames; only the tracker build changes. "Before" is the network with real training (200 steps @3e-3); "now" blends it with the geometric estimator, weight from held-out errors at calibration. "Best blend" is what the check itself picks and applies to navigation.

| Session | Live check (affine-only build) | Network with training | Blend as shipped | Network alone / geometric alone on the check | Best blend on the check |
|---|---|---|---|---|---|
| Abdel #2 | 103 px | 113 px median, 176 px 90th | **84 px median, 134 px 90th** | 113 / 112 px | 81 px at 45% geometric |
| Mukhtar #1 | 140 px | 79 px median, 147 px 90th | **71 px median, 139 px 90th** | 79 / 102 px | 68 px at 35% geometric |

Pose-normalized eye crop (`--normalize`, development option): network 140 / 87 px, blend 101 / 75 px (Abdel / Mukhtar). Worse on both, as expected for a network that was never trained on frontalized strips; the geometric estimator is unaffected (same landmarks). Stays off until an encoder or head is trained on normalized replay sets from several people.

Both people improve, Abdel by a quarter: the two estimators err differently, so even a geometric estimate no better than the network's (Abdel) halves part of the error when averaged. Corners: 83 px (Abdel) and 91 px (Mukhtar). Heads were still during these checks; the geometric model's expected advantage under head movement is still unmeasured.

## 2026-11-07 · Mukhtar · same replay set · geometric estimator from landmarks

A second estimator that never looks at pixels: for each eye the iris centre and the upper and lower lid heights relative to the eye-corner line (in eye widths), plus depth, head yaw and pitch; one ridge regression per person from the 42 calibration labels (`src/core/geometric-gaze.ts`). Eye width in this recording: 62 px. Per-frame iris jitter about 0.4 px, i.e. about 3% of the screen width per frame.

| Features (all depth-scaled, per person) | Fit px | Leave-one-dot-out px (median / 90th) | Check median px | Check 90th px |
|---|---|---|---|---|
| Both eyes averaged: iris only + depth + head rotation | 172 | 292 / 487 | 220 | 322 |
| Per eye: iris (8 features) | 148 | 214 / 348 | 181 | 324 |
| **Per eye: iris + upper and lower lid (12 features, shipped)** | **79** | **138 / 205** | **115** | **198** |
| Network as recorded (affine-only calibration, same frames) | — | — | 140 | 277 |

The eyelids carry the vertical signal: across the 13 dots the iris moves 2.8 px vertically but the upper lid 10 px. Averaging the two eyes loses the better-tracked eye. Shrinking the head-rotation terms harder than the rest (an "adaptive" ridge) only hurt. Blending with the recorded network: every weight from 0.2 to 1.0 beat the network alone (0.5 → 122 px; 1.0 → 115 px). Shipped: the blend weight starts from the held-out errors of both estimators and the free-flow check then picks the weight with the lowest median error, bounded to at most 85% geometric.

Open: the network with real training (above) scores 85 px on this person, so the blend's benefit against it is to be measured on the test sessions; head movement during the check is where the geometric model should pay off and is unmeasured.

## 2026-11-07 · Mukhtar · replay set (eye strips), viewport 1512×789, camera 1280×720, 63 cm

Calibration: 13 dots, 42 labels. Check: 10 references, 333 frames. Live check with the affine-only tracker: 140 px median, 277 px 90th percentile. The replay harness reproduces this (142 px), so replays are trustworthy for this pipeline.

Production `adapt()` on the recorded frames (held-out early stopping on, one sample per dot), scored on the check frames. "Correct cell" is the share of check frames landing in the same 4×2 navigation cell as the target.

| Calibration training | Median px | 90th px | Correct cell |
|---|---|---|---|
| Pretrained head, no correction | 343 | 549 | 26% |
| Affine only (previous production) | 141 | 307 | 39% |
| 60 steps @1e-3, L2 1e-2 (first shipped defaults) | 139 | 276 | 53% |
| 100 steps @3e-3 | 90 | 190 | 84% |
| **200 steps @3e-3 (new defaults)** | **85** | **162** | **86%** |
| 300 steps @1e-2, L2 1e-3 | 95 | 179 | 86% |

Sweep notes (dev/replay.html, 29 variants): any L2 pull toward the pretrained weights hurt on this person; learning rate 1e-2 reached 79 px / 89% at 100 steps but overfit by 400 steps (fit 33 px, check 108 px); thin-plate overfit with 13 dots (fit 53 px, leave-one-dot-out 335 px); robust affine equalled plain affine (no spoiled dots). The per-dot held-out loss kept falling through 200 steps, so early stopping never triggered here; it remains as divergence protection.

Pretrained-head behaviour worth knowing: vertical range is strongly compressed (labels at y=88 predict y≈240; y=701 predict ≈770), which is why the affine alone helps and why the top and bottom of the screen showed opposite offsets live.

Open: validate the defaults on the other testers; measure head movement with full test sessions.
