#!/usr/bin/env node
// Network re-run with corrected head vectors and pose-column freezing.
//
//   node analysis/rerun_head.mjs <session_dir> [--out <dir>] [--port 4335] [--export "<variant name>"]...
//
// --export (repeatable) also writes candidate-<slug>.json (GAZE-LAB-CANDIDATE-1) into the output folder for that
// variant: `head` is a LearnedCalibration built as exportCalibration() builds it (the six trainable tensors in
// model.trainableWeights order = ESTIMATOR_SHAPES, flattened row-major like Array.from(dataSync()); the final 2×3 affine
// as 6 numbers; faceWidthCm and geometric copied from the session's calibration.json so the shadow worker blends with the
// same geometric state and weight), with geometric/blend/correction null. Only the `recorded` head-vector variants can be
// exported: the shipped worker computes the head vector itself (row-major read), so a column-major head would see
// different inputs at run time. The exported weights are re-loaded in the page and their forward pass compared with the
// variant's own predictions (max |Δ| reported as the export fidelity).
//
// Inputs: eyestrips/*.png + eyestrips/replay.json (labelled calibration frames and block record frames with their
// recorded headVector, faceOrigin3D, faceRt and the worker's rawNormPog), the shipped model public/vendor/webeyetrack/
// web/model.json, calibration.json (the learned head and affine), session.json and frames.jsonl (usable-frame filter and
// final attempt per block, as analysis/analyze.py). Everything TFJS runs in headless Chromium on WebGL, the backend the
// harness used, on a loopback port from 4335-4338; the page loads @tensorflow/tfjs and ml-matrix (for the exact
// computeAffineMatrixML SVD solve) from node_modules.
//
// Steps: encode every strip once with the frozen cnn_encoder (dev/team-training.ts path); fidelity checks F1-F3; then
// WebEyeTrack.adapt reproduced (support set, hold-out of the last sample per dot, Adam 3e-3 β1 .85 β2 .9 ε 1e-8, 200
// steps, evalEvery 10, patience 6, final affine via computeAffineMatrixML) for every variant:
// head vector {recorded, column-major recompute} × pose input columns of the first Dense layer {trainable, frozen: kernel
// gradient rows 512-517 zeroed} × l2 {0, 1e-3}, plus steps 0 (affine only) per head variant. Each variant is scored per
// block on the usable record frames (record phase, face present, eyes open, final attempt): median px, median |dx|, |dy|,
// median signed bias, p90 (CSS px of the recorded viewport), and row accuracy with rows.py's fixed boundary (score-fixed).
// Output: rerun_head.md, rerun_head.json, rerun_head_calibration.json (the shipped trained head's estimates on the
// calibration frames, for rows.py's personal boundaries).
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serveStatic } from '../scripts/lib/static-server.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = [4335, 4336, 4337, 4338];
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith('--')) { console.error('usage: node analysis/rerun_head.mjs <session_dir> [--out <dir>] [--port 4335] [--export "<variant name>"]...'); process.exit(1); }
const sessionDir = path.resolve(args[0]);
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : sessionDir;
const forcedPort = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : null;
const exportNames = args.map((a, i) => (a === '--export' ? args[i + 1] : null)).filter(n => typeof n === 'string');
// Mirror of src/core/saved-calibration.ts ESTIMATOR_SHAPES: the six trainable gaze_mlp tensors, in model.trainableWeights order.
const ESTIMATOR_SHAPES = [[518, 16], [16], [16, 16], [16], [16, 2], [2]];
const CANDIDATE_FORMAT = 'GAZE-LAB-CANDIDATE-1';
const slugOf = name => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');

