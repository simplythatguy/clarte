import { BilateralEyes } from "../../../src/core/blink";
import { readTrainingOptions, type TrainingOptions, type TrainingReport } from "../../../src/core/training";
import { applyHomography3, normalizeFaceRt, poseNormalization } from "../../../src/core/pose-normalize";
import { FaceLandmarkerResult, NormalizedLandmark, Matrix as MediaPipeMatrix } from "@mediapipe/tasks-vision";
import * as tf from '@tensorflow/tfjs';
import { Matrix } from 'ml-matrix';

import { Point, GazeResult } from "./types";
import BlazeGaze from "./BlazeGaze";
import FaceLandmarkerClient from "./FaceLandmarkerClient";
import { 
  computeFaceOrigin3D, 
  createIntrinsicsMatrix, 
  createPerspectiveMatrix, 
  translateMatrix, 
  faceReconstruction, 
  estimateFaceWidth, 
  getHeadVector, 
  obtainEyePatch, 
  computeEAR,
  computeAffineMatrixML,
  applyAffineMatrix
} from "./utils/mathUtils";
import { KalmanFilter2D } from "./utils/filter";

// Reference
// https://mediapipe-studio.webapps.google.com/demo/face_landmarker

interface SupportX {
  eyePatches: tf.Tensor;
  headVectors: tf.Tensor;
  faceOrigins3D: tf.Tensor;
}

function generateSupport(
  eyePatches: ImageData[],
  headVectors: number[][],
  faceOrigins3D: number[][],
  normPogs: number[][]
): { supportX: SupportX, supportY: tf.Tensor } {

  return tf.tidy(() => ({
    supportX: {
      eyePatches: tf.stack(eyePatches.map(patch => tf.browser.fromPixels(patch)), 0).toFloat().div(255),
      headVectors: tf.tensor2d(headVectors, [headVectors.length, 3]),
      faceOrigins3D: tf.tensor2d(faceOrigins3D, [faceOrigins3D.length, 3])
    },
    supportY: tf.tensor2d(normPogs, [normPogs.length, 2])
  }));
}

export default class WebEyeTrack {
  
  // Instance variables
  private readonly bilateralEyes = new BilateralEyes();
  /** Take the eye strip and head vector from a pose-normalized view (virtual camera facing the eyes, no roll). Off by default. */
  public normalizeCrop = false;
  private blazeGaze: BlazeGaze;
  private faceLandmarkerClient: FaceLandmarkerClient;
  private faceWidthComputed: boolean = false;
  private faceWidthCm: number = -1;
  private perspectiveMatrixSet: boolean = false;
  private perspectiveMatrix: Matrix = new Matrix(4, 4);
  private intrinsicsMatrixSet: boolean = false;
  private intrinsicsMatrix: Matrix = new Matrix(3, 3);
  private affineMatrix: tf.Tensor | null = null;
  private kalmanFilter: KalmanFilter2D;

  // Public variables
  public loaded: boolean = false;
  public latestGazeResult: GazeResult | null = null;
  constructor() {
    this.blazeGaze = new BlazeGaze();
    this.faceLandmarkerClient = new FaceLandmarkerClient();
    this.kalmanFilter = new KalmanFilter2D();
  }

  async initialize(baseUrl?: string): Promise<void> {
    await this.faceLandmarkerClient.initialize();
    await this.blazeGaze.loadModel(baseUrl);
    this.loaded = true;
  }

  computeFaceOrigin3D(frame: ImageData, normFaceLandmarks: Point[], faceLandmarks: Point[], faceRT: Matrix): number[] {

    // Estimate the face width in centimeters if not set
    if (this.faceWidthComputed === false) {
      this.faceWidthCm = estimateFaceWidth(faceLandmarks);
      this.faceWidthComputed = true;
    }

    // Perform 3D face reconstruction and determine the pose in 3d cm space
    const [metricTransform, metricFace] = faceReconstruction(
      this.perspectiveMatrix,
      normFaceLandmarks as [number, number][],
      faceRT,
      this.intrinsicsMatrix,
      this.faceWidthCm,
      frame.width,
      frame.height,
      this.latestGazeResult?.faceOrigin3D?.[2] ?? 60
    );

    // Lastly, compute the gaze origins in 3D space using the metric face
    const faceOrigin3D = computeFaceOrigin3D(
      metricFace
    );

    // return faceOrigin3D;
    return faceOrigin3D;
  }

