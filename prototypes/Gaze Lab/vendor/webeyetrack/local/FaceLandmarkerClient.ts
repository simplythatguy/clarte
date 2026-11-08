import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
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
