"""Reproducible local adaptations to upstream b12701d; input must be pristine."""
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'vendor/webgazer/src'
p = root / 'index.mjs'
s = p.read_text()

def replace(old, new):
    global s
    assert s.count(old) == 1, f'Upstream changed: {old[:70]}'
    s = s.replace(old, new)

replace("import localforage from 'localforage';", "// Local adaptation: no persistence module is loaded.")
replace('var paused = false;', '''var paused = true;
var sessionGeneration = 0;
var frameRequest = 0;
var pendingSetupCancel = null;
var inFlight = Promise.resolve();
var frameCapturedAt = -Infinity;
var lastVideoFrame = null;
var lastCalibrationFrame = -Infinity;
var explicitCalibration = false;
var trackingError = function() {};''')
replace('async function getPrediction(regModelIndex) {', 'async function getPrediction(regModelIndex, generation = sessionGeneration, capturedAt = performance.now()) {')
replace('  latestEyeFeatures = await getPupilFeatures(videoElementCanvas, videoElementCanvas.width, videoElementCanvas.height);', '''  const features = await getPupilFeatures(videoElementCanvas, videoElementCanvas.width, videoElementCanvas.height);
  if (generation !== sessionGeneration || paused) return null;
  latestEyeFeatures = features;
  frameCapturedAt = capturedAt;''')
replace('async function loop() {\n  if (!paused) {', 'async function loop(generation = sessionGeneration) {\n  if (!paused && generation === sessionGeneration) {')
replace('    paintCurrentFrame(videoElementCanvas, videoElementCanvas.width, videoElementCanvas.height);', '''    const decodedFrame = videoElement.getVideoPlaybackQuality?.().totalVideoFrames ?? videoElement.currentTime;
    if (videoElement.readyState < 2 || !Number.isFinite(decodedFrame) || decodedFrame === lastVideoFrame) {
      callback(performance.now() - frameCapturedAt <= 600 ? latestGazeData : null, performance.now() - clockStart);
      frameRequest = requestAnimationFrame(() => {
        inFlight = loop(generation).catch(err => {
          if (generation === sessionGeneration && !paused) { paused = true; latestEyeFeatures = null; trackingError(err); }
        });
      });
      return;
    }
    lastVideoFrame = decodedFrame;
    paintCurrentFrame(videoElementCanvas, videoElementCanvas.width, videoElementCanvas.height);''')
replace('    latestGazeData = getPrediction();', '''    const capturedAt = performance.now();
    const pendingPrediction = getPrediction(undefined, generation, capturedAt);''')
replace('    latestGazeData = await latestGazeData;', '''    const prediction = await pendingPrediction;
    if (paused || generation !== sessionGeneration) return;
    latestGazeData = prediction;''')
replace('    requestAnimationFrame(loop);', '''    frameRequest = requestAnimationFrame(() => {
      inFlight = loop(generation).catch(err => {
        if (generation === sessionGeneration && !paused) {
          paused = true;
          latestEyeFeatures = null;
          trackingError(err);
        }
      });
    });''')
replace('  if (paused) {\n    return;\n  }\n  if (regs.length === 0) {', '''  if (paused || !explicitCalibration || !latestEyeFeatures || performance.now() - frameCapturedAt > 600 || frameCapturedAt <= lastCalibrationFrame) {
    return false;
  }
  if (regs.length === 0) {''')
replace('      regs[reg].addData(latestEyeFeatures, [x, y], eventType);\n  }\n};', '      regs[reg].addData(latestEyeFeatures, [x, y], eventType);\n  }\n  lastCalibrationFrame = frameCapturedAt;\n  return true;\n};')
start = s.index('var clickListener = async function(event) {')
end = s.index('/**\n * Initializes all needed dom elements', start)
s = s[:start] + '''// Local adaptation: incidental clicks and movement never train; no browser storage.
var addMouseEventListeners = function() {};
var removeMouseEventListeners = function() {};
async function loadGlobalData() {}
async function setGlobalData() {}
function clearData() {
  lastCalibrationFrame = -Infinity;
  latestEyeFeatures = null;
  latestGazeData = null;
  data = [];
  smoothingVals = new util.DataWindow(4);
  for (const reg of regs) reg.init();
}

''' + s[end:]
replace('async function init(stream) {', 'async function init(stream, generation) {')
replace('  videoElement.autoplay = true;', '  videoElement.autoplay = true;\n  videoElement.muted = true;')
replace('  const videoPreviewSetup = new Promise((res) => {', '''  const videoPreviewSetup = new Promise((res, reject) => {
    pendingSetupCancel = () => reject(new DOMException('Session stopped', 'AbortError'));''')
replace('    function setupPreviewVideo(e) {', '''    function setupPreviewVideo(e) {
      if (generation !== sessionGeneration) return;
      pendingSetupCancel = null;''')