  prepareInput(frame: ImageData, result: FaceLandmarkerResult):  [ImageData, number[], number[]] {

    // Get the dimensions of the video frame
    const width = frame.width;
    const height = frame.height;

    // If perspective matrix is not set, initialize it
    if (!this.perspectiveMatrixSet) {
      const aspectRatio = width / height;
      this.perspectiveMatrix = createPerspectiveMatrix(aspectRatio);
      this.perspectiveMatrixSet = true;
    }

    // If intrinsics matrix is not set, initialize it
    if (!this.intrinsicsMatrixSet) {
      this.intrinsicsMatrix = createIntrinsicsMatrix(width, height);
      this.intrinsicsMatrixSet = true;
    }

    // Convert the normalized landmarks to non-normalized coordinates
    const landmarks = result.faceLandmarks[0];
    const landmarks2d: Point[] = landmarks.map((landmark: NormalizedLandmark) => {
      return [
        Math.floor(landmark.x * width),
        Math.floor(landmark.y * height),
      ];
    });

    // Convert from MediaPipeMatrix to ml-matrix Matrix
    const faceRT = translateMatrix(result.facialTransformationMatrixes[0]);

    // First, extract the eye patch, from the pose-normalized view when enabled.
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

    return [
      eyePatch,
      head_vector,
      face_origin_3d
    ];
  }

  /** Outcome of the last adapt(), for development reports. */
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

  async step(frame: ImageData, timestamp: number): Promise<GazeResult> {
    const tic1 = performance.now();
    let result = await this.faceLandmarkerClient.processFrame(frame) as FaceLandmarkerResult | null;
    const tic2 = performance.now();
    // result = null; // For testing purposes, we can set result to null to simulate no face detected
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      this.bilateralEyes.reset();
      return {
        facialLandmarks: [],
        faceRt: {rows: 0, columns: 0, data: []}, // Placeholder for face transformation matrix
        faceBlendshapes: [],
        eyePatch: new ImageData(1, 1), // Placeholder for eye patch
        headVector: [0, 0, 0], // Placeholder for head vector
        faceOrigin3D: [0, 0, 0], // Placeholder for face
        metric_transform: {rows: 3, columns: 3, data: [1, 0, 0, 1, 0, 0, 1, 0, 0]}, // Placeholder for metric transform
        gazeState: 'closed', eyeState: 'unknown', // Default to closed state if no landmarks
        normPog: [0, 0], rawNormPog: null, // Placeholder for normalized point of gaze
        durations: {
          faceLandmarker: tic2 - tic1,
          prepareInput: 0,
          blazeGaze: 0,
          kalmanFilter: 0,
          total: 0
        },
        timestamp: timestamp // Include the timestamp
      };
    }

    // Perform preprocessing to obtain the eye patch, head_vector, and face_origin_3d
    const [eyePatch, headVector, faceOrigin3D] = this.prepareInput(frame, result);
    const tic3 = performance.now();

    // Compute the EAR ratio to determine if the eyes are open or closed
    let gaze_state: 'open' | 'closed' = 'open';
    const leftEAR = computeEAR(result.faceLandmarks[0], 'left');
    const rightEAR = computeEAR(result.faceLandmarks[0], 'right');
    const eyeState = this.bilateralEyes.observe(leftEAR, rightEAR);
    if (eyeState !== 'open') {
      gaze_state = 'closed';
    }
    // gaze_state = 'closed';

