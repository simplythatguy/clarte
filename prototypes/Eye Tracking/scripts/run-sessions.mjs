// Replays recorded test sessions through the current tracker build in headless Chromium, unattended.
// Usage: npm run test:sessions [-- <files or folders>]   (default folder: sessions/)
// Writes evidence/sessions/report-<time>.json and prints a summary table. Development only.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inputs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
// --training='{"steps":0}' replays with other calibration training settings (A/B against the build defaults).
const training = process.argv.find(arg => arg.startsWith('--training='))?.slice('--training='.length) ?? '';
// --normalize replays with eye strips from a pose-normalized view (development comparison).
const normalize = process.argv.includes('--normalize');
const files = [];
for (const input of inputs.length ? inputs : ['sessions']) {
  const info = await stat(input).catch(() => null);
  if (!info) continue;
  if (info.isDirectory()) for (const name of (await readdir(input)).sort()) { if (name.endsWith('.clarte-session')) files.push(path.resolve(input, name)); }
  else files.push(path.resolve(input));
}
if (!files.length) { console.error('No .clarte-session files found. Put recordings in sessions/ or pass their paths.'); process.exit(1); }

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('page error:', error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error(`console ${message.type()}:`, message.text().slice(0, 300)); });
  const query = [training ? `training=${encodeURIComponent(training)}` : '', normalize ? 'normalize=1' : ''].filter(Boolean).join('&');
  await page.goto(`${origin}/dev/session.html${query ? `?${query}` : ''}`);
  await page.setInputFiles('#files', files);
  await page.waitForFunction(() => !document.getElementById('run').disabled || /Unreadable/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  console.log(await page.textContent('#status'));
  await page.click('#run');
  let last = '';
  const timer = setInterval(async () => { const text = await page.textContent('#status').catch(() => ''); if (text && text !== last) { last = text; console.log(text); } }, 5000);
  await page.waitForFunction(() => window.__sessionResults?.done === true, null, { timeout: 0 });
  clearInterval(timer);
  const scores = await page.evaluate(() => window.__sessionResults.scores);
  await mkdir('evidence/sessions', { recursive: true });
  const report = `evidence/sessions/report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(report, JSON.stringify({ createdAt: new Date().toISOString(), files: files.map(f => path.basename(f)), scores }, null, 2) + '\n');
  const round = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v));
  console.table(scores.map(s => 'error' in s ? { sample: s.file, error: s.error } : {
    sample: `${s.tester} #${s.sample}`, crop: s.crop, face: `${s.frames.withFace}/${s.frames.processed}`, labels: `${s.labels.collected}/${s.labels.recorded}`,
    training: s.training ? `${s.training.bestStep}/${s.training.stepsUsed} steps` : '-', liveMedian: round(s.live?.medianPx), replayMedian: round(s.check?.medianPx), replayP90: round(s.check?.p90Px),
    corners: round(s.check?.regions.find(r => r.name === 'corners')?.medianPx),
    network: round(s.check?.estimators?.networkMedian), geometric: round(s.check?.estimators?.geometricMedian), bestBlend: s.check?.estimators?.blend ? `${round(s.check.estimators.blend.median)} @${Math.round(s.check.estimators.blend.weight * 100)}%` : '-',
    notes: s.notes.join(' ').slice(0, 80),
  }));
  console.log(`Report: ${report}`);
  if (scores.some(s => 'error' in s)) exitCode = 1;
} finally { await browser.close(); await server.close(); }
process.exit(exitCode);