const replayFile = path.join(sessionDir, 'eyestrips', 'replay.json');
if (!existsSync(replayFile)) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'rerun_head.md'), `# Network re-run · not run\n\nNo eyestrips/replay.json in ${sessionDir} (strips off, or a demo session without a worker): nothing to re-run.\n`);
  console.log('no eyestrips/replay.json: nothing to re-run'); process.exit(0);
}
const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
const replay = JSON.parse(await readFile(replayFile, 'utf8'));
const learned = existsSync(path.join(sessionDir, 'calibration.json')) ? JSON.parse(await readFile(path.join(sessionDir, 'calibration.json'), 'utf8')) : null;
const frames = (await readFile(path.join(sessionDir, 'frames.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
const byAt = new Map(frames.map(r => [r.t, r]));
const viewport = session.viewport, W = viewport.width, H = viewport.height;
const finalKeys = new Map(session.blocks.filter(b => b.status === 'complete').map(b => [b.key, b]));
const synthetic = Boolean(session.demo) || /e2e/i.test(session.tester ?? '');
// Usable record frames of final attempts, joined to the replay entries by the frame clock.
const entries = replay.entries.map((e, i) => ({ ...e, index: i, frame: byAt.get(e.at) ?? null }));
const calibration = entries.filter(e => e.kind === 'calibration');
const check = entries.filter(e => e.kind === 'check' && e.frame && e.frame.phase === 'record' && e.frame.facePresent && e.frame.eyeState === 'open' && finalKeys.has(e.block));
console.log(`${entries.length} strips: ${calibration.length} calibration, ${check.length} usable record frames of final attempts (${entries.filter(e => e.kind === 'check').length} check strips in the file)`);

async function freePort() {
  for (const port of forcedPort ? [forcedPort] : PORTS) {
    const ok = await new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (ok) return port;
  }
  throw new Error(`no free port in ${PORTS.join(', ')}`);
}
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>gaze-lab rerun</title><script src="/tf.min.js"></script><script src="/matrix.umd.js"></script></head><body></body></html>';
const served = await serveStatic({ roots: [path.join(LAB, 'public'), path.join(LAB, 'node_modules/@tensorflow/tfjs/dist'), path.join(LAB, 'node_modules/ml-matrix'), path.join(sessionDir, 'eyestrips')], pages: { '/index.html': PAGE }, port: await freePort() });
console.log(`serving on ${served.origin}`);

// Head-vector ports (mirrors analysis/headvector.py): row-major read = the shipped translateMatrix; column-major = corrected.
const headVectorFrom = (d, read) => {
  const M = (i, j) => (read === 'row-major' ? d[i * 4 + j] : d[j * 4 + i]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -M(2, 0)))), yaw = Math.atan2(M(2, 1), M(2, 2)), roll = Math.atan2(M(1, 0), M(0, 0));
  const [p, y, r] = [-yaw, pitch, roll];
  const x = Math.cos(p) * Math.sin(y), yy = Math.sin(p), z = -Math.cos(p) * Math.cos(y);
  return [Math.cos(r) * x - Math.sin(r) * yy, Math.sin(r) * x + Math.cos(r) * yy, z];
};
const headInputFidelity = Math.max(...entries.map(e => Math.max(...headVectorFrom(e.faceRt, 'row-major').map((v, i) => Math.abs(v - e.headVector[i])))));
console.log(`recorded headVector vs row-major port of getHeadVector: max |Δ| = ${headInputFidelity.toExponential(2)}`);

const VARIANTS = [];
for (const head of ['recorded', 'column-major']) {
  VARIANTS.push({ name: `${head} · affine only (steps 0)`, head, freezePose: false, l2: 0, steps: 0 });
  for (const freezePose of [false, true]) for (const l2 of [0, 1e-3]) VARIANTS.push({ name: `${head} · pose ${freezePose ? 'frozen' : 'trainable'} · l2 ${l2}`, head, freezePose, l2, steps: 200 });
}
const trainingOptions = (session.calibration?.trainingReport?.options) ?? { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 };
const BASELINE = VARIANTS.find(v => v.head === 'recorded' && !v.freezePose && v.l2 === 0 && v.steps === 200);
const EXPORTS = [...new Set(exportNames)].map(name => {
  const v = VARIANTS.find(x => x.name === name);
  if (!v) throw new Error(`--export: unknown variant "${name}". Variants:\n  ${VARIANTS.map(x => x.name).join('\n  ')}`);
  if (v.head !== 'recorded') throw new Error(`--export: "${name}" cannot be loaded by the harness: the shipped worker computes the head vector itself (row-major read), so only the "recorded" variants are exportable.`);
  return v;
});
if (EXPORTS.length && !learned) throw new Error('--export needs the session\'s calibration.json (faceWidthCm and geometric state are copied from it).');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[rerun]')) console.log('  ', m.text()); });
  await page.goto(served.origin + '/');
  const payload = {
    entries: entries.map(e => ({ file: e.file, kind: e.kind, label: e.label, headVector: e.headVector, headVectorColumnMajor: headVectorFrom(e.faceRt, 'column-major'), faceOrigin3D: e.faceOrigin3D, rawNormPog: e.rawNormPog })),
    calibrationIndices: calibration.map(e => e.index), checkIndices: check.map(e => e.index),
    learned: learned ? { weights: learned.learned.weights, affine: learned.learned.affine } : null,
    options: trainingOptions,
    variants: VARIANTS, baseline: BASELINE.name,
    exports: EXPORTS.map(v => v.name), estimatorShapes: ESTIMATOR_SHAPES,
  };
  result = await page.evaluate(async (P) => {
    const log = (...a) => console.log('[rerun]', ...a);
    await tf.setBackend('webgl'); await tf.ready();
    const model = await tf.loadLayersModel('/vendor/webeyetrack/web/model.json');
    const encoder = model.getLayer('cnn_encoder'), head = model.getLayer('gaze_mlp');
    encoder.trainable = false;
    const variables = model.trainableWeights.map(w => w.read());
    const initial = variables.map(v => v.clone());
    const kernel = variables.findIndex(v => v.shape.length === 2 && v.shape[0] === 518);
    if (kernel < 0) throw new Error('first Dense kernel [518,16] not found among the trainable variables');
    if (JSON.stringify(variables.map(v => v.shape)) !== JSON.stringify(P.estimatorShapes)) throw new Error(`trainable variables ${JSON.stringify(variables.map(v => v.shape))} do not match ESTIMATOR_SHAPES ${JSON.stringify(P.estimatorShapes)}`);
    // 1. Encode every strip once (batches of 8, as dev/team-training.ts).
    const features = [];
    const t0 = performance.now();
    for (let start = 0; start < P.entries.length; start += 8) {
      const slice = P.entries.slice(start, start + 8);
      const bitmaps = await Promise.all(slice.map(async e => createImageBitmap(await (await fetch('/' + e.file)).blob())));
      const f = tf.tidy(() => encoder.predict(tf.stack(bitmaps.map(b => tf.browser.fromPixels(b))).toFloat().div(255)));
      const rows = await f.array(); f.dispose(); bitmaps.forEach(b => b.close());
      rows.forEach(r => features.push(r));
      if (start % 200 === 0) log(`encoded ${Math.min(start + 8, P.entries.length)}/${P.entries.length}`);
    }
    const encodeMs = performance.now() - t0;
    const F = tf.tensor2d(features);
    const headT = { recorded: tf.tensor2d(P.entries.map(e => e.headVector), [P.entries.length, 3]), 'column-major': tf.tensor2d(P.entries.map(e => e.headVectorColumnMajor), [P.entries.length, 3]) };
    const O = tf.tensor2d(P.entries.map(e => e.faceOrigin3D), [P.entries.length, 3]);
    const pick = (t, rows) => (rows ? tf.gather(t, rows) : t);
    const predictHead = (headMode, rows) => tf.tidy(() => head.predict([pick(F, rows), pick(headT[headMode], rows), pick(O, rows)]));
    const applyAffine = (A, V) => tf.tidy(() => { const r = V.reshape([-1, 2]); const h = tf.concat([r, tf.ones([r.shape[0], 1])], 1); return tf.matMul(h, A.transpose()).reshape(V.shape); });
    const computeAffineMatrixML = (src, dst) => { const X = new mlMatrix.Matrix(src.map(r => [...r, 1])), Y = new mlMatrix.Matrix(dst); return mlMatrix.solve(X, Y, true).transpose().to2DArray(); };
    const assign = (values) => tf.tidy(() => variables.forEach((v, i) => v.assign(values[i] instanceof tf.Tensor ? values[i] : tf.tensor(values[i], v.shape))));
    const maxAbs = (a, b) => Math.max(...a.map((r, i) => Math.max(...r.map((v, j) => Math.abs(v - b[i][j])))));
    const predictRows = async (headMode, rows, A) => { const p = predictHead(headMode, rows); const q = A ? applyAffine(A, p) : p; const out = await q.array(); p.dispose(); if (A) q.dispose(); return out; };
    const cal = P.calibrationIndices, chk = P.checkIndices;
    const labelsOf = rows => rows.map(i => P.entries[i].label);
    // 2. Fidelity. F1: pretrained head, no affine, on the calibration strips vs the worker's pre-training rawNormPog.
    assign(initial);
    const f1 = await predictRows('recorded', cal, null);
    const F1 = maxAbs(f1, cal.map(i => P.entries[i].rawNormPog));
    // F2: the learned head + affine from calibration.json on the usable record strips vs the recorded network estimate.
    let F2 = null, calibrationPredictions = null;
    if (P.learned) {
      assign(P.learned.weights);
      const A = tf.tensor2d(P.learned.affine, [2, 3]);
      const f2 = await predictRows('recorded', chk, A);
      F2 = maxAbs(f2, chk.map(i => P.entries[i].rawNormPog));
      const calPred = await predictRows('recorded', cal, A);
      calibrationPredictions = cal.map((i, k) => [i, calPred[k]]);
      A.dispose();
    }
    // 3. adapt() reproduced.
    async function adapt(headMode, opts) {
      assign(initial);
      const labels = labelsOf(cal);
      const groups = new Map(); labels.forEach((l, i) => { const k = l.join(','); groups.set(k, [...(groups.get(k) ?? []), i]); });
      const holdout = opts.holdout && opts.steps > 0 && groups.size >= 6 && [...groups.values()].every(g => g.length >= 2);
      const held = holdout ? [...groups.values()].map(g => g[g.length - 1]) : [];
      const heldSet = new Set(held);
      const trainLocal = holdout ? labels.map((_, i) => i).filter(i => !heldSet.has(i)) : null;
      const toGlobal = local => (local ? local.map(i => cal[i]) : cal);
      const fitAffine = async local => computeAffineMatrixML(await predictRows(headMode, toGlobal(local), null), local ? local.map(i => labels[i]) : labels);
      let A = tf.tensor2d(await fitAffine(trainLocal), [2, 3]);
      const trainLabels = tf.tensor2d(trainLocal ? trainLocal.map(i => labels[i]) : labels);
      const heldLabels = held.length ? tf.tensor2d(held.map(i => labels[i])) : null;
      const heldRows = toGlobal(held), trainRows = toGlobal(trainLocal);
      const heldLoss = async () => { if (!heldLabels) return NaN; const t = tf.tidy(() => tf.losses.meanSquaredError(heldLabels, applyAffine(A, predictHead(headMode, heldRows))).asScalar()); const v = (await t.data())[0]; t.dispose(); return v; };
      const opt = tf.train.adam(opts.lr, 0.85, 0.9, 1e-8);
      const before = await heldLoss();
      let best = before, bestStep = 0, since = 0, stepsUsed = 0;
      let bestWeights = variables.map(v => v.clone());
      const mask = opts.freezePose ? tf.tidy(() => tf.concat([tf.ones([512, variables[kernel].shape[1]]), tf.zeros([6, variables[kernel].shape[1]])], 0)) : null;
      for (let step = 1; step <= opts.steps; step++) {
        const { value, grads } = tf.variableGrads(() => tf.tidy(() => {
          const prediction = applyAffine(A, predictHead(headMode, trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return opts.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(opts.l2)).asScalar() : fit;
        }), variables);
        if (mask) { const g = grads[variables[kernel].name]; grads[variables[kernel].name] = g.mul(mask); g.dispose(); }
        opt.applyGradients(variables.map(v => ({ name: v.name, tensor: grads[v.name] })));
        const lossValue = (await value.data())[0]; value.dispose(); tf.dispose(grads);
        if (!Number.isFinite(lossValue)) throw new Error('training diverged');
        stepsUsed = step;
        if (holdout && (step % opts.evalEvery === 0 || step === opts.steps)) {
          const current = await heldLoss();
          if (current < best) { best = current; bestStep = step; tf.dispose(bestWeights); bestWeights = variables.map(v => v.clone()); since = 0; }
          else if (++since >= opts.patience) break;
        }
      }
      if (holdout) assign(bestWeights);
      A.dispose(); A = tf.tensor2d(await fitAffine(null), [2, 3]);
      const report = { samples: labels.length, heldOut: held.length, stepsUsed, bestStep: holdout ? bestStep : stepsUsed, heldOutBefore: before, heldOutAfter: best };
      const checkPred = await predictRows(headMode, chk, A), calPred = await predictRows(headMode, cal, A);
      // What exportCalibration() would return for this head: Array.from(variable.dataSync()) per trainable tensor, Array.from(affine.dataSync()).
      const exported = opts.export ? { weights: variables.map(v => Array.from(v.dataSync())), affine: Array.from(A.dataSync()) } : null;
      trainLabels.dispose(); heldLabels?.dispose(); A.dispose(); opt.dispose(); tf.dispose(bestWeights); mask?.dispose();
      return { report, checkPred, calPred, exported };
    }
    const variants = {};
    for (const v of P.variants) {
      const t1 = performance.now();
      variants[v.name] = await adapt(v.head, { ...P.options, steps: v.steps, l2: v.l2, freezePose: v.freezePose, export: P.exports.includes(v.name) });
      variants[v.name].ms = performance.now() - t1;
      log(`${v.name}: ${JSON.stringify(variants[v.name].report)} in ${(variants[v.name].ms / 1000).toFixed(1)} s`);
    }
    // Export fidelity: restore each exported head from its flattened arrays (as restoreEstimator does) and re-run the
    // forward pass + affine on the calibration and the usable record strips; must reproduce the variant's own predictions.
    const exports = {};
    for (const name of P.exports) {
      const { exported, calPred, checkPred } = variants[name];
      const headMode = P.variants.find(v => v.name === name).head;
      assign(exported.weights);
      const A = tf.tensor2d(exported.affine, [2, 3]);
      const cal2 = await predictRows(headMode, cal, A), chk2 = await predictRows(headMode, chk, A);
      A.dispose();
      exports[name] = { ...exported, fidelity: { calibration: maxAbs(cal2, calPred), check: maxAbs(chk2, checkPred) } };
      log(`export ${name}: exported weights vs variant predictions max |Δ| calibration ${exports[name].fidelity.calibration.toExponential(2)}, record ${exports[name].fidelity.check.toExponential(2)}`);
    }
    // F3: the baseline re-run vs the shipped trained head (calibration.json) on the calibration frames.
    let F3 = null, F3control = null;
    if (P.learned) {
      assign(P.learned.weights);
      const A = tf.tensor2d(P.learned.affine, [2, 3]);
      const shipped = await predictRows('recorded', cal, A); A.dispose();
      F3 = maxAbs(variants[P.baseline].calPred, shipped);
      // Control for the comparator: a variant that must differ from the shipped head (column-major head vector).
      const other = P.variants.find(v => v.head === 'column-major' && !v.freezePose && v.l2 === 0 && v.steps > 0);
      if (other) F3control = maxAbs(variants[other.name].calPred, shipped);
    }
    return { backend: tf.getBackend(), encodeMs, F1, F2, F3, F3control, calibrationPredictions, variants, exports, numTensors: tf.memory().numTensors };
  }, payload);
} finally { await browser.close(); await served.close(); }

// ---- scoring per block (ports analyze.py's stats; row accuracy from rows.py score-fixed) ----
const median = v => { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const p90 = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1))] : NaN; };
const toPx = p => [(p[0] + .5) * W, (p[1] + .5) * H];
const blockKeys = [...finalKeys.keys()].filter(k => check.some(e => e.block === k));
const scoreFixedInput = { h: H, streams: {} };
const perVariant = {};
for (const [name, v] of Object.entries(result.variants)) {
  perVariant[name] = { report: v.report, ms: v.ms, blocks: {} };
  for (const k of blockKeys) {
    const idx = check.map((e, i) => (e.block === k ? i : -1)).filter(i => i >= 0);
    const d = idx.map(i => { const p = toPx(v.checkPred[i]), t = check[i].frame.target; return [p[0] - t.x, p[1] - t.y]; });
    const e = d.map(([x, y]) => Math.hypot(x, y));
    perVariant[name].blocks[k] = { frames: idx.length, median_px: median(e), abs_dx_px: median(d.map(x => Math.abs(x[0]))), abs_dy_px: median(d.map(x => Math.abs(x[1]))), bias_dx_px: median(d.map(x => x[0])), bias_dy_px: median(d.map(x => x[1])), p90_px: p90(e) };
    scoreFixedInput.streams[`${name}|${k}`] = idx.map(i => [check[i].at, toPx(v.checkPred[i])[1], check[i].frame.target.ny]);
  }
}
// The recorded network stream on the same frames, for reference.
perVariant['recorded network (shipped run)'] = { report: session.calibration?.trainingReport ?? null, blocks: {} };
for (const k of blockKeys) {
  const idx = check.map((e, i) => (e.block === k ? i : -1)).filter(i => i >= 0);
  const d = idx.map(i => { const p = toPx(check[i].rawNormPog), t = check[i].frame.target; return [p[0] - t.x, p[1] - t.y]; });
  const e = d.map(([x, y]) => Math.hypot(x, y));
  perVariant['recorded network (shipped run)'].blocks[k] = { frames: idx.length, median_px: median(e), abs_dx_px: median(d.map(x => Math.abs(x[0]))), abs_dy_px: median(d.map(x => Math.abs(x[1]))), bias_dx_px: median(d.map(x => x[0])), bias_dy_px: median(d.map(x => x[1])), p90_px: p90(e) };
  scoreFixedInput.streams[`recorded network (shipped run)|${k}`] = idx.map(i => [check[i].at, toPx(check[i].rawNormPog)[1], check[i].frame.target.ny]);
}
await mkdir(outDir, { recursive: true });
const scoreFile = path.join(outDir, 'rerun_head_rows_input.json');
await writeFile(scoreFile, JSON.stringify(scoreFixedInput));
const py = spawnSync(path.join(LAB, '.venv/bin/python'), ['-I', path.join(LAB, 'analysis/rows.py'), 'score-fixed', sessionDir, scoreFile], { encoding: 'utf8' });
if (py.status !== 0) throw new Error(`rows.py score-fixed failed: ${py.stderr}`);
const rowAcc = JSON.parse(py.stdout);
await unlink(scoreFile);
for (const [name, v] of Object.entries(perVariant)) for (const k of blockKeys) v.blocks[k].row_accuracy_fixed = rowAcc[`${name}|${k}`]?.row_accuracy_fixed ?? null;

