// End-to-end for the simple flow at `/`: the built app + server.mjs, the REAL debug worker, Chromium's fake camera fed with
// fixtures/face.y4m. Start → Q8 calibration (both models) → the test → result; every output file is checked and
// analysis/quadrants.py runs. `--test=free` (the default flow, port 4334): free look, where a 2 s dwell selects the quadrant
// the photo's estimate sits on, Esc and a click pause, Finish ends. `--test=guided` (port 4331): one round of 8 dot trials
// with a pause and a redo. Screenshots land in evidence/e2e-free/ or evidence/e2e-simple/. Plumbing only: a photo cannot
// move its eyes, so nothing here says anything about accuracy.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TEST = arg('test') === 'free' ? 'free' : 'guided', FREE = TEST === 'free';
const PORT = FREE ? 4334 : 4331, TAG = FREE ? 'e2e-free' : 'e2e-simple', ROUNDS = Number(arg('rounds') ?? 1);
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
const finite2 = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const started = Date.now();
let sessionDir = null;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/^INFO:/.test(m.text())) errors.push(m.text()); });
  const shot = async name => { const file = `${out}/${name}.png`; await page.screenshot({ path: file }); shots.push(file); };
  const text = async () => (await page.locator('body').innerText()).trim();
  const lines = async () => (await text()).split('\n').map(s => s.trim()).filter(Boolean);
  await page.goto(`http://127.0.0.1:${PORT}/?tester=${TAG}&test=${TEST}&rounds=${ROUNDS}`);
  await page.getByRole('button', { name: 'Start' }).waitFor();
  ensure(await text() === 'Start', `the start screen shows only the Start button (${JSON.stringify(await text())})`);
  await shot('01-start');
  await page.getByRole('button', { name: 'Start' }).click();
  // Calibration: the one-line intro, then eight dots with a shrinking ring and no text, then "Calibrating" while both models train.
  await page.getByRole('heading', { name: 'Look at each dot', exact: true }).waitFor({ timeout: 120000 });
  ensure(await text() === 'Look at each dot', 'the calibration intro is one line');
  await shot('02-calibration-intro');
  await page.locator('.validation-dot.is-record').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('03-calibration-dot');
  ensure(await text() === '', 'the calibration dot screen shows no text');
  await page.getByRole('heading', { name: 'Calibrating', exact: true }).waitFor({ timeout: 60000 });
  let selectionsSeen = 0;
  if (FREE) {
    // Free look: the 2×4 grid only, at most one marked cell. The photo cannot hold one quadrant: after Q8 its unchanging face maps
    // to the centroid of the 8 targets, where four quadrants meet, so the blue cell wanders and a selection is luck. The dwell's
    // timing, latch and re-arm are proven pointer-driven in e2e-free-demo.mjs; here the screen, the pauses and the recording.
    await page.locator('.quadrants.is-free').waitFor({ timeout: 180000 });
    const watch = page.evaluate(ms => new Promise(resolve => {
      const frames = [], t0 = performance.now();
      const step = () => {
        const t = performance.now() - t0, gaze = document.querySelectorAll('.quadrant.is-gaze'), selected = document.querySelectorAll('.quadrant.is-selected');
        frames.push({ t, gaze: gaze[0]?.id ?? null, dwell: gaze[0] ? Number(gaze[0].style.getPropertyValue('--dwell')) : null, selected: selected[0]?.id ?? null, marks: gaze.length + selected.length });
        if (t < ms) requestAnimationFrame(step); else resolve(frames);
      };
      requestAnimationFrame(step);
    }), 4000);
    ensure(await page.locator('#dot').count() === 0 && await text() === '' && await page.locator('.quadrant').count() === 8, 'free look shows the eight quadrants only: no dot, no text');
    await page.locator('.quadrant.is-gaze').waitFor({ timeout: 5000 });
    await page.waitForTimeout(700);
    await shot('04-free-look');
    const frames = await watch;
    ensure(frames.every(f => f.marks <= 1), 'at most one cell is marked at a time: the blue look or the green selection');
    ensure(frames.some(f => f.gaze && f.dwell > .05), `the blue cell fills while the look stays on it (max ${Math.max(...frames.map(f => f.dwell ?? 0)).toFixed(2)})`);
    selectionsSeen = frames.filter((f, i) => f.selected && frames[i - 1]?.selected !== f.selected).length;
    // Esc pauses with Continue / Finish (no redo in free look); Space continues; a click pauses as well; Finish ends.
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused' }).waitFor();
    ensure((await lines()).join('|') === 'Paused|Continue|Dwell|Finish' && await page.getByRole('checkbox', { name: 'Dwell' }).isChecked(), `the free-look pause offers Continue, the Dwell switch (on) and Finish (${JSON.stringify(await text())})`);
    await shot('06-paused');
    await page.keyboard.press('Space');
    await page.locator('.quadrants.is-free').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.mouse.click(640, 300);
    await page.getByRole('heading', { name: 'Paused' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Finish' }).click();
  } else {
    // Test: the 2×4 grid, one light-blue target with the dot at its centre, no text; then a green or red border for 400 ms.
    await page.getByRole('heading', { name: 'Look at the dot', exact: true }).waitFor({ timeout: 180000 });
    await shot('03b-test-intro');
    await page.locator('.quadrants.is-test').waitFor({ timeout: 180000 });
    await page.locator('.quadrant.is-target').waitFor({ timeout: 5000 });
    await page.locator('.quadrants.is-test .validation-dot.is-record').waitFor({ timeout: 5000 });
    await page.locator('.quadrant.is-gaze').first().waitFor({ timeout: 5000 });
    ensure(await page.locator('.quadrant.is-gaze').count() === 1, 'the live gaze highlight marks exactly one quadrant');
    await page.waitForTimeout(500);
    await shot('04-trial-record');
    ensure(await text() === '', 'the test screen shows no text');
    ensure(await page.locator('.quadrant').count() === 8 && await page.locator('.quadrant.is-target').count() === 1, 'eight quadrants, one highlighted');
    const dotBox = await page.locator('#dot').boundingBox(), targetBox = await page.locator('.quadrant.is-target').boundingBox();
    ensure(Math.abs(dotBox.x + dotBox.width / 2 - (targetBox.x + targetBox.width / 2)) < 2 && Math.abs(dotBox.y + dotBox.height / 2 - (targetBox.y + targetBox.height / 2)) < 2, 'the dot sits at the centre of the highlighted quadrant');
    await page.locator('.quadrant.is-hit, .quadrant.is-miss').first().waitFor({ timeout: 10000 });
    await shot('05-feedback');
    const feedbackClass = await page.locator('.quadrant.is-hit, .quadrant.is-miss').first().getAttribute('class');
    ensure(/is-(hit|miss)/.test(feedbackClass), `a feedback border was shown (${feedbackClass})`);
    // Esc pauses with Continue / Redo trial / Finish; Space continues.
    await page.locator('.quadrants.is-test .validation-dot.is-record').waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused' }).waitFor();
    ensure((await lines()).join('|') === 'Paused|Continue|Redo trial|Finish', `the pause screen offers Continue, Redo trial, Finish (${JSON.stringify(await text())})`);
    await shot('06-paused');
    await page.keyboard.press('Space');
    await page.locator('.quadrants.is-test').waitFor({ timeout: 5000 });
  }
  // Result: the grid with counts, one line, Again.
  await page.locator('.result').waitFor({ timeout: 300000 });
  await page.waitForTimeout(600);
  await shot('07-result');
  const resultLines = await lines();
  ensure(await page.locator('.result .quadrant').count() === 8, 'the result grid has eight quadrants');
  let totalSelections = null;
  if (FREE) {
    const counts = resultLines.slice(0, -2), line = resultLines.at(-2);
    ensure(counts.every(l => /^[1-9]\d*$/.test(l)) && /^(\d+ selections? · )?calibration \d+ s \+ training \d+ s$/.test(line) && resultLines.at(-1) === 'Again', `the result shows the selection counts (nothing for none), one line and Again (${JSON.stringify(resultLines)})`);
    totalSelections = /^\d/.test(line) ? Number(line.split(' ')[0]) : 0;
    ensure(counts.reduce((a, b) => a + Number(b), 0) === totalSelections && totalSelections >= selectionsSeen, `the counts add up to the ${totalSelections} selections`);
  } else {
    ensure(resultLines.length === 10 && resultLines.slice(0, 8).every(l => /^\d+\/\d+$/.test(l)) && /^\d+ % · calibration \d+ s \+ training \d+ s$/.test(resultLines[8]) && resultLines[9] === 'Again', `the result shows 8 counts, one line and Again (${JSON.stringify(resultLines)})`);
    const totalShown = resultLines.slice(0, 8).map(l => Number(l.split('/')[1])).reduce((a, b) => a + b, 0);
    ensure(totalShown === ROUNDS * 8, `every quadrant was tested ${ROUNDS}× (${totalShown} trials)`);
  }
  // ---- files ----
  const after = (await readdir(path.join(LAB, 'sessions'))).filter(n => !before.has(n) && n.endsWith(`-${TAG}`));
  ensure(after.length === 1, `one new session folder (${after.join(', ')})`);
  sessionDir = path.join(LAB, 'sessions', after[0]);
  const files = await readdir(sessionDir);
  for (const f of ['session.json', 'frames.jsonl', 'landmarks.f32', 'video.webm', 'summary.json', 'calibration.json', 'quick-calibration.json', 'eyestrips']) ensure(files.includes(f), `${f} written`);
  const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  ensure(session.mode === 'simple' && session.complete === true && session.settings.test === TEST, `session.json is a complete simple-mode ${TEST} session`);
  ensure(session.quadrants.length === 8 && session.quadrants.every(q => q.rect && q.centre), '8 quadrant rects recorded');
  const cal = session.calibration;
  ensure(cal.candidate.init.fixes.freezePose === true && cal.candidate.init.blend.geometricShareMax === .2 && JSON.stringify(cal.candidate.init.limits) === JSON.stringify({ maxSamples: 200, minSamples: 24, minTargets: 8 }), `candidate worker took freezePose, the cap and the limits (${JSON.stringify(cal.candidate.init)})`);
  ensure(cal.baseline.init.fixes.freezePose === false && cal.baseline.init.blend.geometricShareMax === .85 && JSON.stringify(cal.baseline.init.limits) === JSON.stringify({ maxSamples: 200, minSamples: 24, minTargets: 8 }), `baseline worker took the limits only (${JSON.stringify(cal.baseline.init)})`);
  ensure(cal.labels.candidate === cal.candidate.trainingReport.samples && cal.labels.baseline === cal.baseline.trainingReport.samples, `every accepted label reached its worker (${JSON.stringify(cal.labels)})`);
  ensure(cal.candidate.trainingReport.geometric.weight <= .2, `candidate blend weight capped (${cal.candidate.trainingReport.geometric.weight})`);
  ensure(typeof cal.wallMs === 'number' && cal.wallMs > 17000 && cal.wallMs < 120000, `calibration wall time recorded (${Math.round(cal.wallMs)} ms)`);
  const rows = (await readFile(path.join(sessionDir, 'frames.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  ensure(rows.every((r, i) => r.i === i), 'frame rows are contiguous and in order');
  const landmarkBytes = (await stat(path.join(sessionDir, 'landmarks.f32'))).size;
  ensure(landmarkBytes === rows.filter(r => r.landmarkRow !== null).length * 478 * 3 * 4, 'landmarks.f32 has one 478×3 float32 row per landmark row');
  const q8 = rows.filter(r => r.block === 'Q8'), labels = q8.filter(r => r.phase === 'quick:label');
  // How many labels exist depends on the frame rate (8 dots × ~1 s), which a loaded machine lowers; past 42 offered frames, the
  // raised limits must let more than the shipped 42 through.
  const offered = q8.filter(r => (r.phase === 'collect' || r.phase === 'quick:label') && r.face).length, samples = [cal.candidate.trainingReport?.samples, cal.baseline.trainingReport?.samples];
  ensure(cal.candidate.error === null && cal.baseline.error === null && samples.every(n => n >= 24 && (n > 42 || offered <= 42)), `both models trained, past the shipped 42 labels when more frames were offered (${samples.join(', ')} of ${offered} offered)`);
  ensure(labels.length === cal.labels.candidate && new Set(labels.map(r => r.point)).size === 8, `frames.jsonl marks the ${cal.labels.candidate} candidate labels on 8 dots`);
  const replay = JSON.parse(await readFile(path.join(sessionDir, 'eyestrips/replay.json'), 'utf8'));
  const pngs = (await readdir(path.join(sessionDir, 'eyestrips'))).filter(f => f.endsWith('.png'));
  ensure(replay.entries.length === pngs.length && replay.entries.filter(e => e.kind === 'calibration' && e.block === 'Q8').length === cal.labels.baseline, `eye strips cover the ${cal.labels.baseline} baseline labels (${pngs.length} PNGs)`);
  ensure((await stat(path.join(sessionDir, 'video.webm'))).size > 100000, 'video.webm recorded');
  ensure(!files.some(f => f.endsWith('.clarte-session')), 'no .clarte-session in simple mode');
  let usableFrames = 0;
  if (FREE) {
    const free = session.free, sels = free.selections;
    ensure(session.trials.length === 0 && session.rounds.length === 0, 'no trials or rounds in free look');
    ensure(JSON.stringify(free.dwell) === JSON.stringify({ dwellMs: 2000, holdMs: 150, rearmMs: 300, feedbackMs: 400 }) && free.liveWindowMs === 400, `the dwell rules are recorded (${JSON.stringify(free.dwell)})`);
    const look = rows.filter(r => r.block === 'F'), maxGap = Math.max(0, ...look.slice(1).map((r, i) => r.t - look[i].t));
    ensure(sels.length === totalSelections && sels.every((s, i) => s.index === i && s.quadrant >= 0 && s.quadrant < 8 && s.at - s.dwellStartedAt >= 2000 && s.at - s.dwellStartedAt <= 2000 + maxGap && s.shownAt >= s.at), `every selection has its quadrant, a 2 s dwell and the time its border appeared (${JSON.stringify(sels.map(s => [s.quadrant, Math.round(s.at - s.dwellStartedAt), Math.round(s.shownAt - s.at)]))})`);
    ensure(free.pauses === 2 && free.endedAt > free.startedAt && free.dwellAtStart === true && free.toggles.length === 0, `both pauses counted, dwell on throughout (${free.pauses}, ${JSON.stringify(free.toggles)})`);
    ensure(session.result.total === sels.length && session.result.selections.reduce((a, b) => a + b, 0) === sels.length, 'the result counts every selection');
    ensure(look.length > 15 && look.every(r => r.screen === 'test' && r.target === null && !r.trial), `free-look rows have no target or trial (${look.length})`);
    ensure(look.every(r => ['idle', 'dwelling', 'selected', 'select', 'look', 'paused'].includes(r.phase)), `free-look rows carry the dwell phase (${[...new Set(look.map(r => r.phase))].join(',')})`);
    const selectRows = look.filter(r => r.phase === 'select');
    ensure(selectRows.length === sels.length && selectRows.every((r, i) => r.t === sels[i].at && r.point === sels[i].quadrant), 'one select row per selection, at its time, on its quadrant');
    const usable = look.filter(r => r.phase !== 'paused' && r.facePresent && r.eyeState === 'open');
    usableFrames = usable.length;
    ensure(usable.length > 15 && usable.filter(r => r.quick && finite2(r.quick.rawNormPog)).length > usable.length * .8, `free-look frames carry the candidate blend (${usable.length} usable)`);
    ensure(replay.entries.every(e => e.kind === 'calibration'), 'free look adds no test strips (there is no target to label them with)');
  } else {
    ensure(session.settings.rounds === ROUNDS && session.settings.feedback === true && session.rounds.length === ROUNDS && session.rounds.every(r => [...r.order].sort().join() === '0,1,2,3,4,5,6,7'), 'rounds recorded with a full order each');
    ensure(session.trials.length === ROUNDS * 8 && session.trials.every(t => t.attempts >= 1 && t.decision && typeof t.centre.x === 'number'), 'every trial has a centre, attempts and a decision');
    ensure(session.trials.filter(t => t.attempts === 2).length === 1, `the paused trial was redone once (${session.trials.map(t => t.attempts).join('')})`);
    ensure(session.free === null, 'no free-look record in a guided session');
    ensure(session.result && session.result.total === ROUNDS * 8, `result tallied over ${ROUNDS * 8} trials`);
    const test = rows.filter(r => r.screen === 'test' && r.block === 'T');
    const record = test.filter(r => r.phase === 'record' && r.facePresent && r.eyeState === 'open');
    usableFrames = record.length;
    ensure(record.length > 40, `usable record frames (${record.length})`);
    ensure(test.every(r => r.trial && typeof r.trial.index === 'number' && typeof r.trial.attempt === 'number' && typeof r.point === 'number' && r.target) || test.filter(r => r.phase === 'paused' || r.phase === null).length > 0, 'test rows carry trial, attempt, quadrant and target');
    ensure(new Set(test.filter(r => r.trial).map(r => r.phase)).size === 3, `test rows cover settle, record and feedback (${[...new Set(test.map(r => r.phase))].join(',')})`);
    ensure(record.every(r => finite2(r.rawNormPog) && finite2(r.network) && r.faceOrigin3D && r.pose), 'record frames carry the baseline blend and network, face origin and pose');
    ensure(record.filter(r => r.quick && finite2(r.quick.rawNormPog) && finite2(r.quick.network)).length > record.length * .8, 'record frames carry the candidate blend and network');
    ensure(record.some(r => r.quick && finite2(r.quick.geometric)) && record.some(r => finite2(r.geometric)), 'both geometric branches present after training');
    ensure(replay.entries.some(e => e.kind === 'check' && e.block === 'T'), 'eye strips include the test record frames');
  }
  // ---- analysis ----
  const py = spawn(path.join(LAB, '.venv/bin/python'), ['-I', 'analysis/quadrants.py', sessionDir], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
  let pyOut = '', pyErr = '';
  py.stdout.on('data', d => { pyOut += d; }); py.stderr.on('data', d => { pyErr += d; });
  const code = await new Promise(resolve => py.on('close', resolve));
  ensure(code === 0, `quadrants.py exit ${code} ${pyErr.slice(-600)}`);
  for (const f of FREE ? ['quadrants.md', 'quadrants.json'] : ['quadrants.md', 'quadrants.json', 'quadrants.png']) ensure((await readdir(sessionDir)).includes(f), `quadrants.py wrote ${f}`);
  const qj = JSON.parse(await readFile(path.join(sessionDir, 'quadrants.json'), 'utf8'));
  if (FREE) {
    ensure(qj.test === 'free' && qj.selections.length === session.free.selections.length && qj.selections.every((s, i) => s.quadrant === session.free.selections[i].quadrant && s.frames > 0), 'quadrants.json lists every selection with the frames of its dwell');
  } else {
    ensure(qj.trials.length === ROUNDS * 8 && typeof qj.overall['candidate blend'].hit === 'number', 'quadrants.json has per-trial rows and overall hit rates');
    ensure(qj.trials.every(t => t.decision['candidate blend'] === session.trials[t.index].decision.candidate.blend), 'the offline candidate decision matches the app\'s recorded decision on every trial');
  }
  console.log(pyOut.trim());
  await writeFile(`${out}/report.json`, JSON.stringify({ finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), test: TEST, sessionDir, rounds: FREE ? null : ROUNDS, checks, screenshots: shots, errors, frames: rows.length, usableFrames, calibration: { wallMs: cal.wallMs, labels: cal.labels }, result: session.result, scope: 'Real shipped worker + debug build on a synthetic photo camera; proves plumbing only, never gaze accuracy.' }, null, 2) + '\n');
  console.log(`PASS e2e-simple (${TEST}): ${checks.length} checks, ${shots.length} screenshots, session ${sessionDir}; page errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 5));
} catch (e) {
  console.error(`E2E-SIMPLE (${TEST}) FAILED:`, e.message);
  try { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: `${out}/failure.png` }); console.error('page text:', (await page.locator('body').innerText()).slice(0, 400)); } } catch {}
  console.error('checks so far:', JSON.stringify(checks.filter(c => !c.ok)), 'errors:', errors.slice(0, 5));
  process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
