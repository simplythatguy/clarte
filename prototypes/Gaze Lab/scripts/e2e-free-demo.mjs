// Pointer-driven proof of free look's dwell rules in the built app with the demo tracker: its gaze is the pointer plus the
// demo's bias and noise, and it falls back to a moving path after 1.5 s without pointer movement, so a held look nudges the
// pointer by 1 px every 200 ms. The pointer first rests on Q6 for 0.6 s (too short to select), so no look of the demo's
// own path carries over. Q7: one selection about 2 s after the look arrives, a green border for about 400 ms, then
// latched (blue, no refill) while the look stays. Q2: selected the same way. Back to Q7 with a 120 ms glance at Q8 on the
// way: re-armed, and the glance does not delay it. Then the Paused screen's Dwell switch off: the blue mark is the live
// quadrant at once, with no fill, and a 3 s look selects nothing. Then Finish: the result grid, session.json, frames.jsonl and
// analysis/quadrants.py agree. Port 4333; screenshots in evidence/e2e-free-demo/.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4333, TAG = 'e2e-free-demo';
const out = path.join(LAB, `evidence/${TAG}`);
await mkdir(out, { recursive: true });
const before = new Set(await readdir(path.join(LAB, 'sessions')).catch(() => []));
if (!(await stat(path.join(LAB, '.venv/bin/python')).catch(() => null))) { console.error('the analysis step needs .venv: python3 -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt'); process.exit(1); }
const server = spawn(process.execPath, ['server.mjs', `--port=${PORT}`], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const errors = [], shots = [], checks = [];
const ensure = (ok, what) => { checks.push({ ok, what }); if (!ok) throw new Error(`check failed: ${what}`); };
const started = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async name => { const file = `${out}/${name}.png`; await page.screenshot({ path: file }); shots.push(file); };
  await page.goto(`http://127.0.0.1:${PORT}/?demo=1&tester=${TAG}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.quadrants.is-free').waitFor({ timeout: 120000 });
  const rects = await page.evaluate(() => [...document.querySelectorAll('.quadrant')].map(e => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
  const centre = id => { const r = rects.find(q => q.id === id); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };
  const cellAt = (x, y) => rects.find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)?.id ?? null;
  const watch = () => page.evaluate(() => {
    const w = window.__watch = { t0: performance.now(), frames: [], moves: [], done: false };
    if (!window.__watchMoves) { window.__watchMoves = true; addEventListener('pointermove', e => window.__watch.moves.push({ t: performance.now() - window.__watch.t0, x: e.clientX, y: e.clientY })); }
    const step = () => {
      if (w.done) return;
      const gaze = document.querySelectorAll('.quadrant.is-gaze'), selected = document.querySelectorAll('.quadrant.is-selected'), fill = gaze[0]?.style.getPropertyValue('--dwell') ?? '';
      w.frames.push({ t: performance.now() - w.t0, gaze: gaze[0]?.id ?? null, dwell: gaze[0] ? Number(fill) : null, fill, selected: selected[0]?.id ?? null, marks: gaze.length + selected.length });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const stopWatch = () => page.evaluate(() => { window.__watch.done = true; return window.__watch; });
  const arrivalsOf = moves => { const out = []; for (const m of moves) { const id = cellAt(m.x, m.y); if (id !== out.at(-1)?.id) out.push({ t: m.t, id }); } return out; };
  const markLag = (frames, a) => { const f = frames.find(g => g.t >= a.t && g.gaze === a.id); return f ? Math.round(f.t - a.t) : null; };
  await watch();
  const hold = async (id, ms) => { const c = centre(id), end = Date.now() + ms; for (let i = 0; Date.now() < end; i++) { await page.mouse.move(c.x + (i % 2), c.y); await page.waitForTimeout(200); } };
  await hold('q5', 600);
  await hold('q6', 1300);
  await shot('01-dwell-filling');
  await hold('q6', 2700);
  await shot('02-latched');
  // Evidence only: the selection itself is asserted from the per-frame watcher below.
  const caught = page.locator('#q1.is-selected').waitFor({ timeout: 6000 }).then(() => shot('03-selected'), () => console.log('the 0.4 s green border on Q2 was not caught for a screenshot'));
  await hold('q1', 3000);
  await caught;
  await hold('q6', 1000);
  await page.mouse.move(centre('q7').x, centre('q7').y);
  await page.waitForTimeout(120);
  await hold('q6', 3400);
  const { frames, moves } = await stopWatch();
  ensure(frames.every(f => f.marks <= 1), 'at most one cell is marked at a time: the blue look or the green selection');
  const arrivals = arrivalsOf(moves);
  ensure(arrivals.map(a => a.id).join() === 'q5,q6,q1,q6,q7,q6', `the pointer visited Q6, Q7, Q2, Q7, a glance at Q8, Q7 (${arrivals.map(a => a.id).join()})`);
  const spans = [];
  frames.forEach((f, i) => {
    const prev = frames[i - 1];
    if (f.selected && prev?.selected !== f.selected) spans.push({ id: f.selected, start: f.t, end: null, index: i });
    if (!f.selected && prev?.selected) spans.at(-1).end = f.t;
  });
  ensure(spans.map(s => s.id).join() === 'q6,q1,q6', `selected Q7, Q2, Q7 and nothing else (${spans.map(s => s.id).join()})`);
  const timing = spans.map((s, i) => ({ id: s.id, afterArrival: Math.round(s.start - arrivals[i + 1].t), shownMs: s.end === null ? null : Math.round(s.end - s.start) }));
  ensure(timing.every(t => t.afterArrival > 1950 && t.afterArrival < 2700), `each selection came about 2 s after the look arrived, the glance at Q8 included (${JSON.stringify(timing)})`);
  ensure(timing.every(t => t.shownMs !== null && t.shownMs > 330 && t.shownMs < 520), `each green border showed for about 400 ms (${JSON.stringify(timing)})`);
  for (const s of spans) {
    let k = s.index;
    while (k > 0 && frames[k - 1].gaze === s.id) k--;
    const fill = frames.slice(k, s.index);
    ensure(fill.length > 10 && fill.every((f, i) => i === 0 || f.dwell >= fill[i - 1].dwell) && fill.at(-1).dwell > .85, `${s.id} filled steadily to nearly full before it was selected (${fill.length} frames, last ${fill.at(-1)?.dwell})`);
  }
  const latched = frames.filter(f => f.t > spans[0].end && f.t < arrivals[2].t);
  ensure(latched.length > 30 && latched.every(f => f.gaze === 'q6' && f.dwell === 0 && !f.selected), `after the first selection Q7 stayed blue without refilling while the look stayed (${latched.length} frames)`);
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Paused' }).waitFor();
  const dwellSwitch = page.getByRole('checkbox', { name: 'Dwell' });
  ensure(await dwellSwitch.isChecked(), 'the Paused screen has the Dwell switch, on');
  await shot('04-paused');
  await dwellSwitch.uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.quadrants.is-free').waitFor({ timeout: 5000 });
  await watch();
  await hold('q2', 1200);
  await shot('05-dwell-off');
  await hold('q2', 2000);
  await hold('q4', 800);
  const off = await stopWatch(), offArrivals = arrivalsOf(off.moves);
  ensure(offArrivals.map(a => a.id).join() === 'q2,q4', `with dwell off the pointer went to Q3, then Q5 (${offArrivals.map(a => a.id).join()})`);
  ensure(off.frames.every(f => !f.selected && !f.fill), 'with dwell off nothing fills and nothing is selected');
  const lag = { dwellOff: offArrivals.map(a => markLag(off.frames, a)), dwellOn: [arrivals[1], arrivals[2]].map(a => markLag(frames, a)) };
  ensure(lag.dwellOff.every(l => l !== null && l < 500), `with dwell off the blue mark reached each looked-at quadrant within 0.5 s (${JSON.stringify(lag)} ms)`);
  ensure(off.frames.filter(f => f.t > offArrivals[0].t + 600 && f.t < offArrivals[1].t).every(f => f.gaze === 'q2'), 'with dwell off the mark stayed on Q3 for the whole 3 s look, longer than a dwell');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('.result').waitFor({ timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('06-result');
  const line = (await page.locator('.result-line').innerText()).trim();
  ensure(/^3 selections · calibration \d+ s \+ training \d+ s$/.test(line) && await page.getByRole('button', { name: 'Again' }).count() === 1, `the result line counts 3 selections (${JSON.stringify(line)})`);
  const cells = await page.evaluate(() => [...document.querySelectorAll('.result .quadrant')].map(e => e.textContent));
  ensure(JSON.stringify(cells) === JSON.stringify(['', '1', '', '', '', '', '2', '']), `the grid shows Q2 once, Q7 twice, nothing elsewhere (${JSON.stringify(cells)})`);
  const after = (await readdir(path.join(LAB, 'sessions'))).filter(n => !before.has(n) && n.includes(`-${TAG}`));
  ensure(after.length === 1, `one new session folder (${after.join(', ')})`);
  const sessionDir = path.join(LAB, 'sessions', after[0]);
  const session = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  ensure(session.complete && session.settings.test === 'free' && session.free.selections.map(s => s.quadrant).join() === '6,1,6' && session.free.pauses === 2, `session.json records the three selections and two pauses (${session.free.selections.map(s => s.quadrant).join()}, ${session.free.pauses})`);
  ensure(session.free.dwellAtStart === true && JSON.stringify(session.free.toggles.map(t => t.dwell)) === '[false]', `session.json records dwell on at the start and switched off once (${JSON.stringify(session.free.toggles)})`);
  ensure(JSON.stringify(session.result) === JSON.stringify({ selections: [0, 1, 0, 0, 0, 0, 2, 0], total: 3 }), `session.json result (${JSON.stringify(session.result)})`);
  const rows = (await readFile(path.join(sessionDir, 'frames.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  const select = rows.filter(r => r.block === 'F' && r.phase === 'select');
  ensure(select.map(r => `${r.point}@${r.t}`).join() === session.free.selections.map(s => `${s.quadrant}@${s.at}`).join(), 'frames.jsonl has one select row per selection, at its time');
  const lookRows = rows.filter(r => r.block === 'F' && r.phase === 'look');
  ensure(lookRows.length > 30 && lookRows.every(r => r.t > session.free.toggles[0].at), `frames.jsonl marks the dwell-off frames as look, after the switch (${lookRows.length})`);
  const py = spawn(path.join(LAB, '.venv/bin/python'), ['-I', 'analysis/quadrants.py', sessionDir], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
  let pyOut = '', pyErr = '';
  py.stdout.on('data', d => { pyOut += d; }); py.stderr.on('data', d => { pyErr += d; });
  const code = await new Promise(resolve => py.on('close', resolve));
  ensure(code === 0, `quadrants.py exit ${code} ${pyErr.slice(-600)}`);
  const qj = JSON.parse(await readFile(path.join(sessionDir, 'quadrants.json'), 'utf8'));
  ensure(qj.selections.map(s => s.quadrant).join() === '6,1,6' && qj.selections.every(s => s.streams['candidate blend'] === s.quadrant && s.dwellMs >= 2000), `quadrants.py: each dwell's candidate-blend median is the selected quadrant (${JSON.stringify(qj.selections.map(s => s.streams))})`);
  console.log(pyOut.trim());
  await writeFile(`${out}/report.json`, JSON.stringify({ finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), sessionDir, checks, timing, markLagMs: lag, screenshots: shots, errors, scope: 'Demo tracker driven by the pointer: proves the dwell rules and their recording, not gaze accuracy.' }, null, 2) + '\n');
  console.log(`PASS e2e-free-demo: ${checks.length} checks, timing ${JSON.stringify(timing)}, mark lag ${JSON.stringify(lag)} ms, page errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 5));
} catch (e) {
  console.error('E2E-FREE-DEMO FAILED:', e.message);
  try {
    const w = await browser.contexts()[0].pages()[0].evaluate(() => window.__watch);
    const spans = w.frames.filter((f, i) => f.selected && w.frames[i - 1]?.selected !== f.selected).map(f => [f.selected, Math.round(f.t)]);
    const jumps = w.moves.filter((m, i) => i === 0 || Math.hypot(m.x - w.moves[i - 1].x, m.y - w.moves[i - 1].y) > 5).map(m => [Math.round(m.t), Math.round(m.x), Math.round(m.y)]);
    console.error('selections (cell, ms):', JSON.stringify(spans), 'pointer jumps (ms, x, y):', JSON.stringify(jumps));
  } catch { /* the watcher had not started */ }
  try { const page = browser.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: `${out}/failure.png` }); } catch {}
  console.error('errors:', errors.slice(0, 5));
  process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