// ---- reports ----
const tr = session.calibration?.trainingReport ?? null;
const fmt = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const L = [];
L.push(`# Network re-run · ${session.id}`, '');
if (synthetic) L.push('**Synthetic session** (photo camera or demo stream): fidelity numbers are real, accuracy numbers mean nothing.', '');
L.push(`Strips: ${entries.length} (${calibration.length} calibration, ${check.length} usable record frames of final attempts). TFJS backend ${result.backend} in headless Chromium; encoder time ${(result.encodeMs / 1000).toFixed(1)} s. Frames: record-phase frames with a face present and eyes open, final attempt per block (replay strips joined to frames.jsonl by the frame clock). Units: CSS px of the ${W}×${H} viewport; row accuracy with rows.py's fixed boundary at the screen midline.`, '');
L.push('## Fidelity', '');
L.push(`- Inputs: recorded headVector vs the row-major port of getHeadVector on the recorded faceRt: max |Δ| = ${headInputFidelity.toExponential(2)} (the shipped path is the row-major read; the column-major variant below is the corrected forward-axis vector).`);
L.push(`- F1 pretrained head, no affine, on the ${calibration.length} calibration strips vs the worker's pre-training rawNormPog (the recorded \`network\` on those frames): max |Δ| = ${result.F1.toExponential(2)} normalized units (${(result.F1 * Math.max(W, H)).toFixed(3)} px). This proves the strips, the encoder and the head forward pass reproduce the harness.`);
L.push(result.F2 === null ? '- F2 skipped: no calibration.json.' : `- F2 learned head + affine from calibration.json on the ${check.length} usable record strips vs the recorded \`network\` estimate: max |Δ| = ${result.F2.toExponential(2)} normalized units (${(result.F2 * Math.max(W, H)).toFixed(3)} px): the inference path after training is reproduced.`);
const base = result.variants[BASELINE.name].report;
L.push(`- F3 adapt() re-run with {recorded head, pose trainable, l2 0} vs the shipped trained head on the calibration frames: max |Δ| = ${result.F3 === null ? '—' : result.F3.toExponential(2)} normalized units${result.F3 === null ? '' : ` (${(result.F3 * Math.max(W, H)).toFixed(2)} px)`}. Training report re-run vs recorded: heldOutBefore ${base.heldOutBefore.toFixed(6)} vs ${tr ? tr.heldOutBefore.toFixed(6) : '—'} (Δ ${tr ? Math.abs(base.heldOutBefore - tr.heldOutBefore).toExponential(1) : '—'}), heldOutAfter ${base.heldOutAfter.toFixed(6)} vs ${tr ? tr.heldOutAfter.toFixed(6) : '—'}, bestStep ${base.bestStep} vs ${tr?.bestStep ?? '—'}, stepsUsed ${base.stepsUsed} vs ${tr?.stepsUsed ?? '—'}, heldOut ${base.heldOut} vs ${tr?.heldOut ?? '—'}. Comparator control: the column-major variant vs the shipped head on the same frames = ${result.F3control === null ? '—' : result.F3control.toExponential(2)} (must be far from zero, otherwise the comparison is not live). A non-zero F3 with F1 = F2 = 0 would mean the WebGL training path is not bit-reproducible (reduction order), not a bug.`);
L.push('');
L.push('## Training reports per variant', '', '| variant | heldOutBefore | heldOutAfter | bestStep | stepsUsed | time s |', '|---|---|---|---|---|---|');
for (const [name, v] of Object.entries(result.variants)) L.push(`| ${name} | ${v.report.heldOutBefore.toFixed(5)} | ${v.report.heldOutAfter.toFixed(5)} | ${v.report.bestStep} | ${v.report.stepsUsed} | ${(v.ms / 1000).toFixed(1)} |`);
L.push('');
for (const k of blockKeys) {
  const b = finalKeys.get(k);
  L.push(`## ${b.id} ${b.title} · ${perVariant[BASELINE.name].blocks[k].frames} usable frames`, '');
  L.push('| variant | median px | median \\|dx\\| | median \\|dy\\| | bias dx | bias dy | p90 px | row acc (fixed) |', '|---|---|---|---|---|---|---|---|');
  for (const [name, v] of Object.entries(perVariant)) { const s = v.blocks[k]; L.push(`| ${name} | ${fmt(s.median_px)} | ${fmt(s.abs_dx_px)} | ${fmt(s.abs_dy_px)} | ${s.bias_dx_px >= 0 ? '+' : ''}${fmt(s.bias_dx_px)} | ${s.bias_dy_px >= 0 ? '+' : ''}${fmt(s.bias_dy_px)} | ${fmt(s.p90_px)} | ${s.row_accuracy_fixed === null ? '—' : (100 * s.row_accuracy_fixed).toFixed(0) + ' %'} |`); }
  L.push('');
}
// ---- exported candidates (--export) ----
const candidateFiles = [];
for (const v of EXPORTS) {
  const ex = result.exports[v.name];
  const file = path.join(outDir, `candidate-${slugOf(v.name)}.json`);
  const candidate = {
    format: CANDIDATE_FORMAT, name: `rerun_head · ${v.name}`, createdFrom: session.id, model: learned.model ?? null,
    variant: { name: v.name, headVector: v.head, freezePose: v.freezePose, l2: v.l2, steps: v.steps, options: trainingOptions },
    trainingReport: result.variants[v.name].report,
    exportFidelity: { description: 'max |Δ| (normalized units) between the forward pass from the exported weights + affine and the variant\'s own predictions in the re-run', calibrationStrips: ex.fidelity.calibration, recordStrips: ex.fidelity.check },
    geometric: null, blend: null, correction: null,
    head: { weights: ex.weights, affine: ex.affine, faceWidthCm: learned.learned.faceWidthCm, geometric: learned.learned.geometric ?? null },
  };
  await writeFile(file, JSON.stringify(candidate) + '\n');
  candidateFiles.push({ variant: v.name, file, fidelity: ex.fidelity });
}
if (candidateFiles.length) {
  L.push('## Exported candidates', '', 'Each `head` = the variant\'s six tensors + final affine in the saved-calibration layout, `faceWidthCm` and `geometric` copied from calibration.json. Fidelity = max |Δ| between the forward pass from the exported arrays and the variant\'s predictions above (normalized units).', '');
  for (const c of candidateFiles) L.push(`- ${c.variant} → \`${path.basename(c.file)}\` · fidelity calibration ${c.fidelity.calibration.toExponential(2)}, record ${c.fidelity.check.toExponential(2)}`);
  L.push('');
}
await writeFile(path.join(outDir, 'rerun_head.md'), L.join('\n') + '\n');
await writeFile(path.join(outDir, 'rerun_head.json'), JSON.stringify({ session: session.id, synthetic, backend: result.backend, encodeMs: result.encodeMs, fidelity: { headVectorRowMajorPort: headInputFidelity, F1: result.F1, F2: result.F2, F3: result.F3, F3control: result.F3control, recordedTrainingReport: tr }, variants: perVariant, frames: { calibration: calibration.length, check: check.length }, numTensors: result.numTensors }, null, 1) + '\n');
if (result.calibrationPredictions) {
  const cal = Object.fromEntries(result.calibrationPredictions.map(([i, p]) => [String(entries[i].at), p]));
  await writeFile(path.join(outDir, 'rerun_head_calibration.json'), JSON.stringify({ source: 'calibration.json learned head + affine (the shipped trained network) on the calibration strips', calibration: cal }) + '\n');
}
console.log(`F1 ${result.F1.toExponential(2)} · F2 ${result.F2 === null ? '—' : result.F2.toExponential(2)} · F3 ${result.F3 === null ? '—' : result.F3.toExponential(2)} · wrote ${path.join(outDir, 'rerun_head.md')}, rerun_head.json${result.calibrationPredictions ? ', rerun_head_calibration.json' : ''}`);
for (const c of candidateFiles) console.log(`exported ${c.variant} → ${c.file} (fidelity calibration ${c.fidelity.calibration.toExponential(2)}, record ${c.fidelity.check.toExponential(2)})`);
