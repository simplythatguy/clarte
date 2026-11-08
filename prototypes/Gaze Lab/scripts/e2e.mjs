// End-to-end: the built app + server.mjs on 127.0.0.1:4331, the REAL debug worker, and Chromium's fake camera fed
// with fixtures/face.y4m. Runs calibration (C0) and a shortened block list, checks every output file, runs the
// Python analysis, and saves screenshots under evidence/e2e/. The fixture proves plumbing, never accuracy.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4331, BLOCKS = process.argv.find(a => a.startsWith('--blocks='))?.slice(9) ?? 'B1,B2';
// --candidate=<candidate.json> loads a candidate in Setup (prospective re-test); --head=<calibration.json> adds that
// session's learned head to the candidate so the shadow-worker (restoreCalibration) path runs too.
const CANDIDATE = process.argv.find(a => a.startsWith('--candidate='))?.slice(12) ?? null;
const HEAD = process.argv.find(a => a.startsWith('--head='))?.slice(7) ?? null;
// --quick runs the paired quick-calibration test: Q8 (shadow worker, 8 dots) before C0, both streams on every block frame, analysis/quick.py at the end.
const QUICK = process.argv.includes('--quick');
const TAG = QUICK ? 'e2e-quick' : CANDIDATE ? 'e2e-candidate' : 'e2e';
const out = path.join(LAB, `evidence/${TAG}`);
await mkdir(out, { recursive: true });
const before = new Set(await readdir(path.join(LAB, 'sessions')).catch(() => []));
if (!(await stat(path.join(LAB, 'fixtures/face.y4m')).catch(() => null))) { console.error('fixtures/face.y4m is missing: run `npm run fixture` once (it is generated, not committed)'); process.exit(1); }
if (!(await stat(path.join(LAB, '.venv/bin/python')).catch(() => null))) { console.error('the analysis step needs .venv: python3 -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt'); process.exit(1); }
const server = spawn(process.execPath, ['server.mjs', `--port=${PORT}`], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(LAB, 'fixtures/face.y4m')}`, '--use-fake-ui-for-media-stream'] });
const errors = [], shots = [], checks = [];
const ensure = (ok, what) => { checks.push({ ok, what }); if (!ok) throw new Error(`check failed: ${what}`); };
const started = Date.now();
let sessionDir = null;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/^INFO:/.test(m.text())) errors.push(m.text()); });
  const shot = async name => { const file = `${out}/${name}.png`; await page.screenshot({ path: file }); shots.push(file); };
  await page.goto(`http://127.0.0.1:${PORT}/?mode=research&tester=${TAG}&diag=14.2&blocks=${BLOCKS}${QUICK ? '&quick=1' : ''}`);
  if (CANDIDATE) {
    const candidate = JSON.parse(await readFile(CANDIDATE, 'utf8'));
    if (HEAD) candidate.head = JSON.parse(await readFile(HEAD, 'utf8')).learned;
    const file = path.join(out, 'candidate-used.json');
    await writeFile(file, JSON.stringify(candidate));
    await page.locator('input[type=file]').setInputFiles(file);
    await page.waitForFunction(name => [...document.querySelectorAll('.setup .readout')].some(n => n.textContent === name), candidate.name);
  }
  await page.getByRole('button', { name: 'Start camera' }).click();
  await page.getByRole('button', { name: 'Begin' }).waitFor({ timeout: 120000 });
  const readoutHandle = await page.waitForFunction(() => { const t = document.getElementById('readout')?.textContent ?? ''; return /\bface · eyes open/.test(t) ? t : false; }, null, { timeout: 60000 });
  const readout = await readoutHandle.jsonValue();
  ensure(/\bface · eyes open/.test(readout), `live readout showed a detected face with open eyes, fps and backend (${readout})`);
  await shot('01-setup-live');
  if (QUICK) ensure(await page.locator('.setup input[type=checkbox]').last().isChecked(), 'Setup shows the quick-calibration toggle on (?quick=1)');
  await page.getByRole('button', { name: 'Begin' }).click();
  if (QUICK) {
    // Q8 first: a 2 s one-line intro, eight dots with a shrinking ring, "Calibrating" while the shadow worker trains, then the shipped calibration's start screen.
    await page.getByRole('heading', { name: 'Look at each dot', exact: true }).waitFor({ timeout: 120000 });
    await shot('02q-quick-intro');
    ensure((await page.locator('body').innerText()).trim() === 'Look at each dot', 'quick intro shows exactly one line');
    await page.locator('.validation-dot.is-record').waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await shot('03q-quick-dot-collecting');
    ensure((await page.locator('body').innerText()).trim() === '', 'quick dot screen shows no text');
    const dotClass = await page.locator('.validation-dot').getAttribute('class');
    ensure(/is-record/.test(dotClass ?? ''), `quick dot is in its collection window (${dotClass})`);
    await page.getByRole('heading', { name: 'Calibrating', exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('heading', { name: 'Calibrate', exact: true }).waitFor({ timeout: 180000 });
    await shot('04q-c0-start-after-quick');
  }
  await page.getByRole('heading', { name: 'Calibrate' }).waitFor();
  await shot('02-calibrate-ready');
  await page.keyboard.press('Space');
  await page.getByRole('heading', { name: /Calibrate screen dimensions/ }).waitFor({ timeout: 15000 });
  await page.locator('.calibration-point').waitFor({ timeout: 15000 });
  await page.waitForTimeout(2200);
  await shot('03-calibration-dot');
  ensure((await page.locator('body').innerText()).trim() === '', 'calibration dot screen shows no text');
  await page.getByRole('heading', { name: 'Calibrate head movement' }).waitFor({ timeout: 180000 });
  await shot('04-head-ready');
  await page.keyboard.press('Space');
  await page.getByRole('heading', { name: /Follow with your head/ }).waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Calibrating' }).waitFor({ timeout: 180000 });
  await shot('05-training');
  const TITLES = { B1: 'Neutral', B2: 'Left', B3: 'Right', B4: 'Up', B5: 'Down', B6: 'Closer', B7: 'Farther', B8: 'Turn left', B9: 'Turn right', B10: 'Chin up', B11: 'Chin down', B12: 'Return', B13: 'Lid tilt' };
  const ids = BLOCKS.split(','), first = ids[0];
  for (const [n, id] of ids.entries()) {
    await page.getByRole('heading', { name: TITLES[id], exact: true }).waitFor({ timeout: 300000 });
    await page.waitForTimeout(1200);
    if (n === 0) {
      await shot('06-instruction-with-offset');
      const offset = await page.locator('#readout').textContent();
      ensure(/cm/.test(offset), `instruction screen shows the live head offset in cm (${offset})`);
    }
    await page.keyboard.press('Space');
    await page.locator('.validation-dot.is-record').waitFor({ timeout: 15000 });
    if (n === 0) {
      await page.waitForTimeout(600);
      await shot('07-block-record-dot');
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { name: 'Paused' }).waitFor();
      await shot('08-paused');
      await page.keyboard.press('Space');
      await page.locator('.validation-dot').waitFor({ timeout: 15000 });
    }
  }
  await page.getByRole('heading', { name: 'Results' }).waitFor({ timeout: 600000 });
  await page.waitForTimeout(800);
  await shot('09-summary');
  const summaryText = await page.locator('.summary').innerText();
  ensure(/Saved to sessions\//.test(summaryText), `summary reports the save location (${summaryText.split('\n')[1]})`);
  // ---- files ----
  const after = (await readdir(path.join(LAB, 'sessions'))).filter(n => !before.has(n) && n.endsWith(`-${TAG}`));
  ensure(after.length === 1, `one new session folder (${after.join(', ')})`);
  sessionDir = path.join(LAB, 'sessions', after[0]);
  const files = await readdir(sessionDir);
  for (const f of ['session.json', 'frames.jsonl', 'landmarks.f32', 'video.webm', 'summary.json', 'calibration.json', 'eyestrips']) ensure(files.includes(f), `${f} written`);
  ensure(files.some(f => f.endsWith('.clarte-session')), '.clarte-session written');
  const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  ensure(session.complete === true, 'session.json marked complete');
  ensure(session.calibration.labels === 42, `42 calibration labels collected (${session.calibration.labels})`);
  ensure(session.calibration.trainingReport && typeof session.calibration.trainingReport.heldOutAfter === 'number', 'training report recorded');
  ensure(session.source.commit === 'b7b8f98f169f71a7c87e31d71cade3df06c6b3af', `source commit recorded (${session.source.commit})`);
  ensure(session.blocks.every(b => b.status === 'complete') && session.blocks.length === BLOCKS.split(',').length, `all ${BLOCKS} blocks complete`);
  ensure(session.blocks.every(b => b.window && typeof b.window.innerWidth === 'number' && typeof b.window.devicePixelRatio === 'number'), 'window metrics recorded per block');
  const rows = (await readFile(path.join(sessionDir, 'frames.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  const landmarkBytes = (await stat(path.join(sessionDir, 'landmarks.f32'))).size;
  const landmarkRows = rows.filter(r => r.landmarkRow !== null).length;
  ensure(landmarkBytes === landmarkRows * 478 * 3 * 4, `landmarks.f32 has one 478×3 float32 row per landmark row (${landmarkBytes} bytes, ${landmarkRows} rows)`);
  ensure(rows.every((r, i) => r.i === i), 'frame rows are contiguous and in order');
  const record = rows.filter(r => r.phase === 'record' && r.facePresent && r.eyeState === 'open');
  const blockFrames = rows.filter(r => r.screen === 'block');
  const faceRatio = blockFrames.filter(r => r.facePresent).length / Math.max(1, blockFrames.length);
  console.log(`face present in ${(faceRatio * 100).toFixed(0)}% of ${blockFrames.length} block frames (synthetic photo camera)`);
  ensure(record.length > 50, `usable record frames (${record.length})`);
  ensure(record.every(r => r.rawNormPog && r.network && r.faceOrigin3D && r.faceRt && r.features12 && r.headVector), 'record frames carry rawNormPog, network, faceOrigin3D, faceRt, features12, headVector');
  ensure(record.some(r => r.geometric), 'geometric estimates present after training');
  if (CANDIDATE) {
    ensure(session.settings.candidate && session.settings.candidate.name, 'candidate recorded in session.json');
    ensure(record.filter(r => r.candidate && r.candidate.final).length > record.length * .8, 'candidate stream recorded on record frames');
    if (HEAD) ensure(record.filter(r => r.candidate && r.candidate.head && r.candidate.head.rawNormPog).length > record.length * .5, 'candidate head (shadow worker) stream recorded');
    ensure(/candidate/.test(summaryText), 'summary shows the candidate row');
  }
  ensure(rows.filter(r => r.block === 'C0' && /:label$/.test(r.phase)).length === 42, 'frames.jsonl marks the 42 labelled calibration frames');
  if (QUICK) {
    const q = session.quick;
    ensure(q && q.order === 'Q8 before C0' && q.init && q.init.fixes.freezePose === true && q.init.fixes.matrixLayout === false, `session.json records the quick test with freezePose on (${JSON.stringify(q?.init?.fixes)})`);
    ensure(JSON.stringify(q.init.limits) === JSON.stringify({ maxSamples: 200, minSamples: 24, minTargets: 8 }) && q.init.blend.geometricShareMax === .2, `shadow worker took the limits and the blend cap (${JSON.stringify(q.init.limits)}, ${q.init.blend.geometricShareMax})`);
    ensure(q.error === null && q.trainingReport && q.trainingReport.samples > 42, `quick training ran on more than 42 samples (${q.trainingReport?.samples}, error ${q.error})`);
    ensure(q.labels === q.trainingReport.samples, `every accepted quick label reached the shadow worker (${q.labels} = ${q.trainingReport.samples})`);
    ensure(q.trainingReport.geometric && q.trainingReport.geometric.weight <= .2, `quick blend weight capped at 0.2 (${q.trainingReport.geometric?.weight})`);
    ensure(typeof q.wallMs === 'number' && q.wallMs > 17000 && typeof q.c0.wallMs === 'number' && q.c0.wallMs > q.wallMs, `both wall times recorded, Q8 ${Math.round(q.wallMs)} ms < C0 ${Math.round(q.c0?.wallMs)} ms`);
    const q8 = rows.filter(r => r.block === 'Q8'), q8Labels = q8.filter(r => r.phase === 'quick:label');
    ensure(q8Labels.length === q.labels && new Set(q8Labels.map(r => r.point)).size === 8, `frames.jsonl marks the ${q.labels} quick labels on 8 distinct dots (${q8Labels.length} rows, ${new Set(q8Labels.map(r => r.point)).size} dots)`);
    ensure(q8.some(r => r.phase === 'intro') && q8.every(r => r.screen === 'quick'), 'quick frames carry the quick screen and the intro phase');
    const finite2 = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
    ensure(rows.every(r => 'quick' in r), 'every row carries the quick stream key');
    const withQuick = record.filter(r => r.quick && finite2(r.quick.rawNormPog) && finite2(r.quick.network));
    ensure(withQuick.length > record.length * .8, `record frames carry a finite quick stream (${withQuick.length}/${record.length})`);
    ensure(record.some(r => r.quick && finite2(r.quick.geometric)), 'quick geometric estimates present after quick training');
    ensure(files.includes('quick-calibration.json'), 'quick-calibration.json written');
    ensure(/quick blend/.test(summaryText) && /quick network/.test(summaryText) && /Quick calibration \(Q8, ran first\)/.test(summaryText), 'summary shows the quick rows and the two wall times');
    const pyq = spawn(path.join(LAB, '.venv/bin/python'), ['-I', 'analysis/quick.py', sessionDir], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
    let qOut = '', qErr = '';
    pyq.stdout.on('data', d => { qOut += d; }); pyq.stderr.on('data', d => { qErr += d; });
    const qCode = await new Promise(resolve => pyq.on('close', resolve));
    ensure(qCode === 0, `quick.py exit ${qCode} ${qErr.slice(-400)}`);
    for (const f of ['quick.md', 'quick.json', 'quick.png']) ensure((await readdir(sessionDir)).includes(f), `quick.py wrote ${f}`);
    console.log(qOut.trim());
  } else ensure(rows.every(r => !('quick' in r)), 'default rows carry no quick key');
  const replay = JSON.parse(await readFile(path.join(sessionDir, 'eyestrips/replay.json'), 'utf8'));
  const pngs = (await readdir(path.join(sessionDir, 'eyestrips'))).filter(f => f.endsWith('.png'));
  ensure(replay.entries.length === pngs.length && pngs.length > 42, `eye strips exported with a side table (${pngs.length} PNGs)`);
  ensure(replay.entries.filter(e => e.kind === 'calibration').length === 42 && replay.entries.some(e => e.kind === 'check' && e.block === first), 'eye strips cover 42 calibration frames and block record frames');
  const videoBytes = (await stat(path.join(sessionDir, 'video.webm'))).size;
  ensure(videoBytes > 100000, `video.webm recorded (${videoBytes} bytes)`);
  // ---- analysis ----
  const py = spawn(path.join(LAB, '.venv/bin/python'), ['-I', 'analysis/analyze.py', sessionDir], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
  let pyOut = '', pyErr = '';
  py.stdout.on('data', d => { pyOut += d; }); py.stderr.on('data', d => { pyErr += d; });
  const code = await new Promise(resolve => py.on('close', resolve));
  ensure(code === 0, `analyze.py exit ${code} ${pyErr.slice(-400)}`);
  for (const f of ['report.md', 'scatter_x.png', 'scatter_y.png', 'quiver.png', 'error_vs_shift.png', 'candidate.json']) ensure((await readdir(sessionDir)).includes(f), `analysis wrote ${f}`);
  console.log(pyOut.trim());
  // ---- clarte-session replay compatibility: parse with the copied parser ----
  const clarte = files.find(f => f.endsWith('.clarte-session'));
  const { parseSessionFile } = await import('../dist-tests/session-file.mjs').catch(() => ({ parseSessionFile: null }));
  if (parseSessionFile) { const parsed = await parseSessionFile(new Blob([await readFile(path.join(sessionDir, clarte))])); ensure(parsed.manifest.events.some(e => e.type === 'train') && parsed.manifest.events.filter(e => e.type === 'check').length > 10, 'clarte-session has train and check events'); }
  await writeFile(`${out}/report.json`, JSON.stringify({ finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), sessionDir, blocks: BLOCKS, checks, screenshots: shots, errors, frames: rows.length, usableRecordFrames: record.length, facePresentShareInBlocks: faceRatio, trainingReport: session.calibration.trainingReport, scope: 'Real shipped worker + debug build on a synthetic photo camera; proves plumbing only, never gaze accuracy.' }, null, 2) + '\n');
  console.log(`PASS e2e: ${checks.length} checks, ${shots.length} screenshots, session ${sessionDir}; page errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 5));
} catch (e) {
  console.error('E2E FAILED:', e.message);
  try { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: `${out}/failure.png` }); console.error('page text:', (await page.locator('body').innerText()).slice(0, 400)); } } catch {}
  console.error('checks so far:', JSON.stringify(checks.filter(c => !c.ok)), 'errors:', errors.slice(0, 5));
  process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
