// Parity check: the same camera frames through the shipped worker (worker.shipped.js) and the gaze-lab debug
// build (worker.js, init {debug:true}) must give identical shipped outputs: rawNormPog, estimates, normPog,
// pose, camera, eyeState, facePresent. Checked before calibration, through 42 collected labels and training,
// and after training. Writes evidence/parity.json. Exit 1 on any difference.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from './lib/static-server.mjs';
import { FIXTURE_SCRIPT, PAGE } from './lib/fixture-page.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_BEFORE = 30, FRAMES_AFTER = 30;
const served = await serveStatic({ roots: [path.join(LAB, 'public'), path.join(LAB, 'vendor/webeyetrack/docs/public')], pages: { '/index.html': PAGE } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  await page.goto(served.origin + '/');
  await page.evaluate(FIXTURE_SCRIPT);
  const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(LAB, 'fixtures/face.json'), 'utf8'));
  const report = await page.evaluate(async ([fixture, FRAMES_BEFORE, FRAMES_AFTER]) => {
    const f = window.fixture;
    await f.load('/profiles/' + fixture.photo);
    const shipped = f.workerCaller('/vendor/webeyetrack/worker.shipped.js'), debug = f.workerCaller('/vendor/webeyetrack/worker.js');
    const shippedFields = r => ({ rawNormPog: r.rawNormPog, estimates: r.estimates, normPog: r.normPog, pose: r.pose, camera: r.camera, eyeState: r.eyeState, facePresent: r.facePresent, face: r.face, open: r.open, at: r.at });
    const differences = [], rows = [];
    let at = 1000, frameIndex = 0;
    const step = async (label) => {
      const img = f.drawFrame(frameIndex++, fixture.faceHeightShare), img2 = f.copy(img);
      at += 33; const epoch = performance.timeOrigin + performance.now();
      const [a, b] = await Promise.all([shipped.call('step', { frame: img, at, epoch }, [img.data.buffer]), debug.call('step', { frame: img2, at, epoch }, [img2.data.buffer])]);
      const sa = JSON.stringify(shippedFields(a)), sb = JSON.stringify(shippedFields(b));
      if (sa !== sb) differences.push({ label, at, shipped: shippedFields(a), debug: shippedFields(b) });
      if (a.debug !== undefined) differences.push({ label, at, problem: 'shipped worker returned a debug payload' });
      if (!b.debug || !Array.isArray(b.debug.landmarks) || !Array.isArray(b.debug.headVector)) differences.push({ label, at, problem: 'debug worker returned no debug payload' });
      rows.push({ label, at, rawNormPog: a.rawNormPog, estimates: a.estimates, debugKeys: b.debug ? Object.keys(b.debug) : null, featureVector: b.debug?.featureVector ?? null, landmarks: b.debug?.landmarks?.length ?? 0 });
      return { a, b, at };
    };
    const init = await Promise.all([shipped.call('init', { development: false }), debug.call('init', { development: true, debug: true })]);
    for (let i = 0; i < FRAMES_BEFORE; i++) await step('before');
    // 14 dots × 3 labels, as the app collects them; the same frame is labelled in both workers.
    const dots = [[0, 0], [-.45, -.4], [0, -.4], [.45, -.4], [.45, 0], [.45, .4], [0, .4], [-.45, .4], [-.45, 0], [0, 0], [-.2, 0], [.2, 0], [0, -.2], [0, .2]];
    let collected = { shipped: 0, debug: 0 };
    for (const [x, y] of dots) for (let k = 0; k < 3; k++) {
      const { at } = await step('collect');
      const [ca, cb] = await Promise.all([shipped.call('collect', { at, x, y }), debug.call('collect', { at, x, y })]);
      if (ca !== cb) differences.push({ label: 'collect', at, shipped: ca, debug: cb });
      if (ca === true) collected.shipped++; if (cb === true) collected.debug++;
    }
    const [ta, tb] = await Promise.all([shipped.call('train', null), debug.call('train', null)]);
    const [ra, rb] = await Promise.all([shipped.call('trainingReport'), debug.call('trainingReport')]);
    const trainingIdentical = JSON.stringify(ra) === JSON.stringify(rb);
    for (let i = 0; i < FRAMES_AFTER; i++) await step('after');
    shipped.terminate(); debug.terminate();
    return { backend: init, collected, trained: { shipped: ta, debug: tb }, trainingReport: { shipped: ra, debug: rb, identical: trainingIdentical }, framesCompared: rows.length, differences, sample: rows.filter((_, i) => i % 10 === 0) };
  }, [fixture, FRAMES_BEFORE, FRAMES_AFTER]);
  await mkdir(path.join(LAB, 'evidence'), { recursive: true });
  await writeFile(path.join(LAB, 'evidence/parity.json'), JSON.stringify({ checkedAt: new Date().toISOString(), fixture, ...report }, null, 2) + '\n');
  console.log(`frames compared: ${report.framesCompared}; collected ${report.collected.shipped}/${report.collected.debug}; training report identical: ${report.trainingReport.identical}; differences: ${report.differences.length}`);
  if (report.differences.length) { console.error(JSON.stringify(report.differences.slice(0, 3), null, 1)); process.exitCode = 1; }
  else console.log('PASS parity: shipped and debug workers agree on every compared frame before, during and after calibration');
} finally { await browser.close(); await served.close(); }
