#!/usr/bin/env node
// Writes patches/clarte-eye-tracking-fixes.patch: the two candidate fixes (column-major face matrix; frozen pose input
// columns during adapt) as a unified diff against the Clarte repo paths (prototypes/Eye Tracking/vendor/webeyetrack/local/...),
// with the fixes simply ON (no gaze-lab flag plumbing). The pristine source text is rebuilt from the gaze-lab copies by
// reversing scripts/apply-adaptations.mjs's edits and verified against the SOURCE.json sha256, so the patch is generated,
// not hand-typed, and `patch --dry-run` is run against the rebuilt pristine files. Never touches the Clarte checkout.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'prototypes/Eye Tracking';
const source = JSON.parse(await readFile(path.join(LAB, 'SOURCE.json'), 'utf8'));
// The adaptation edits (from → to) of the two files, read from apply-adaptations.mjs itself.
const adaptations = await readFile(path.join(LAB, 'scripts/apply-adaptations.mjs'), 'utf8');
const EDITS = eval('(' + adaptations.slice(adaptations.indexOf('const EDITS = ') + 'const EDITS = '.length, adaptations.indexOf('\nlet applied')).replace(/;\s*$/, '') + ')');
const FILES = ['vendor/webeyetrack/local/utils/mathUtils.ts', 'vendor/webeyetrack/local/WebEyeTrack.ts'];
const pristine = {};
for (const rel of FILES) {
  let text = await readFile(path.join(LAB, rel), 'utf8');
  for (const edit of [...EDITS[rel]].reverse()) { if (text.split(edit.to).length !== 2) throw new Error(`${rel}: adaptation "${edit.why}" not found exactly once`); text = text.replace(edit.to, edit.from); }
  const sha = createHash('sha256').update(text).digest('hex'), expected = source.files.find(f => f.path === rel).sha256;
  if (sha !== expected) throw new Error(`${rel}: rebuilt pristine text has sha256 ${sha}, SOURCE.json says ${expected}`);
  pristine[rel] = text;
}
// The fixes, unconditional. Anchors are pristine text.
const FIX = {
  'vendor/webeyetrack/local/utils/mathUtils.ts': [
    [`  // Convert MediaPipeMatrix to ml-matrix format
  const data = matrix.data;
  const translatedMatrix = new Matrix(matrix.rows, matrix.columns);
  for (let i = 0; i < matrix.rows; i++) {
    for (let j = 0; j < matrix.columns; j++) {
      translatedMatrix.set(i, j, data[i * matrix.columns + j]);
    }
  }`, `  // Convert MediaPipeMatrix to ml-matrix format. MediaPipe packs the matrix column-major (MatrixData.layout defaults to
  // COLUMN_MAJOR; the tasks-vision JS wrapper passes the packed list through unchanged, so the translation sits at indices
  // 12-14). Reading it row-major gave the transposed rotation: the head vector carried yaw and pitch with the opposite sign
  // to the Python training pipeline, whose MediaPipe wrapper transposes into a proper 4×4.
  const data = matrix.data;
  const translatedMatrix = new Matrix(matrix.rows, matrix.columns);
  for (let i = 0; i < matrix.rows; i++) {
    for (let j = 0; j < matrix.columns; j++) {
      translatedMatrix.set(i, j, data[j * matrix.rows + i]);
    }
  }`],
    [`    // Step 4: Extract + invert MediaPipe face rotation, convert to euler, flip pitch/yaw, back to rotmat
    const faceR = faceRT.subMatrix(0, 2, 0, 2);
    let [pitch, yaw, roll] = matrixToEuler(faceR);`, `    // Step 4: Extract + invert MediaPipe face rotation, convert to euler, flip pitch/yaw, back to rotmat
    // (python model_based.face_reconstruction: rotation_matrix_to_euler_angles(np.linalg.inv(face_r)); the inverse was
    // implicit while translateMatrix read the matrix transposed, so this keeps the reconstruction unchanged)
    const faceR = faceRT.subMatrix(0, 2, 0, 2);
    let [pitch, yaw, roll] = matrixToEuler(inverse(faceR));`],
  ],
  'vendor/webeyetrack/local/WebEyeTrack.ts': [
    [`    let bestWeights: tf.Tensor[] = [];
    const opt = tf.train.adam(training.lr, 0.85, 0.9, 1e-8);`, `    let bestWeights: tf.Tensor[] = [];
    // The first Dense layer's kernel rows 512-517 multiply the head vector and face origin. With 42 labels taken at one
    // pose those inputs are constants, so Adam drifts the rows to fit the labels and the pretrained pose compensation
    // is lost. Their gradient is zeroed at every step; everything else trains as before.
    const poseKernel = variables.find(v => v.shape.length === 2 && v.shape[0] === 518);
    if (!poseKernel) throw new Error('First Dense kernel [518, n] not found among the trainable variables');
    const poseCols = poseKernel.shape[1] ?? 0;
    const poseMask = tf.tidy(() => tf.concat([tf.ones([512, poseCols]), tf.zeros([6, poseCols])], 0));
    const opt = tf.train.adam(training.lr, 0.85, 0.9, 1e-8);`],
    [`      for (let step = 1; step <= training.steps; step++) {
        const loss = opt.minimize(() => tf.tidy(() => {
          const prediction = applyAffineMatrix(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return training.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(training.l2)).asScalar() : fit;
        }), true, variables);
        if (!loss) throw new Error('Calibration training did not produce a loss');`, `      for (let step = 1; step <= training.steps; step++) {
        const { value: loss, grads } = tf.variableGrads(() => tf.tidy(() => {
          const prediction = applyAffineMatrix(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return training.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(training.l2)).asScalar() : fit;
        }), variables);
        const g = grads[poseKernel.name]; grads[poseKernel.name] = g.mul(poseMask); g.dispose();
        opt.applyGradients(variables.map(v => ({ name: v.name, tensor: grads[v.name] })));
        tf.dispose(grads);
        if (!loss) throw new Error('Calibration training did not produce a loss');`],
    [`      opt.dispose();
    }
  }`, `      opt.dispose(); poseMask.dispose();
    }
  }`],
  ],
};
const fixed = {};
for (const rel of FILES) { let t = pristine[rel]; for (const [from, to] of FIX[rel]) { if (t.split(from).length !== 2) throw new Error(`${rel}: fix anchor not found exactly once:\n${from}`); t = t.replace(from, to); } fixed[rel] = t; }
const tmp = await mkdtemp(path.join(tmpdir(), 'gaze-lab-patch-'));
let diff = '';
for (const rel of FILES) {
  const a = path.join(tmp, 'a', APP, rel), b = path.join(tmp, 'b', APP, rel);
  await mkdir(path.dirname(a), { recursive: true }); await mkdir(path.dirname(b), { recursive: true });
  await writeFile(a, pristine[rel]); await writeFile(b, fixed[rel]);
  // Paths with a space are quoted as git does, so `git apply` reads them.
  const r = spawnSync('diff', ['-u', '--label', `"a/${APP}/${rel}"`, '--label', `"b/${APP}/${rel}"`, a, b], { encoding: 'utf8' });
  if (r.status !== 1) throw new Error(`diff for ${rel} returned ${r.status}: ${r.stderr}`);
  diff += r.stdout;
}
const header = `Clarte eye tracking: two candidate fixes to the vendored WebEyeTrack pipeline (prototypes/Eye Tracking)
=====================================================================================================

Generated by gaze-lab/scripts/make-fixes-patch.mjs from the gaze-lab copies of the files at Clarte commit
${source.commit} (SOURCE.json). Review material only: apply with
  git apply --check gaze-lab/patches/clarte-eye-tracking-fixes.patch   (from the Clarte repo root)
Nothing here has been applied anywhere.

1. Face transformation matrix layout (mathUtils.ts translateMatrix, faceReconstruction). MediaPipe's
   facialTransformationMatrixes[0].data is column-major (translation at indices 12-14; MatrixData.layout defaults to
   COLUMN_MAJOR and the tasks-vision JS wrapper copies the packed list unchanged). translateMatrix read it row-major, so
   every consumer saw the transposed (= inverse) rotation: getHeadVector fed BlazeGaze the rotation's third ROW instead
   of the face's forward axis (yaw and pitch sign-flipped versus the Python training pipeline, model_based.get_head_vector).
   faceReconstruction consumed the same transposed matrix where Python uses np.linalg.inv(face_r), so it was already
   equivalent to Python; the explicit inverse keeps it so (verified: identical metric face to 1e-3 cm, the pixel-rounding
   floor of refineDepthByRadialMagnitude). geometric-gaze.ts and pose-normalize.ts already read the data column-major and
   are untouched.

2. Frozen pose input columns during calibration (WebEyeTrack.ts adapt). The first Dense layer's kernel rows 512-517 take
   the head vector and face origin; with 42 labels at one pose those inputs are constant and Adam uses the rows as free
   bias, erasing the pretrained pose compensation. The gradient of those rows is zeroed before every Adam step
   (tf.variableGrads + masked applyGradients; otherwise the same loss, optimizer, hold-out and early stopping).

REQUIRED WITH FIX 1: bump MODEL_VERSION in src/core/saved-calibration.ts (also the base of team models, team-model.ts).
Saved calibrations and team models were fitted against the old head vector; with the corrected vector they are wrong at
any head pose and must be invalidated, not migrated. Regenerate vendor/webeyetrack/LOCAL-ADAPTATIONS.patch after applying.

Measured (one tester, two recorded sessions replayed offline): see gaze-lab/REPLAY-FIXES-REPORT.md. Nothing is proven
beyond that one tester.

`;
await mkdir(path.join(LAB, 'patches'), { recursive: true });
const file = path.join(LAB, 'patches/clarte-eye-tracking-fixes.patch');
await writeFile(file, header + diff);
// Dry run against the rebuilt pristine tree (git apply understands the quoted paths).
const check = spawnSync('git', ['apply', '--check', '--verbose', file], { cwd: path.join(tmp, 'a'), encoding: 'utf8' });
if (check.status !== 0) throw new Error(`git apply --check failed: ${check.stdout}${check.stderr}`);
console.log(`git apply --check against the rebuilt pristine files: ok\n${check.stderr.trim()}`);
console.log(`wrote ${file} (${diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length} added, ${diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length} removed lines)`);
