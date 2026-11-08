#!/usr/bin/env node
// Calibration budget · network side. Retrains the shipped gaze head on simulated short calibrations.
//
//   node analysis/budget.mjs <session_dir> [--designs <file>] [--out <file>] [--port 4334]
//
// Input: <session>/budget_designs.json written by analysis/budget.py:
//   { designs: [{ name, frames: [{ at, label: [nx, ny] }] }] }
// Every design frame must be an eye strip in eyestrips/replay.json (joined by the frame clock `at`); frames without a
// strip are dropped and counted. Output <session>/budget_network.json:
//   { backend, encodeMs, F1, checkAts: [at...], designs: { name: { frames, dropped, dots, variants: { shipped|frozen: {
//       report, ms, check: [[x, y]...] (aligned to checkAts), lodo: { dotKey: { ats, pred, labels, ms } } } } } } }
// `check` = predictions (final affine applied) on every usable record strip of every final-attempt block, B1 included
// (budget.py excludes the blocks a design was drawn from). `lodo` = leave-one-dot-out re-trainings for the blend weight:
// the head is re-trained without one dot and predicts that dot's frames.
//
// The training path is analysis/rerun_head.mjs's reproduction of WebEyeTrack.adapt (bit-exact on the shipped run to the
// WebGL reduction-order floor): support set, hold-out of the last sample per dot when >= 6 dots all have >= 2 samples,
// Adam 3e-3 β1 .85 β2 .9 ε 1e-8, 200 steps, evalEvery 10, patience 6, final 2×3 affine via ml-matrix's SVD solve.
// `shipped` trains every head weight; `frozen` zeroes the gradient of kernel rows 512-517 (head vector + face origin
// inputs of the first Dense layer), the `fixFreezePose` path. Head vector = the recorded one (what the shipped worker
// computes). Everything TFJS runs in headless Chromium on WebGL (SwiftShader) on loopback port 4334 only.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { serveStatic } from '../scripts/lib/static-server.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith('--')) { console.error('usage: node analysis/budget.mjs <session_dir> [--designs <file>] [--out <file>] [--port 4334]'); process.exit(1); }
const sessionDir = path.resolve(args[0]);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const designsFile = path.resolve(opt('--designs', path.join(sessionDir, 'budget_designs.json')));
const outFile = path.resolve(opt('--out', path.join(sessionDir, 'budget_network.json')));
const PORT = Number(opt('--port', 4334));
const ESTIMATOR_SHAPES = [[518, 16], [16], [16, 16], [16], [16, 2], [2]];