    // If 'closed' return (0, 0) 
    if (gaze_state === 'closed') {
      return {
        facialLandmarks: result.faceLandmarks[0],
        faceRt: result.facialTransformationMatrixes[0],
        faceBlendshapes: result.faceBlendshapes,
        eyePatch: eyePatch,
        headVector: headVector,
        faceOrigin3D: faceOrigin3D,
        metric_transform: {rows: 3, columns: 3, data: [1, 0, 0, 1, 0, 0, 1, 0, 0]}, // Placeholder, should be computed
        gazeState: gaze_state, eyeState,
        normPog: [0, 0], rawNormPog: null,
        durations: {
          faceLandmarker: tic2 - tic1,
          prepareInput: tic3 - tic2,
          blazeGaze: 0, // No BlazeGaze inference if eyes are closed
          kalmanFilter: 0, // No Kalman filter step if eyes are closed
          total: tic3 - tic1
        },
        timestamp: timestamp // Include the timestamp
      };
    }

    const [predNormPog, tic4] = tf.tidy(() => {

      // Perform the gaze estimation via BlazeGaze Model (tensorflow.js)
      const inputTensor = tf.browser.fromPixels(eyePatch).toFloat().expandDims(0);

      // Divide the inputTensor by 255 to normalize pixel values
      const normalizedInputTensor = inputTensor.div(tf.scalar(255.0));
      const headVectorTensor = tf.tensor2d(headVector, [1, 3]);
      const faceOriginTensor = tf.tensor2d(faceOrigin3D, [1, 3]);
      let outputTensor = this.blazeGaze.predict(normalizedInputTensor, headVectorTensor, faceOriginTensor);
      tf.dispose([inputTensor, normalizedInputTensor, headVectorTensor, faceOriginTensor]);
      const tic4 = performance.now();

      // If affine transformation is available, apply it
      if (this.affineMatrix) {
        outputTensor = applyAffineMatrix(this.affineMatrix, outputTensor);
      }

      // Extract the 2D gaze point data from the output tensor
      if (!outputTensor || outputTensor.shape.length === 0) {
        throw new Error("BlazeGaze model did not return valid output");
      }
      return [outputTensor, tic4];
    });

    const normPog = predNormPog.arraySync() as number[][];
    tf.dispose(predNormPog);

    const rawNormPog = [...normPog[0]];

    // Apply Kalman filter to smooth the gaze point
    const kalmanOutput = this.kalmanFilter.step(normPog[0]);
    const tic5 = performance.now();

    // Clip the output to the range of [-0.5, 0.5]
    kalmanOutput[0] = Math.max(-0.5, Math.min(0.5, kalmanOutput[0]));
    kalmanOutput[1] = Math.max(-0.5, Math.min(0.5, kalmanOutput[1]));

    // Log the timings
    const durations = {
      faceLandmarker: tic2 - tic1,
      prepareInput: tic3 - tic2,
      blazeGaze: tic4 - tic3,
      kalmanFilter: tic5 - tic4,
      total: tic5 - tic1
    };

    // Return GazeResult
    let gaze_result: GazeResult = {
      facialLandmarks: result.faceLandmarks[0],
      faceRt: result.facialTransformationMatrixes[0],
      faceBlendshapes: result.faceBlendshapes,
      eyePatch: eyePatch,
      headVector: headVector,
      faceOrigin3D: faceOrigin3D,
      metric_transform: {rows: 3, columns: 3, data: [1, 0, 0, 1, 0, 0, 1, 0, 0]}, // Placeholder, should be computed
      gazeState: gaze_state, eyeState,
      normPog: kalmanOutput,
      rawNormPog,
      durations: durations,
      timestamp: timestamp
    };

    // Debug: Printout the tf.Memory
    // console.log(`[WebEyeTrack] tf.Memory: ${JSON.stringify(tf.memory().numTensors)} tensors, ${JSON.stringify(tf.memory().unreliable)} unreliable, ${JSON.stringify(tf.memory().numBytes)} bytes`);

    // Update the latest gaze result
    this.latestGazeResult = gaze_result;
    return gaze_result;
  }
}