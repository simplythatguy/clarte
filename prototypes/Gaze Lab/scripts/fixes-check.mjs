// Unit check for the two flagged fixes in the gaze-lab worker build (init {fixes:{matrixLayout, freezePose}}), on the
// synthetic fixture camera in headless Chromium (as scripts/parity.mjs). Three workers see identical frames:
//   A: flags off   → headVector must equal the row-major port (third ROW of the face rotation, z negated): the shipped read.
//   B: matrixLayout → headVector must equal the face's forward axis computed independently from the raw faceRt
//                     (third COLUMN: [m8, m9, -m10], analysis/headvector.py's relation); faceOrigin3D vs A is reported.
//   C: freezePose   → after 42 labels + train, exportCalibration().weights[0] rows 512-517 must be bit-identical to the
//                     pretrained shard (web/group1-shard1of1.bin); A's rows must differ (control: training really moved them).
// Writes evidence/fixes-check.json. Exit 1 on any failure.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from './lib/static-server.mjs';
import { FIXTURE_SCRIPT, PAGE } from './lib/fixture-page.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_BEFORE = 20, FRAMES_AFTER = 10;
// Pretrained first Dense kernel from the shard, via the manifest offsets.
const manifest = JSON.parse(await readFile(path.join(LAB, 'public/vendor/webeyetrack/web/model.json'), 'utf8')).weightsManifest;
let kernel = null;
for (const group of manifest) {
  const bytes = await readFile(path.join(LAB, 'public/vendor/webeyetrack/web', group.paths[0]));
  let offset = 0;
  for (const w of group.weights) {
    const n = w.shape.reduce((a, b) => a * b, 1);
    if (w.name === 'dense/kernel') { if (w.dtype !== 'float32' || w.shape[0] !== 518) throw new Error(`unexpected dense/kernel ${JSON.stringify(w)}`); kernel = Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + n * 4))); }
    offset += n * (w.dtype === 'float32' || w.dtype === 'int32' ? 4 : w.dtype === 'bool' ? 1 : 4);
  }
}
if (!kernel) throw new Error('dense/kernel not found in the weights manifest');
const COLS = kernel.length / 518;
const poseRows = kernel.slice(512 * COLS);

