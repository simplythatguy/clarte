import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base = 'public/vendor/webeyetrack';
await mkdir(`${base}/licenses`, { recursive: true });
const bundle = await build({ metafile: true, entryPoints: ['vendor/webeyetrack/worker.ts'], outfile: `${base}/worker.js`, bundle: true, format: 'iife', target: 'es2022', minify: true, sourcemap: true, legalComments: 'linked',
  banner: { js: '/* WebEyeTrack 75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c, MIT; local adaptations; gaze-lab debug build (init {debug:true} adds estimator inputs to step results). See /vendor/webeyetrack/licenses/NOTICE.txt */' } });
await copyFile('vendor/webeyetrack/LICENSE', `${base}/licenses/WebEyeTrack-MIT.txt`);
await copyFile('public/vendor/licenses/APACHE-2.0.txt', `${base}/licenses/APACHE-2.0.txt`);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [];
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue;
  const licenseFiles = (await readdir(location).catch(() => [])).filter(name => /^(licen[sc]e|notice|copying)(\.|$|-)/i.test(name));
  for (const file of licenseFiles) await copyFile(path.join(location, file), `${base}/licenses/${location.replaceAll('/', '_')}_${file}`).catch(() => {});
  notices.push({ package: location.replace('node_modules/', ''), version: pkg.version, license: pkg.license ?? 'See notices', licenseFiles });
}
await writeFile(`${base}/licenses/DEPENDENCIES.json`, JSON.stringify(notices, null, 2) + '\n');
const files = [];
async function walk(dir) { for (const name of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
  const file = `${dir}/${name.name}`;
  if (name.isDirectory()) await walk(file); else if (name.name !== 'BUILD.json' && name.name !== 'worker.shipped.js') files.push({ path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
} }
await walk(base);
const inputs = await Promise.all(Object.keys(bundle.metafile.inputs).filter(file => !file.startsWith('(disabled):')).sort().map(async file => ({ path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })));
await writeFile(`${base}/BUILD.json`, JSON.stringify({ inputs, disabledInputs: Object.keys(bundle.metafile.inputs).filter(file => file.startsWith('(disabled):')), sourceRevision: '75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c', files }, null, 2) + '\n');
