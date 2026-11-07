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
p.write_text(s)
p = out / 'WebEyeTrack.ts'
s = p.read_text()
s = 'import { BilateralEyes } from \"../../../src/core/blink\";\n' + s
s = s.replace('  private blazeGaze:', '  private readonly bilateralEyes = new BilateralEyes();\n  private blazeGaze:')
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
s = s[:a] + '''  async adapt(
    eyePatches: ImageData[], headVectors: number[][], faceOrigins3D: number[][],
    normPogs: number[][], stepsInner = 1, innerLR = 1e-5
  ): Promise<void> {
    if (eyePatches.length < 9 || eyePatches.length !== normPogs.length ||
        headVectors.length !== normPogs.length || faceOrigins3D.length !== normPogs.length) {
      throw new Error('Calibration requires at least nine paired observations');
    }
    const { supportX, supportY } = generateSupport(eyePatches, headVectors, faceOrigins3D, normPogs);
    const opt = tf.train.adam(innerLR, 0.85, 0.9, 1e-8);
    try {
      const preds = tf.tidy(() => this.blazeGaze.predict(supportX.eyePatches, supportX.headVectors, supportX.faceOrigins3D));
      try {
        const [predicted, labels] = await Promise.all([preds.array(), supportY.array()]);
        const affine = computeAffineMatrixML(predicted as number[][], labels as number[][]);
        if (!affine.flat().every(Number.isFinite)) throw new Error('Calibration produced a nonfinite transform');
        this.affineMatrix?.dispose();
        this.affineMatrix = tf.tensor2d(affine, [2, 3]);
      } finally { preds.dispose(); }
      const variables = this.blazeGaze.trainableVariables();
      for (let step = 0; step < stepsInner; step++) {
        const loss = opt.minimize(() => tf.tidy(() => {
          const prediction = this.blazeGaze.predict(supportX.eyePatches, supportX.headVectors, supportX.faceOrigins3D);
          const transformed = this.affineMatrix ? applyAffineMatrix(this.affineMatrix, prediction) : prediction;
          return tf.losses.meanSquaredError(supportY, transformed).asScalar();
        }), true, variables);
        if (!loss) throw new Error('Calibration training did not produce a loss');
        try { if (!(await loss.data()).every(Number.isFinite)) throw new Error('Calibration training diverged'); }
        finally { loss.dispose(); }
        await tf.nextFrame();
      }
      this.kalmanFilter = new KalmanFilter2D();
      this.latestGazeResult = null;
    } finally {
      tf.dispose([supportX.eyePatches, supportX.headVectors, supportX.faceOrigins3D, supportY]);
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