const replayFile = path.join(sessionDir, 'eyestrips', 'replay.json');
if (!existsSync(replayFile)) { console.error(`no ${replayFile}: this session has no eye strips, network re-training is not possible`); process.exit(2); }
const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
const replay = JSON.parse(await readFile(replayFile, 'utf8'));
const designs = JSON.parse(await readFile(designsFile, 'utf8')).designs;
const frames = (await readFile(path.join(sessionDir, 'frames.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
const byAt = new Map(frames.map(r => [r.t, r]));
const finalKeys = new Set(session.blocks.filter(b => b.status === 'complete').map(b => b.key));
const entries = replay.entries.map((e, i) => ({ ...e, index: i, frame: byAt.get(e.at) ?? null }));
const entryByAt = new Map(entries.map(e => [e.at, e]));
const calibration = entries.filter(e => e.kind === 'calibration');
const check = entries.filter(e => e.kind === 'check' && e.frame && e.frame.phase === 'record' && e.frame.facePresent && e.frame.eyeState === 'open' && finalKeys.has(e.block));
console.log(`${entries.length} strips: ${calibration.length} calibration, ${check.length} usable record frames of final attempts; ${designs.length} designs`);

const designRows = designs.map(d => {
  const rows = [], labels = [];
  let dropped = 0;
  for (const f of d.frames) {
    const e = entryByAt.get(f.at);
    if (!e) { dropped++; continue; }
    rows.push(e.index); labels.push(f.label);
  }
  const dots = new Set(labels.map(l => l.join(','))).size;
  console.log(`  ${d.name}: ${rows.length} frames on ${dots} dots${dropped ? ` (${dropped} without a strip, dropped)` : ''}`);
  return { name: d.name, rows, labels, dropped, dots };
});

const portFree = await new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(PORT, '127.0.0.1', () => s.close(() => resolve(true))); });
if (!portFree) { console.error(`port ${PORT} is busy; this script uses only ${PORT} and never frees ports itself`); process.exit(3); }
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>gaze-lab budget</title><script src="/tf.min.js"></script><script src="/matrix.umd.js"></script></head><body></body></html>';
const served = await serveStatic({ roots: [path.join(LAB, 'public'), path.join(LAB, 'node_modules/@tensorflow/tfjs/dist'), path.join(LAB, 'node_modules/ml-matrix'), path.join(sessionDir, 'eyestrips')], pages: { '/index.html': PAGE }, port: PORT });
console.log(`serving on ${served.origin}`);
const trainingOptions = (session.calibration?.trainingReport?.options) ?? { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 };

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[budget]')) console.log('  ', m.text()); });
  await page.goto(served.origin + '/');
  const payload = {
    entries: entries.map(e => ({ file: e.file, headVector: e.headVector, faceOrigin3D: e.faceOrigin3D, rawNormPog: e.rawNormPog, label: e.label })),
    calibrationIndices: calibration.map(e => e.index), checkIndices: check.map(e => e.index),
    designs: designRows, options: trainingOptions, estimatorShapes: ESTIMATOR_SHAPES,
  };
  result = await page.evaluate(async (P) => {
    const log = (...a) => console.log('[budget]', ...a);
    await tf.setBackend('webgl'); await tf.ready();
    const model = await tf.loadLayersModel('/vendor/webeyetrack/web/model.json');
    const encoder = model.getLayer('cnn_encoder'), head = model.getLayer('gaze_mlp');
    encoder.trainable = false;
    const variables = model.trainableWeights.map(w => w.read());
    const initial = variables.map(v => v.clone());
    const kernel = variables.findIndex(v => v.shape.length === 2 && v.shape[0] === 518);
    if (kernel < 0) throw new Error('first Dense kernel [518,16] not found');
    if (JSON.stringify(variables.map(v => v.shape)) !== JSON.stringify(P.estimatorShapes)) throw new Error('trainable variables do not match ESTIMATOR_SHAPES');
    // Encode every strip once (batches of 8, as dev/team-training.ts).
    const features = [];
    const t0 = performance.now();
    for (let start = 0; start < P.entries.length; start += 8) {
      const slice = P.entries.slice(start, start + 8);
      const bitmaps = await Promise.all(slice.map(async e => createImageBitmap(await (await fetch('/' + e.file)).blob())));
      const f = tf.tidy(() => encoder.predict(tf.stack(bitmaps.map(b => tf.browser.fromPixels(b))).toFloat().div(255)));
      const rows = await f.array(); f.dispose(); bitmaps.forEach(b => b.close());
      rows.forEach(r => features.push(r));
      if (start % 800 === 0) log(`encoded ${Math.min(start + 8, P.entries.length)}/${P.entries.length}`);
    }
    const encodeMs = performance.now() - t0;
    const F = tf.tensor2d(features);
    const HV = tf.tensor2d(P.entries.map(e => e.headVector), [P.entries.length, 3]);
    const O = tf.tensor2d(P.entries.map(e => e.faceOrigin3D), [P.entries.length, 3]);
    const pick = (t, rows) => tf.gather(t, rows);
    const predictHead = rows => tf.tidy(() => head.predict([pick(F, rows), pick(HV, rows), pick(O, rows)]));
    const applyAffine = (A, V) => tf.tidy(() => { const r = V.reshape([-1, 2]); const h = tf.concat([r, tf.ones([r.shape[0], 1])], 1); return tf.matMul(h, A.transpose()).reshape(V.shape); });
    const computeAffineMatrixML = (src, dst) => { const X = new mlMatrix.Matrix(src.map(r => [...r, 1])), Y = new mlMatrix.Matrix(dst); return mlMatrix.solve(X, Y, true).transpose().to2DArray(); };
    const assign = values => tf.tidy(() => variables.forEach((v, i) => v.assign(values[i])));
    const predictRows = async (rows, A) => { const p = predictHead(rows); const q = A ? applyAffine(A, p) : p; const out = await q.array(); p.dispose(); if (A) q.dispose(); return out; };
    // F1: pretrained head, no affine, on the calibration strips vs the worker's pre-training rawNormPog.
    assign(initial);
    const f1 = await predictRows(P.calibrationIndices, null);
    const F1 = Math.max(...f1.map((r, i) => Math.max(...r.map((v, j) => Math.abs(v - P.entries[P.calibrationIndices[i]].rawNormPog[j])))));
    log(`F1 pretrained head vs recorded pre-training network: max |Δ| ${F1.toExponential(2)}`);

    // WebEyeTrack.adapt reproduced on an arbitrary support set (global strip rows + labels); predicts `targets` rows.
    async function adapt(rows, labels, opts, targets) {
      const t1 = performance.now();
      assign(initial);
      const groups = new Map(); labels.forEach((l, i) => { const k = l.join(','); groups.set(k, [...(groups.get(k) ?? []), i]); });
      const holdout = opts.holdout && opts.steps > 0 && groups.size >= 6 && [...groups.values()].every(g => g.length >= 2);
      const held = holdout ? [...groups.values()].map(g => g[g.length - 1]) : [];
      const heldSet = new Set(held);
      const trainLocal = holdout ? labels.map((_, i) => i).filter(i => !heldSet.has(i)) : labels.map((_, i) => i);
      const trainRows = trainLocal.map(i => rows[i]), heldRows = held.map(i => rows[i]);
      const fitAffine = async (r, l) => computeAffineMatrixML(await predictRows(r, null), l);
      let A = tf.tensor2d(await fitAffine(trainRows, trainLocal.map(i => labels[i])), [2, 3]);
      const trainLabels = tf.tensor2d(trainLocal.map(i => labels[i]));
      const heldLabels = held.length ? tf.tensor2d(held.map(i => labels[i])) : null;
      const heldLoss = async () => { if (!heldLabels) return NaN; const t = tf.tidy(() => tf.losses.meanSquaredError(heldLabels, applyAffine(A, predictHead(heldRows))).asScalar()); const v = (await t.data())[0]; t.dispose(); return v; };
      const optimizer = tf.train.adam(opts.lr, 0.85, 0.9, 1e-8);
      const before = await heldLoss();
      let best = before, bestStep = 0, since = 0, stepsUsed = 0;
      let bestWeights = variables.map(v => v.clone());
      const mask = opts.freezePose ? tf.tidy(() => tf.concat([tf.ones([512, variables[kernel].shape[1]]), tf.zeros([6, variables[kernel].shape[1]])], 0)) : null;
      for (let step = 1; step <= opts.steps; step++) {
        const { value, grads } = tf.variableGrads(() => tf.tidy(() => {
          const prediction = applyAffine(A, predictHead(trainRows));
          const fit = tf.losses.meanSquaredError(trainLabels, prediction).asScalar();
          return opts.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(initial[i]).square().sum())).mul(opts.l2)).asScalar() : fit;
        }), variables);
        if (mask) { const g = grads[variables[kernel].name]; grads[variables[kernel].name] = g.mul(mask); g.dispose(); }
        optimizer.applyGradients(variables.map(v => ({ name: v.name, tensor: grads[v.name] })));
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
      A.dispose(); A = tf.tensor2d(await fitAffine(rows, labels), [2, 3]);
      const ms = performance.now() - t1; // training as the worker would time it: before the predictions below
      const pred = await predictRows(targets, A);
      const report = { samples: labels.length, heldOut: held.length, holdout, stepsUsed, bestStep: holdout ? bestStep : stepsUsed, heldOutBefore: before, heldOutAfter: best };
      trainLabels.dispose(); heldLabels?.dispose(); A.dispose(); optimizer.dispose(); tf.dispose(bestWeights); mask?.dispose();
      return { report, pred, ms };
    }

    const VARIANTS = { shipped: { freezePose: false }, frozen: { freezePose: true } };
    const out = {};
    for (const d of P.designs) {
      out[d.name] = { frames: d.rows.length, dropped: d.dropped, dots: d.dots, variants: {} };
      const groups = new Map(); d.labels.forEach((l, i) => { const k = l.join(','); groups.set(k, [...(groups.get(k) ?? []), i]); });
      for (const [vname, v] of Object.entries(VARIANTS)) {
        const opts = { ...P.options, freezePose: v.freezePose };
        const main = await adapt(d.rows, d.labels, opts, P.checkIndices);
        log(`${d.name} · ${vname}: ${JSON.stringify(main.report)} in ${(main.ms / 1000).toFixed(1)} s`);
        const lodo = {};
        for (const [key, local] of groups) {
          const keep = d.labels.map((_, i) => i).filter(i => !local.includes(i));
          const r = await adapt(keep.map(i => d.rows[i]), keep.map(i => d.labels[i]), opts, local.map(i => d.rows[i]));
          lodo[key] = { pred: r.pred, labels: local.map(i => d.labels[i]), ms: r.ms, report: r.report };
        }
        out[d.name].variants[vname] = { report: main.report, ms: main.ms, check: main.pred, lodo };
      }
    }
    return { backend: tf.getBackend(), encodeMs, F1, designs: out, numTensors: tf.memory().numTensors };
  }, payload);
} finally { await browser.close(); await served.close(); }

const output = { session: session.id, backend: result.backend, encodeMs: result.encodeMs, F1: result.F1, options: trainingOptions, checkAts: check.map(e => e.at), checkBlocks: check.map(e => e.block), designs: result.designs, numTensors: result.numTensors };
await writeFile(outFile, JSON.stringify(output) + '\n');
console.log(`F1 ${result.F1.toExponential(2)} · encode ${(result.encodeMs / 1000).toFixed(1)} s · wrote ${outFile}`);