const served = await serveStatic({ roots: [path.join(LAB, 'public'), path.join(LAB, 'vendor/webeyetrack/docs/public')], pages: { '/index.html': PAGE } });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  await page.goto(served.origin + '/');
  await page.evaluate(FIXTURE_SCRIPT);
  const fixture = JSON.parse(await readFile(path.join(LAB, 'fixtures/face.json'), 'utf8'));
  const report = await page.evaluate(async ([fixture, FRAMES_BEFORE, FRAMES_AFTER]) => {
    const f = window.fixture;
    await f.load('/profiles/' + fixture.photo);
    const workers = { A: f.workerCaller('/vendor/webeyetrack/worker.js'), B: f.workerCaller('/vendor/webeyetrack/worker.js'), C: f.workerCaller('/vendor/webeyetrack/worker.js') };
    const inits = { A: {}, B: { matrixLayout: true }, C: { freezePose: true } };
    const init = {};
    for (const k of Object.keys(workers)) init[k] = await workers[k].call('init', { development: false, debug: true, fixes: inits[k] });
    const maxAbs = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const stats = { headVectorA_vs_thirdRow: 0, headVectorB_vs_forwardAxis: 0, headVectorA_vs_B: 0, faceOrigin_A_vs_B: 0, faceRt_A_vs_B: 0, frames: 0, framesWithFace: 0 };
    let at = 1000, frameIndex = 0;
    const step = async () => {
      const img = f.drawFrame(frameIndex++, fixture.faceHeightShare);
      at += 33; const epoch = performance.timeOrigin + performance.now();
      const res = {};
      for (const k of Object.keys(workers)) { const c = f.copy(img); res[k] = await workers[k].call('step', { frame: c, at, epoch }, [c.data.buffer]); }
      stats.frames++;
      const a = res.A.debug, b = res.B.debug;
      if (res.A.facePresent && a.faceRt && b.faceRt) {
        stats.framesWithFace++;
        const m = a.faceRt;
        stats.headVectorA_vs_thirdRow = Math.max(stats.headVectorA_vs_thirdRow, maxAbs(a.headVector, [m[2], m[6], -m[10]]));
        stats.headVectorB_vs_forwardAxis = Math.max(stats.headVectorB_vs_forwardAxis, maxAbs(b.headVector, [m[8], m[9], -m[10]]));
        stats.headVectorA_vs_B = Math.max(stats.headVectorA_vs_B, maxAbs(a.headVector, b.headVector));
        stats.faceOrigin_A_vs_B = Math.max(stats.faceOrigin_A_vs_B, maxAbs(a.faceOrigin3D, b.faceOrigin3D));
        stats.faceRt_A_vs_B = Math.max(stats.faceRt_A_vs_B, maxAbs(a.faceRt, b.faceRt));
      }
      return { at, res };
    };
    for (let i = 0; i < FRAMES_BEFORE; i++) await step();
    const dots = [[0, 0], [-.45, -.4], [0, -.4], [.45, -.4], [.45, 0], [.45, .4], [0, .4], [-.45, .4], [-.45, 0], [0, 0], [-.2, 0], [.2, 0], [0, -.2], [0, .2]];
    const collected = { A: 0, B: 0, C: 0 };
    for (const [x, y] of dots) for (let k = 0; k < 3; k++) {
      const { at } = await step();
      for (const w of Object.keys(workers)) if (await workers[w].call('collect', { at, x, y }) === true) collected[w]++;
    }
    const trained = {}, reports = {}, exported = {};
    for (const w of Object.keys(workers)) { trained[w] = await workers[w].call('train', null); reports[w] = await workers[w].call('trainingReport'); exported[w] = await workers[w].call('exportCalibration'); }
    for (let i = 0; i < FRAMES_AFTER; i++) await step();
    for (const w of Object.keys(workers)) workers[w].terminate();
    return { init, stats, collected, trained, reports, kernels: Object.fromEntries(Object.entries(exported).map(([w, e]) => [w, e.weights[0]])) };
  }, [fixture, FRAMES_BEFORE, FRAMES_AFTER]);
  const rows = k => k.slice(512 * COLS);
  const identical = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const changed = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
  const checks = {
    initReportsFlags: JSON.stringify(report.init.B.fixes) === JSON.stringify({ matrixLayout: true, freezePose: false }) && JSON.stringify(report.init.C.fixes) === JSON.stringify({ matrixLayout: false, freezePose: true }) && JSON.stringify(report.init.A.fixes) === JSON.stringify({ matrixLayout: false, freezePose: false }),
    framesWithFace: report.stats.framesWithFace >= 40,
    shippedHeadVectorIsThirdRow: report.stats.headVectorA_vs_thirdRow < 1e-5, // faceRt is float32 and not exactly orthonormal: ~1e-6 is the float32 floor (headvector.py: 1.5e-6 on live frames)
    fixedHeadVectorIsForwardAxis: report.stats.headVectorB_vs_forwardAxis < 1e-5,
    headVectorsDiffer: report.stats.headVectorA_vs_B > 1e-3,
    sameLandmarks: report.stats.faceRt_A_vs_B === 0,
    allLabelsCollected: Object.values(report.collected).every(n => n === 42),
    allTrained: Object.values(report.trained).every(n => n === 42),
    kernelShape: Object.values(report.kernels).every(k => k.length === kernel.length),
    frozenRowsBitIdentical: identical(rows(report.kernels.C), poseRows),
    frozenOtherRowsTrained: changed(report.kernels.C.slice(0, 512 * COLS), kernel.slice(0, 512 * COLS)) > 0,
    controlRowsMoved: !identical(rows(report.kernels.A), poseRows),
  };
  const out = { checkedAt: new Date().toISOString(), fixture, init: report.init, stats: report.stats, collected: report.collected, trained: report.trained, trainingReports: report.reports,
    poseRows: { count: poseRows.length, changedValuesA: changed(rows(report.kernels.A), poseRows), changedValuesB: changed(rows(report.kernels.B), poseRows), changedValuesC: changed(rows(report.kernels.C), poseRows), changedValuesC_rows0to511: changed(report.kernels.C.slice(0, 512 * COLS), kernel.slice(0, 512 * COLS)) }, checks };
  await mkdir(path.join(LAB, 'evidence'), { recursive: true });
  await writeFile(path.join(LAB, 'evidence/fixes-check.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`frames ${report.stats.frames} (face ${report.stats.framesWithFace}); head vector: shipped vs third row max|Δ| ${report.stats.headVectorA_vs_thirdRow.toExponential(2)}, fixed vs forward axis ${report.stats.headVectorB_vs_forwardAxis.toExponential(2)}, shipped vs fixed ${report.stats.headVectorA_vs_B.toExponential(2)}; faceOrigin3D shipped vs fixed max|Δ| ${report.stats.faceOrigin_A_vs_B.toExponential(2)} cm`);
  console.log(`pose rows 512-517 (${poseRows.length} values): changed after training A ${out.poseRows.changedValuesA}, B ${out.poseRows.changedValuesB}, C (frozen) ${out.poseRows.changedValuesC}; C rows 0-511 changed ${out.poseRows.changedValuesC_rows0to511}`);
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length) { console.error('FAIL fixes-check:', failed.join(', ')); process.exitCode = 1; } else console.log('PASS fixes-check: matrixLayout gives the forward-axis head vector; freezePose keeps kernel rows 512-517 bit-identical to the pretrained shard');
} finally { await browser.close(); await served.close(); }