replace('  await videoPreviewSetup;\n  await loop();', '''  await videoPreviewSetup;
  if (generation !== sessionGeneration) throw new DOMException('Session stopped', 'AbortError');
  inFlight = loop(generation);
  await inFlight;''')
start = s.index('webgazer.begin = function(onFail) {')
end = s.index('\n\n/**', start)
s = s[:start] + '''// Local adaptation: the app owns the cancellable camera request. No implicit permission prompt.
webgazer.begin = function() {
  return Promise.reject(new Error('Use beginWithStream after an explicit camera request.'));
};
webgazer.beginWithStream = async function(stream) {
  const generation = ++sessionGeneration;
  paused = false;
  latestEyeFeatures = null;
  frameCapturedAt = -Infinity;
  lastVideoFrame = null;
  await init(stream, generation);
  return webgazer;
};
webgazer.setCalibrationEnabled = function(value) {
  explicitCalibration = value === true;
};
webgazer.recordCalibrationPoint = function(x, y) {
  return recordScreenPosition(x, y, 'click') === true;
};
webgazer.getTrackingStatus = function() {
  const fresh = !paused && performance.now() - frameCapturedAt <= 600;
  return { faceDetected: !!latestEyeFeatures && fresh, frameTime: frameCapturedAt,
    headPose: fresh && latestEyeFeatures ? latestEyeFeatures.headPose ?? null : null };
};
webgazer.setErrorListener = function(listener) { trackingError = listener; };
''' + s[end:]
start = s.index('webgazer.end = function() {')
end = s.index('\n\n/**', start)
s = s[:start] + '''webgazer.end = async function() {
  ++sessionGeneration;
  paused = true;
  explicitCalibration = false;
  cancelAnimationFrame(frameRequest);
  pendingSetupCancel?.();
  pendingSetupCancel = null;
  removeMouseEventListeners();
  videoStream?.getTracks().forEach(track => track.stop());
  videoContainerElement?.remove();
  gazeDot?.remove();
  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
  }
  await inFlight.catch(() => {});
  latestEyeFeatures = null;
  latestGazeData = null;
  frameCapturedAt = -Infinity;
  await curTracker.detector?.dispose();
  curTracker.detector = null;
  curTracker.positionsArray = null;
  curTracker.predictionReady = false;
  if (videoElementCanvas) {
    videoElementCanvas.width = 0;
    videoElementCanvas.height = 0;
  }
  videoElement = null;
  videoElementCanvas = null;
  videoStream = null;
  videoContainerElement = null;
  faceOverlay = null;
  faceFeedbackBox = null;
  gazeDot = null;
  return webgazer;
};''' + s[end:]
replace('  webgazer.params.saveDataAcrossSessions = val;', '  webgazer.params.saveDataAcrossSessions = false; // Persistence is unavailable in this build.')
p.write_text(s)
p = root / 'facemesh.mjs'
s = p.read_text()
assert s.count('  this.predictionReady = true;') == 1
s = s.replace('  this.predictionReady = true;', '''  // Local adaptation: carry geometry from this exact eye-patch inference result.
  // Never read the cached positionsArray after a missing-face result.
  eyeObjs.headPose = headPositionFromLandmarks(keypoints, width, height);
  this.predictionReady = true;''')
s += '''

// Local adaptation: image-space proxies only, not 3D angles or eye direction.
// Outer eye corners (33, 263) and nose tip (1) are from this inference result.
export function headPositionFromLandmarks(keypoints, width, height) {
  if (!Array.isArray(keypoints) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const points = [keypoints[33], keypoints[263], keypoints[1]];
  if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > width || point.y < 0 || point.y > height)) return null;
  const [a, b, nose] = points;
  const dx = b.x - a.x, dy = b.y - a.y;
  const span = Math.hypot(dx, dy);
  if (span < 1) return null;
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  return {
    centerX: x / width, centerY: y / width, span: span / width,
    roll: Math.atan2(dy, dx),
    yawRatio: ((nose.x - x) * dx + (nose.y - y) * dy) / (span * span),
    pitchRatio: (-(nose.x - x) * dy + (nose.y - y) * dx) / (span * span),
  };
}
'''
p.write_text(s)
p = root / 'params.mjs'
s = p.read_text().replace("faceMeshSolutionPath: './mediapipe/face_mesh'", "faceMeshSolutionPath: '/vendor/mediapipe/face_mesh'").replace('saveDataAcrossSessions: true', 'saveDataAcrossSessions: false').replace('showGazeDot: true', 'showGazeDot: false').replace('showFaceOverlay: true', 'showFaceOverlay: false').replace('showFaceFeedbackBox: true', 'showFaceFeedbackBox: false').replace('showVideo: true', 'showVideo: false').replace('showVideoPreview: true', 'showVideoPreview: false')
p.write_text(s)
