"""Reproduce bounded local adaptations from pristine pinned WebEyeTrack source."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parents[1]
up = root / 'vendor/webeyetrack/js/src'
out = root / 'vendor/webeyetrack/local'
shutil.copytree(up, out, dirs_exist_ok=True)
(out / 'FaceLandmarkerClient.ts').write_text('''import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
export default class FaceLandmarkerClient {
  private faceLandmarker: FaceLandmarker | null = null;
  async initialize() {
    const files = await FilesetResolver.forVisionTasks('/vendor/webeyetrack/vision/wasm');
    this.faceLandmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/vendor/webeyetrack/vision/face_landmarker.task', delegate: 'CPU' },
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      runningMode: 'IMAGE', numFaces: 1,
    });
  }
  async processFrame(frame: ImageData): Promise<FaceLandmarkerResult | null> {
    return this.faceLandmarker?.detect(frame) ?? null;
  }
  dispose() { this.faceLandmarker?.close(); this.faceLandmarker = null; }
}
''')
p = out / 'BlazeGaze.ts'
s = p.read_text().replace("console.log('✅ BlazeGaze model loaded successfully');", '')
s = s.replace('    predict(image:', '''    dispose(): void { this.model?.dispose(); this.model = null; }

    trainableVariables(): tf.Variable[] {
        if (!this.model) throw new Error('Model is not loaded');
        return this.model.trainableWeights.map(weight => {
            const tensor = weight.read();
            if (!(tensor instanceof tf.Variable)) throw new Error('Expected a trainable TFJS variable');
            return tensor;
        });
    }

    /** The frozen image encoder and the trainable gaze head, as nested models sharing this model's weights. */
    encoder(): tf.LayersModel {
        if (!this.model) throw new Error('Model is not loaded');
        return this.model.getLayer('cnn_encoder') as unknown as tf.LayersModel;
    }

    head(): tf.LayersModel {
        if (!this.model) throw new Error('Model is not loaded');
        return this.model.getLayer('gaze_mlp') as unknown as tf.LayersModel;
    }

    exportEstimator(): number[][] {
        return this.trainableVariables().map(weight => Array.from(weight.dataSync()));
    }

    restoreEstimator(weights: number[][]): void {
        const variables = this.trainableVariables();
        if (weights.length !== variables.length || weights.some((values, i) => values.length !== variables[i].size || !values.every(Number.isFinite))) throw new Error('Invalid estimator weights');
        tf.tidy(() => variables.forEach((variable, i) => variable.assign(tf.tensor(weights[i], variable.shape))));
    }

    predict(image:''')
p.write_text(s)
p = out / 'utils/mathUtils.ts'
s = p.read_text().replace('solve(X, Y);', 'solve(X, Y, true);')
# Optional pre-warp: a homography applied to the frame before the face crop (pose normalization), composed so the frame is warped once.
s = s.replace('''    dstImgSize: [number, number] = [512, 128]
): ImageData {''', '''    dstImgSize: [number, number] = [512, 128],
    prewarp?: number[][]
): ImageData {''')
s = s.replace('''    // Step 5: Warp the image
    const warped = warpImageData(frame, H, faceCropSize, faceCropSize);''', '''    // Step 5: Warp the image (through the pre-warp first, when the crop is taken from a pose-normalized view)
    const warped = warpImageData(frame, prewarp ? H.map(row => [0, 1, 2].map(c => row[0] * prewarp[0][c] + row[1] * prewarp[1][c] + row[2] * prewarp[2][c])) : H, faceCropSize, faceCropSize);''')
assert 'prewarp ? H.map' in s
p.write_text(s)
p = out / 'WebEyeTrack.ts'
s = p.read_text()
s = 'import { BilateralEyes } from \"../../../src/core/blink\";\nimport { readTrainingOptions, type TrainingOptions, type TrainingReport } from \"../../../src/core/training\";\nimport { applyHomography3, normalizeFaceRt, poseNormalization } from \"../../../src/core/pose-normalize\";\n' + s
s = s.replace('  private blazeGaze:', '  private readonly bilateralEyes = new BilateralEyes();\n  /** Take the eye strip and head vector from a pose-normalized view (virtual camera facing the eyes, no roll). Off by default. */\n  public normalizeCrop = false;\n  private blazeGaze:')
a = s.index('    // First, extract the eye patch')
b = s.index('    return [\n      eyePatch,', a)
s = s[:a] + '''    // First, extract the eye patch, from the pose-normalized view when enabled.
    const normalization = this.normalizeCrop ? poseNormalization(landmarks2d as [number, number][], result.facialTransformationMatrixes[0].data, width, height) : null;
    const eyePatch = normalization
      ? obtainEyePatch(frame, landmarks2d.map(p => applyHomography3(normalization.homography, p as [number, number])), [0.4, 0.2], 512, [512, 128], normalization.homography)
      : obtainEyePatch(frame, landmarks2d);

    // Second, compute the face origin in 3D space, always in the real camera: the point-of-regard mapping needs the real position.
    const face_origin_3d = this.computeFaceOrigin3D(
      frame,
      landmarks.map((l: NormalizedLandmark) => [l.x, l.y]),
      landmarks2d,
      faceRT
    )

    // Third, compute the head vector, relative to the normalized camera when normalizing.
    const head_vector = getHeadVector(
      normalization ? translateMatrix({ rows: 4, columns: 4, data: normalizeFaceRt(result.facialTransformationMatrixes[0].data, normalization.rotation) }) : faceRT
    );

''' + s[b:]
a = s.index('  public latestMouseClick:')
b = s.index('  async initialize(', a)
s = s[:a] + '''  public latestGazeResult: GazeResult | null = null;
  constructor() {
    this.blazeGaze = new BlazeGaze();
    this.faceLandmarkerClient = new FaceLandmarkerClient();
    this.kalmanFilter = new KalmanFilter2D();
  }

''' + s[b:]
a = s.index('  // Implementation for generating support samples')
b = s.index('\n}\n', a)
s = s[:a] + '''  return tf.tidy(() => ({
    supportX: {
      eyePatches: tf.stack(eyePatches.map(patch => tf.browser.fromPixels(patch)), 0).toFloat().div(255),
      headVectors: tf.tensor2d(headVectors, [headVectors.length, 3]),
      faceOrigins3D: tf.tensor2d(faceOrigins3D, [faceOrigins3D.length, 3])
    },
    supportY: tf.tensor2d(normPogs, [normPogs.length, 2])
  }));''' + s[b:]
a = s.index('  pruneCalibData()')
b = s.index('  computeFaceOrigin3D(', a)
# No implicit click training or permanent support tensors in this local core.
s = s[:a] + s[b:]
a = s.index('  async adapt(')
b = s.index('  async step(', a)
s = s[:a] + '''  /** Outcome of the last adapt(), for development reports. */
  public lastTraining: TrainingReport | null = null;

  async adapt(
    eyePatches: ImageData[], headVectors: number[][], faceOrigins3D: number[][],
    normPogs: number[][], options: Partial<TrainingOptions> = {}
  ): Promise<void> {
    if (eyePatches.length < 9 || eyePatches.length !== normPogs.length ||
        headVectors.length !== normPogs.length || faceOrigins3D.length !== normPogs.length) {
      throw new Error('Calibration requires at least nine paired observations');
    }
    const training = readTrainingOptions(options);
    const { supportX, supportY } = generateSupport(eyePatches, headVectors, faceOrigins3D, normPogs);
    const labels = normPogs.map(p => [p[0], p[1]]);
    const encoder = this.blazeGaze.encoder(), head = this.blazeGaze.head();
    // The encoder is frozen, so its features are computed once; only the small gaze head trains.
    const features = tf.tidy(() => encoder.predict(supportX.eyePatches) as tf.Tensor2D);
    const variables = this.blazeGaze.trainableVariables();
    const initial = variables.map(v => v.clone());
    let bestWeights: tf.Tensor[] = [];
    const opt = tf.train.adam(training.lr, 0.85, 0.9, 1e-8);
    const predictHead = (rows: number[] | null) => tf.tidy(() => {
      const pick = (t: tf.Tensor) => rows ? tf.gather(t, rows) : t;
      return head.predict([pick(features), pick(supportX.headVectors), pick(supportX.faceOrigins3D)]) as tf.Tensor2D;
    });
    const fitAffine = async (rows: number[] | null) => {
      const preds = predictHead(rows);
      try {
        const predicted = await preds.array() as number[][];
        const affine = computeAffineMatrixML(predicted, rows ? rows.map(i => labels[i]) : labels);
        if (!affine.flat().every(Number.isFinite)) throw new Error('Calibration produced a nonfinite transform');
        return affine;
      } finally { preds.dispose(); }
    };
    try {
      // One sample per dot is held out: training keeps the best held-out weights and stops when they
      // stop improving, so it cannot end worse than the pretrained head.
      const groups = new Map<string, number[]>();
      labels.forEach((l, i) => { const k = l.join(','); groups.set(k, [...(groups.get(k) ?? []), i]); });
      const holdout = training.holdout && training.steps > 0 && groups.size >= 6 && [...groups.values()].every(g => g.length >= 2);
      const held = holdout ? [...groups.values()].map(g => g[g.length - 1]) : [];
      const heldSet = new Set(held);
      const trainRows = holdout ? labels.map((_, i) => i).filter(i => !heldSet.has(i)) : null;
      let A = tf.tensor2d(await fitAffine(trainRows), [2, 3]);
      const trainLabels = tf.tensor2d(trainRows ? trainRows.map(i => labels[i]) : labels);
      const heldLabels = held.length ? tf.tensor2d(held.map(i => labels[i])) : null;
      const heldLoss = async () => {
        if (!heldLabels) return NaN;
        const t = tf.tidy(() => tf.losses.meanSquaredError(heldLabels, applyAffineMatrix(A, predictHead(held))).asScalar());
        try { return (await t.data())[0]; } finally { t.dispose(); }
      };
      const before = await heldLoss();
      let best = before, bestStep = 0, since = 0, stepsUsed = 0;
      bestWeights = variables.map(v => v.clone());
      for (let step = 1; step <= training.steps; step++) {
        const loss = opt.minimize(() => tf.tidy(() => {
          const prediction = applyAffineMatrix(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return training.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(training.l2)).asScalar() : fit;
        }), true, variables);
        if (!loss) throw new Error('Calibration training did not produce a loss');
        try { if (!(await loss.data()).every(Number.isFinite)) throw new Error('Calibration training diverged'); }
        finally { loss.dispose(); }
        stepsUsed = step;
        if (holdout && (step % training.evalEvery === 0 || step === training.steps)) {
          const current = await heldLoss();
          if (current < best) { best = current; bestStep = step; tf.dispose(bestWeights); bestWeights = variables.map(v => v.clone()); since = 0; }
          else if (++since >= training.patience) break;
        }
        if (step % 10 === 0) await tf.nextFrame();
      }
      if (holdout) tf.tidy(() => variables.forEach((v, i) => v.assign(bestWeights[i])));
      // The final affine closes the loop over the adapted head on every sample.
      A.dispose();
      A = tf.tensor2d(await fitAffine(null), [2, 3]);
      this.affineMatrix?.dispose();
      this.affineMatrix = A;
      this.lastTraining = { samples: labels.length, heldOut: held.length, stepsUsed, bestStep: holdout ? bestStep : stepsUsed, heldOutBefore: before, heldOutAfter: best, options: training };
      trainLabels.dispose(); heldLabels?.dispose();
      this.kalmanFilter = new KalmanFilter2D();
      this.latestGazeResult = null;
    } finally {
      tf.dispose([supportX.eyePatches, supportX.headVectors, supportX.faceOrigins3D, supportY, features, initial, bestWeights]);
      opt.dispose();
    }
  }

  exportCalibration(): { weights: number[][]; affine: number[]; faceWidthCm: number } {
    if (!this.affineMatrix || !this.faceWidthComputed) throw new Error('No trained calibration to save');
    return { weights: this.blazeGaze.exportEstimator(), affine: Array.from(this.affineMatrix.dataSync()), faceWidthCm: this.faceWidthCm };
  }

  restoreCalibration(state: { weights: number[][]; affine: number[]; faceWidthCm: number }): void {
    this.blazeGaze.restoreEstimator(state.weights);
    this.affineMatrix?.dispose();
    this.affineMatrix = tf.tensor2d(state.affine, [2, 3]);
    this.faceWidthCm = state.faceWidthCm; this.faceWidthComputed = true;
    this.perspectiveMatrixSet = false; this.intrinsicsMatrixSet = false;
    this.kalmanFilter = new KalmanFilter2D(); this.latestGazeResult = null;
  }

  /** A shared starting estimator (e.g. a team model) before calibration; clears any per-person affine. */
  setBaseEstimator(weights: number[][]): void {
    this.blazeGaze.restoreEstimator(weights);
    this.affineMatrix?.dispose(); this.affineMatrix = null;
    this.kalmanFilter = new KalmanFilter2D(); this.latestGazeResult = null;
  }

  dispose(): void {
    this.loaded = false;
    this.latestGazeResult = null;
    this.affineMatrix?.dispose();
    this.affineMatrix = null;
    this.blazeGaze.dispose();
    this.faceLandmarkerClient.dispose();
  }

''' + s[b:]
s = s.replace('this.intrinsicsMatrix = createIntrinsicsMatrix(width, height);', 'this.intrinsicsMatrix = createIntrinsicsMatrix(width, height);\n      this.intrinsicsMatrixSet = true;')
# Expose a copy before upstream Kalman filtering/clipping, without altering inference.
s = s.replace('    // Apply Kalman filter to smooth the gaze point', '    const rawNormPog = [...normPog[0]];\n\n    // Apply Kalman filter to smooth the gaze point')
s = s.replace("gazeState: 'closed',", "gazeState: 'closed', eyeState: 'unknown',")
s = s.replace("    if ( leftEAR < 0.2", "    const eyeState = this.bilateralEyes.observe(leftEAR, rightEAR);\n    if ( leftEAR < 0.2")
s = s.replace("if ( leftEAR < 0.2 || rightEAR < 0.2)", "if (eyeState !== 'open')")
s = s.replace('gazeState: gaze_state,', 'gazeState: gaze_state, eyeState,')
s = s.replace("      return {\n        facialLandmarks: [],", "      this.bilateralEyes.reset();\n      return {\n        facialLandmarks: [],")
s = s.replace('normPog: [0, 0],', 'normPog: [0, 0], rawNormPog: null,')
s = s.replace('normPog: kalmanOutput,', 'normPog: kalmanOutput,\n      rawNormPog,')
p.write_text(s)
p = out / 'types.ts'
p.write_text(p.read_text().replace('  gazeState:', "  eyeState: 'open' | 'closed' | 'unknown';\n  gazeState:").replace('  normPog: Array<number>;', '  rawNormPog: Array<number> | null; // Pre-Kalman, unclipped estimator output\n  normPog: Array<number>;'))
