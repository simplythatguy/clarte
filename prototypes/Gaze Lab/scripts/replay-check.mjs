// Replays a gaze-lab .clarte-session through the Clarte test-session runner (dev/session.html + dev/session-runner.ts,
// copied unchanged) in headless Chromium against server.mjs, exactly as Clarte's scripts/run-sessions.mjs does.
// Usage: node scripts/replay-check.mjs <file.clarte-session> [more files]   (default: newest session with one)
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4333;
let files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) {
  const dirs = (await readdir(path.join(LAB, 'sessions'))).sort().reverse();
  for (const d of dirs) { const f = (await readdir(path.join(LAB, 'sessions', d))).find(n => n.endsWith('.clarte-session')); if (f) { files = [path.join(LAB, 'sessions', d, f)]; break; } }
}
if (!files.length) { console.error('No .clarte-session file found'); process.exit(1); }
for (const f of files) await stat(f);
const server = spawn(process.execPath, ['server.mjs', `--port=${PORT}`], { cwd: LAB, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/dev/session.html`);
  await page.setInputFiles('#files', files);
  await page.waitForFunction(() => !document.getElementById('run').disabled || /Unreadable/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  console.log(await page.textContent('#status'));
  await page.click('#run');
  let last = '';
  const timer = setInterval(async () => { const t = await page.textContent('#status').catch(() => ''); if (t && t !== last) { last = t; console.log(t); } }, 5000);
  await page.waitForFunction(() => window.__sessionResults?.done === true, null, { timeout: 0 });
  clearInterval(timer);
  const scores = await page.evaluate(() => window.__sessionResults.scores);
  await mkdir(path.join(LAB, 'evidence/replay'), { recursive: true });
  const report = path.join(LAB, 'evidence/replay', `report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(report, JSON.stringify({ createdAt: new Date().toISOString(), files: files.map(f => path.basename(f)), scores }, null, 2) + '\n');
  const round = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v));
  console.table(scores.map(s => 'error' in s ? { sample: s.file, error: s.error } : { sample: `${s.tester} #${s.sample}`, face: `${s.frames.withFace}/${s.frames.processed}`, labels: `${s.labels.collected}/${s.labels.recorded}`, trained: s.trained, liveMedian: round(s.live?.medianPx), replayMedian: round(s.check?.medianPx), replayP90: round(s.check?.p90Px), notes: s.notes.join(' ') }));
  console.log(`report: ${report}`);
  const failed = scores.filter(s => 'error' in s || !s.trained || !s.check);
  if (failed.length) { console.error('replay did not train and score every file'); process.exitCode = 1; } else console.log('PASS replay: the Clarte runner trained and scored the gaze-lab session file');
} finally { await browser.close(); server.kill(); }
