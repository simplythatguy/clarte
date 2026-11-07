import { BilateralEyes } from "../../../src/core/blink";
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

    // First, extract the eye patch
    const eyePatch = obtainEyePatch(
      frame,
      landmarks2d,
    );

    // Second, compute the face origin in 3D space
    const face_origin_3d = this.computeFaceOrigin3D(
      frame,
      landmarks.map((l: NormalizedLandmark) => [l.x, l.y]),
      landmarks2d,
      faceRT
    )

    // Third, compute the head vector
    const head_vector = getHeadVector(
      faceRT
    );

    return [
      eyePatch,
      head_vector,
      face_origin_3d
    ];
  }

  async adapt(
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