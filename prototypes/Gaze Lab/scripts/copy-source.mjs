// Copies the shipped Clarte eye-tracking pipeline into gaze-lab and records every file's hash.
// Rerunnable: it never writes into the Clarte checkout. Files listed in ADAPTED are expected to be
// edited afterwards in the copy; SOURCE.json records the source hash so the edit can be diffed.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The Clarte checkout this lab sits in (prototypes/Gaze Lab), or another one given as --repo=<path>.
const REPO = path.resolve(process.argv.find(a => a.startsWith('--repo='))?.slice(7) ?? path.join(LAB, '../..'));
const APP = path.join(REPO, 'prototypes/Eye Tracking');
const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const FILES = [
  'src/core/tracking.ts', 'src/core/worker-engine.ts', 'src/core/worker-client.ts', 'src/core/training.ts',
  'src/core/geometric-gaze.ts', 'src/core/calibration-models.ts', 'src/core/head-position.ts', 'src/core/pose-normalize.ts',
  'src/core/camera-motion.ts', 'src/core/network.ts', 'src/core/saved-calibration.ts', 'src/core/one-euro.ts',
  'src/core/calibration.ts', 'src/core/session-file.ts', 'src/core/session-recorder.ts', 'src/core/replay-file.ts',
  'src/core/dwell.ts', 'src/core/blink.ts', 'src/core/webeyetrack.ts', 'src/core/validation.ts', 'src/core/team-model.ts',
  'dev/session-runner.ts', 'dev/session-scoring.ts', 'dev/webm-demux.ts', 'dev/team-training.ts', 'dev/session.html', 'dev/session.ts', 'src/core/check-report.ts',
  'scripts/build-vendor.mjs', 'tsconfig.json', 'tsconfig.worker.json', 'public/vendor/licenses/APACHE-2.0.txt',
];
const DIRS = ['vendor/webeyetrack', 'public/vendor/webeyetrack'];
// Edited in the copy (see ADAPTATIONS.md).
const ADAPTED = new Set(['vendor/webeyetrack/worker.ts', 'vendor/webeyetrack/local/utils/mathUtils.ts', 'vendor/webeyetrack/local/WebEyeTrack.ts', 'src/core/worker-engine.ts', 'scripts/build-vendor.mjs', 'tsconfig.json', 'tsconfig.worker.json', 'public/vendor/webeyetrack/worker.js', 'public/vendor/webeyetrack/worker.js.map', 'public/vendor/webeyetrack/worker.js.LEGAL.txt', 'public/vendor/webeyetrack/BUILD.json', 'public/vendor/webeyetrack/licenses/DEPENDENCIES.json']);

const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function walk(dir) { const out = []; for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await walk(f)); else out.push(f); } return out; }

// Adapted files are copied only when missing (or with --force), so a rerun never clobbers the recorded edits.
const force = process.argv.includes('--force');
const exists = async f => !!(await stat(f).catch(() => null));
async function copyOne(src, rel) {
  const dest = path.join(LAB, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  if (!(ADAPTED.has(rel) && !force && await exists(dest))) await cp(src, dest);
  records.push({ path: rel, sha256: await sha(src), adapted: ADAPTED.has(rel) });
}
const records = [];
for (const rel of FILES) await copyOne(path.join(APP, rel), rel);
for (const dir of DIRS) {
  for (const file of await walk(path.join(APP, dir))) {
    const rel = path.relative(APP, file);
    if (rel.includes('node_modules')) continue;
    await copyOne(file, rel);
  }
}
// The shipped worker bundle stays available for parity checks under a second name.
await cp(path.join(APP, 'public/vendor/webeyetrack/worker.js'), path.join(LAB, 'public/vendor/webeyetrack/worker.shipped.js'));
records.push({ path: 'public/vendor/webeyetrack/worker.shipped.js', copiedFrom: 'public/vendor/webeyetrack/worker.js', sha256: await sha(path.join(APP, 'public/vendor/webeyetrack/worker.js')), adapted: false });
const sizes = await Promise.all(records.map(async r => (await stat(path.join(LAB, r.path))).size));
await writeFile(path.join(LAB, 'SOURCE.json'), JSON.stringify({
  repository: 'simplythatguy/clarte', app: 'prototypes/Eye Tracking', commit, copiedAt: new Date().toISOString(),
  note: 'sha256 is the SOURCE file hash at copy time. Files with adapted=true are edited in gaze-lab afterwards; ADAPTATIONS.md lists every edit. All other files must stay byte-identical (scripts/check-source.mjs verifies).',
  files: records.map((r, i) => ({ ...r, bytes: sizes[i] })),
}, null, 2) + '\n');
console.log(`copied ${records.length} files from ${commit}`);
