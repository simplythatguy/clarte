// Applies gaze-lab's edits to freshly copied Clarte sources. Idempotent: each edit is skipped when already
// applied and fails loudly when its anchor text is missing (the source moved and ADAPTATIONS.md must be revisited).
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITS = {
  'src/core/worker-engine.ts': [
    { why: 'featureVector is needed for the debug payload',
      from: "import { blend, blendWeight, boundWeight, fitGeometric, gazeFeatures, predictGeometric, type GazeFeatures, type GeometricState } from './geometric-gaze';",
      to: "import { blend, blendWeight, boundWeight, featureVector, fitGeometric, gazeFeatures, predictGeometric, type GazeFeatures, type GeometricState } from './geometric-gaze';" },
    { why: 'Observation carries the tracker timings; DebugStep type',
      from: "  faceRt?: { rows: number; columns: number; data: number[] };\n};",
      to: `  faceRt?: { rows: number; columns: number; data: number[] };
  /** gaze-lab: per-stage timings the tracker reports (ms), passed through in debug mode. */
  durations?: Record<string, number>;
};
/** gaze-lab debug payload: the estimator's exact inputs for this frame, alongside the unchanged shipped outputs. */
export type DebugStep = {
  headVector: number[]; faceOrigin3D: number[]; faceRt: number[] | null;
  /** 478 × 3 normalized landmarks, flat, rounded to 1e-5. */
  landmarks: number[];
  features: GazeFeatures | null; featureVector: number[] | null;
  timings: Record<string, number>;
};` },
    { why: 'eye strips for every record-phase frame of a block fit in one export',
      from: 'export const REPLAY_LIMIT = 600;', to: 'export const REPLAY_LIMIT = 4000; // gaze-lab: was 600; eye strips are exported per block.' },
    { why: 'debug flag',
      from: "  private recording = false;\n  private replay: { entry: ReplayEntry; image: Blob }[] = [];",
      to: "  private recording = false;\n  /** gaze-lab: when on, step() also returns the DebugStep inputs. Shipped math is unchanged. */\n  private debug = false;\n  private replay: { entry: ReplayEntry; image: Blob }[] = [];" },
    { why: 'setDebug and step timing start',
      from: "  async step(frame: ImageData, at: number, capturedEpoch: number): Promise<WorkerGaze> {\n    if (this.state !== 'idle' && this.state !== 'trained') throw new Error('Tracker is busy');",
      to: "  setDebug(enabled: boolean): void { this.debug = enabled; }\n  async step(frame: ImageData, at: number, capturedEpoch: number): Promise<WorkerGaze & { debug?: DebugStep }> {\n    const started = performance.now();\n    if (this.state !== 'idle' && this.state !== 'trained') throw new Error('Tracker is busy');" },
    { why: 'tracker timing',
      from: "      const observation = await this.tracker.step(frame, at);\n      if (this.disposed()) throw new Error('Tracker stopped');\n      const valid = validObservation(observation);",
      to: "      const observation = await this.tracker.step(frame, at);\n      const trackerDone = performance.now();\n      if (this.disposed()) throw new Error('Tracker stopped');\n      const valid = validObservation(observation);" },
    { why: 'debug payload on the unchanged result object',
      from: "      const estimates: Estimates<number[]> | null = valid ? { network, geometric } : null;\n      return { normPog: valid ? (fused && fused !== network ? [clip(fused[0]), clip(fused[1])] : observation.normPog) : [0, 0], rawNormPog: fused, face: valid, open: valid, facePresent, eyeState: facePresent ? observation.eyeState : 'unknown', at, pose, estimates, camera };",
      to: `      const estimates: Estimates<number[]> | null = valid ? { network, geometric } : null;
      const result: WorkerGaze & { debug?: DebugStep } = { normPog: valid ? (fused && fused !== network ? [clip(fused[0]), clip(fused[1])] : observation.normPog) : [0, 0], rawNormPog: fused, face: valid, open: valid, facePresent, eyeState: facePresent ? observation.eyeState : 'unknown', at, pose, estimates, camera };
      if (this.debug) {
        const rt = observation.faceRt && observation.faceRt.data.length === 16 && observation.faceRt.data.every(Number.isFinite) ? [...observation.faceRt.data] : null;
        result.debug = {
          headVector: [...observation.headVector], faceOrigin3D: [...observation.faceOrigin3D], faceRt: rt,
          landmarks: facePresent ? observation.facialLandmarks.flatMap(p => [p.x, p.y, p.z]).map(v => Math.round(v * 1e5) / 1e5) : [],
          features, featureVector: features ? featureVector(features) : null,
          timings: { ...(observation.durations ?? {}), tracker: trackerDone - started, engine: performance.now() - trackerDone, total: performance.now() - started },
        };
      }
      return result;` },
    { why: 'quick-calibration test: EngineLimits type and the shipped constants',
      from: 'export type ReplayExport = { entries: ReplayEntry[]; images: Blob[] };',
      to: `export type ReplayExport = { entries: ReplayEntry[]; images: Blob[] };
/** gaze-lab: collect()/train() bounds. The shipped constants are 42 samples at most, training on ≥ 27 samples over ≥ 9 distinct targets. */
export type EngineLimits = { maxSamples: number; minSamples: number; minTargets: number };
export const SHIPPED_LIMITS: EngineLimits = { maxSamples: 42, minSamples: 27, minTargets: 9 };
/** Positive integers per field, anything else the shipped value; maxSamples is never below minSamples. */
export function readLimits(v: unknown): EngineLimits {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof EngineLimits, unknown>>;
  const int = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : fallback);
  const minSamples = int(o.minSamples, SHIPPED_LIMITS.minSamples);
  return { maxSamples: Math.max(minSamples, int(o.maxSamples, SHIPPED_LIMITS.maxSamples)), minSamples, minTargets: int(o.minTargets, SHIPPED_LIMITS.minTargets) };
}` },
    { why: 'quick-calibration test: limits and blend-cap fields (defaults = shipped)',
      from: "  private lastAt = -Infinity;\n  private recording = false;",
      to: `  private lastAt = -Infinity;
  /** gaze-lab: collect()/train() bounds; the defaults are the shipped constants (see SHIPPED_LIMITS). */
  private limits: EngineLimits = { ...SHIPPED_LIMITS };
  /** gaze-lab: upper bound on the geometric share of the blend; the default is the shipped weightRange top (boundWeight(1) = 0.85). */
  private geometricShareMax = boundWeight(1);
  private recording = false;` },
    { why: 'quick-calibration test: setters for the limits and the blend cap',
      from: '  get replayCount() { return this.replay.length; }',
      to: `  get replayCount() { return this.replay.length; }
  /** gaze-lab: only before any label is collected; invalid fields keep the shipped values. */
  setLimits(limits: unknown): EngineLimits { if (this.samples.length) throw new Error('Set limits before collecting'); this.limits = readLimits(limits); return { ...this.limits }; }
  /** gaze-lab: caps the geometric share from blendWeight() and setBlend(); invalid or out of range keeps the shipped top. */
  setGeometricShareMax(max: unknown): number { this.geometricShareMax = typeof max === 'number' && Number.isFinite(max) && max >= 0 ? boundWeight(max) : boundWeight(1); return this.geometricShareMax; }` },
    { why: 'quick-calibration test: collect cap from the limits',
      from: "    if (this.state !== 'idle' || !latest || at !== latest.at || this.samples.length >= 42 ||",
      to: "    if (this.state !== 'idle' || !latest || at !== latest.at || this.samples.length >= this.limits.maxSamples ||" },
    { why: 'quick-calibration test: train minimums from the limits',
      from: "    if (this.state !== 'idle' || this.samples.length < 27 || new Set(this.samples.map(s => s.label.join(','))).size < 9) throw new Error('Finish the nine instructed targets first');",
      to: "    if (this.state !== 'idle' || this.samples.length < this.limits.minSamples || new Set(this.samples.map(s => s.label.join(','))).size < this.limits.minTargets) throw new Error(this.limits.minTargets === SHIPPED_LIMITS.minTargets ? 'Finish the nine instructed targets first' : `Finish the ${this.limits.minTargets} instructed targets first`);" },
    { why: 'quick-calibration test: the trained blend weight is capped',
      from: "    const weight = fit ? blendWeight(fit.heldOutMse, typeof network === 'number' && Number.isFinite(network) ? network : null) : 0;",
      to: "    const weight = fit ? Math.min(this.geometricShareMax, blendWeight(fit.heldOutMse, typeof network === 'number' && Number.isFinite(network) ? network : null)) : 0;" },
    { why: 'quick-calibration test: setBlend is capped',
      from: '    this.geometric = { ...this.geometric, weight: boundWeight(weight) };',
      to: '    this.geometric = { ...this.geometric, weight: Math.min(this.geometricShareMax, boundWeight(weight)) };' },
  ],
  'vendor/webeyetrack/worker.ts': [
    { why: 'init {fixes:{matrixLayout,freezePose}} turns the candidate fixes on (default off = shipped-identical)',
      from: "      tracker.normalizeCrop = !!payload && typeof payload === 'object' && 'normalizeCrop' in payload && payload.normalizeCrop === true;",
      to: `      tracker.normalizeCrop = !!payload && typeof payload === 'object' && 'normalizeCrop' in payload && payload.normalizeCrop === true;
      // gaze-lab: candidate fixes behind init flags; default off keeps the worker shipped-identical (npm run test:parity proves it).
      const fixes = !!payload && typeof payload === 'object' && 'fixes' in payload && !!payload.fixes && typeof payload.fixes === 'object' ? payload.fixes as Record<string, unknown> : {};
      tracker.fixMatrixLayout = fixes.matrixLayout === true;
      tracker.fixFreezePose = fixes.freezePose === true;` },
    { why: 'init reports which fixes, limits and blend cap are on',
      from: "      value = { backend: tf.getBackend() };",
      to: "      value = { backend: tf.getBackend(), fixes: { matrixLayout: tracker.fixMatrixLayout, freezePose: tracker.fixFreezePose }, limits, blend: { geometricShareMax } };" },
    { why: 'init {debug:true} turns the debug payload on',
      from: "      engine = new CalibrationEngine(tracker);\n      development = !!payload && typeof payload === 'object' && 'development' in payload && payload.development === true;",
      to: "      engine = new CalibrationEngine(tracker);\n      development = !!payload && typeof payload === 'object' && 'development' in payload && payload.development === true;\n      // gaze-lab: debug mode returns the estimator's inputs with every step; shipped outputs are unchanged.\n      engine.setDebug(!!payload && typeof payload === 'object' && 'debug' in payload && payload.debug === true);" },
    { why: 'quick-calibration test: init {limits:{maxSamples,minSamples,minTargets}, blend:{geometricShareMax}}; absent = shipped constants (parity-tested)',
      from: "      engine.setDebug(!!payload && typeof payload === 'object' && 'debug' in payload && payload.debug === true);",
      to: `      engine.setDebug(!!payload && typeof payload === 'object' && 'debug' in payload && payload.debug === true);
      // gaze-lab: collect/train limits and the geometric blend cap behind init options; absent or invalid = the shipped constants.
      const limits = engine.setLimits(!!payload && typeof payload === 'object' && 'limits' in payload ? payload.limits : null);
      const blendOption = !!payload && typeof payload === 'object' && 'blend' in payload && !!payload.blend && typeof payload.blend === 'object' && 'geometricShareMax' in payload.blend ? payload.blend.geometricShareMax : null;
      const geometricShareMax = engine.setGeometricShareMax(blendOption);` },
  ],
  'vendor/webeyetrack/local/utils/mathUtils.ts': [
    { why: 'fixes.matrixLayout: translateMatrix can read MediaPipe\'s column-major data as such (default: the shipped row-major read)',
      from: `export function translateMatrix(
    matrix: MediaPipeMatrix,
): Matrix {
  // Convert MediaPipeMatrix to ml-matrix format
  const data = matrix.data;
  const translatedMatrix = new Matrix(matrix.rows, matrix.columns);
  for (let i = 0; i < matrix.rows; i++) {
    for (let j = 0; j < matrix.columns; j++) {
      translatedMatrix.set(i, j, data[i * matrix.columns + j]);
    }
  }
  return translatedMatrix;
}`,
      to: `export function translateMatrix(
    matrix: MediaPipeMatrix,
    // gaze-lab fixes.matrixLayout: MediaPipe packs the matrix column-major (translation at indices 12-14); the shipped
    // row-major read yields the transposed rotation. Off = shipped behaviour.
    columnMajor: boolean = false,
): Matrix {
  // Convert MediaPipeMatrix to ml-matrix format
  const data = matrix.data;
  const translatedMatrix = new Matrix(matrix.rows, matrix.columns);
  for (let i = 0; i < matrix.rows; i++) {
    for (let j = 0; j < matrix.columns; j++) {
      translatedMatrix.set(i, j, columnMajor ? data[j * matrix.rows + i] : data[i * matrix.columns + j]);
    }
  }
  return translatedMatrix;
}` },
    { why: 'fixes.matrixLayout: faceReconstruction inverts the (now correctly read) rotation before the Euler step, as python face_reconstruction does',
      from: `    videoHeight: number,
    initialZGuess = 60
): [Matrix, [number, number, number][]] {`,
      to: `    videoHeight: number,
    initialZGuess = 60,
    // gaze-lab fixes.matrixLayout: with a column-major faceRT the Euler angles come from inverse(faceR), as the Python
    // training pipeline does (model_based.face_reconstruction: rotation_matrix_to_euler_angles(np.linalg.inv(face_r))).
    // The shipped row-major read is that inverse for an exact rotation, so off = shipped behaviour.
    columnMajor: boolean = false
): [Matrix, [number, number, number][]] {` },
    { why: 'fixes.matrixLayout: the inverse itself',
      from: `    const faceR = faceRT.subMatrix(0, 2, 0, 2);
    let [pitch, yaw, roll] = matrixToEuler(faceR);`,
      to: `    const faceR = faceRT.subMatrix(0, 2, 0, 2);
    let [pitch, yaw, roll] = matrixToEuler(columnMajor ? inverse(faceR) : faceR);` },
  ],
  'vendor/webeyetrack/local/WebEyeTrack.ts': [
    { why: 'fix flags on the tracker',
      from: `  public normalizeCrop = false;`,
      to: `  public normalizeCrop = false;
  /** gaze-lab fixes.matrixLayout: read MediaPipe's face matrix column-major everywhere (head vector = the face's forward axis, as in the Python training pipeline). Off = shipped. */
  public fixMatrixLayout = false;
  /** gaze-lab fixes.freezePose: keep the first Dense layer's head-vector / face-origin kernel rows (512-517) at their pretrained values during adapt(). Off = shipped. */
  public fixFreezePose = false;` },
    { why: 'faceReconstruction gets the layout flag',
      from: `      this.latestGazeResult?.faceOrigin3D?.[2] ?? 60
    );`,
      to: `      this.latestGazeResult?.faceOrigin3D?.[2] ?? 60,
      this.fixMatrixLayout
    );` },
    { why: 'translateMatrix gets the layout flag (raw matrix)',
      from: `    const faceRT = translateMatrix(result.facialTransformationMatrixes[0]);`,
      to: `    const faceRT = translateMatrix(result.facialTransformationMatrixes[0], this.fixMatrixLayout);` },
    { why: 'translateMatrix gets the layout flag (pose-normalized matrix; normalizeFaceRt returns column-major data)',
      from: `      normalization ? translateMatrix({ rows: 4, columns: 4, data: normalizeFaceRt(result.facialTransformationMatrixes[0].data, normalization.rotation) }) : faceRT`,
      to: `      normalization ? translateMatrix({ rows: 4, columns: 4, data: normalizeFaceRt(result.facialTransformationMatrixes[0].data, normalization.rotation) }, this.fixMatrixLayout) : faceRT` },
    { why: 'freezePose: mask tensor lifetime',
      from: `    let bestWeights: tf.Tensor[] = [];
    const opt = tf.train.adam(training.lr, 0.85, 0.9, 1e-8);`,
      to: `    let bestWeights: tf.Tensor[] = [];
    let poseMask: tf.Tensor | null = null;
    const opt = tf.train.adam(training.lr, 0.85, 0.9, 1e-8);` },
    { why: 'freezePose: zero the gradient of kernel rows 512-517 at every Adam step; off = the shipped opt.minimize call',
      from: `      for (let step = 1; step <= training.steps; step++) {
        const loss = opt.minimize(() => tf.tidy(() => {
          const prediction = applyAffineMatrix(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return training.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(training.l2)).asScalar() : fit;
        }), true, variables);
        if (!loss) throw new Error('Calibration training did not produce a loss');`,
      to: `      // gaze-lab fixes.freezePose: the first Dense kernel's rows 512-517 multiply the head vector and face origin; their
      // gradient is zeroed before every Adam step (as analysis/rerun_head.mjs does offline), so those rows stay pretrained.
      const poseKernel = this.fixFreezePose ? variables.find(v => v.shape.length === 2 && v.shape[0] === 518) ?? null : null;
      if (this.fixFreezePose && !poseKernel) throw new Error('freezePose: first Dense kernel [518, n] not found among the trainable variables');
      const poseCols = poseKernel?.shape[1] ?? 0;
      poseMask = poseKernel ? tf.tidy(() => tf.concat([tf.ones([512, poseCols]), tf.zeros([6, poseCols])], 0)) : null;
      for (let step = 1; step <= training.steps; step++) {
        const lossFn = () => tf.tidy(() => {
          const prediction = applyAffineMatrix(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return training.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(training.l2)).asScalar() : fit;
        });
        let loss: tf.Scalar | null;
        if (poseKernel && poseMask) {
          const { value, grads } = tf.variableGrads(lossFn, variables);
          const g = grads[poseKernel.name]; grads[poseKernel.name] = g.mul(poseMask); g.dispose();
          opt.applyGradients(variables.map(v => ({ name: v.name, tensor: grads[v.name] })));
          tf.dispose(grads); loss = value;
        } else loss = opt.minimize(lossFn, true, variables);
        if (!loss) throw new Error('Calibration training did not produce a loss');` },
    { why: 'freezePose: dispose the mask',
      from: `      opt.dispose();
    }
  }`,
      to: `      opt.dispose(); poseMask?.dispose();
    }
  }` },
  ],
  'scripts/build-vendor.mjs': [
    { why: 'banner names the build', from: "banner: { js: '/* WebEyeTrack 75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c, MIT; local adaptations. See /vendor/webeyetrack/licenses/NOTICE.txt */' } });",
      to: "banner: { js: '/* WebEyeTrack 75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c, MIT; local adaptations; gaze-lab debug build (init {debug:true} adds estimator inputs to step results). See /vendor/webeyetrack/licenses/NOTICE.txt */' } });" },
    { why: 'the shipped bundle kept for parity is not part of this build', from: "if (name.isDirectory()) await walk(file); else if (name.name !== 'BUILD.json') files.push(",
      to: "if (name.isDirectory()) await walk(file); else if (name.name !== 'BUILD.json' && name.name !== 'worker.shipped.js') files.push(" },
  ],
};
let applied = 0, already = 0;
for (const [rel, edits] of Object.entries(EDITS)) {
  const file = path.join(LAB, rel);
  let text = await readFile(file, 'utf8');
  for (const edit of edits) {
    if (text.includes(edit.to)) { already++; continue; }
    const count = text.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor for "${edit.why}" found ${count} times`);
    text = text.replace(edit.from, edit.to); applied++;
  }
  await writeFile(file, text);
}
console.log(`adaptations: ${applied} applied, ${already} already present`);
