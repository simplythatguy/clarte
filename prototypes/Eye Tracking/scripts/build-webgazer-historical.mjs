import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

await mkdir('public/vendor', { recursive: true });
await build({
  entryPoints: ['vendor/webgazer/src/index.mjs'],
  outfile: 'public/vendor/webgazer.js',
  bundle: true,
  format: 'iife',
  globalName: 'WebGazerLocal',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  banner: { js: '/* WebGazer, Brown WebGazer Team, GPL-3.0-or-later. Source b12701dd7b6d7b00d4b8dbebf87fdec840c24999 with documented local privacy/lifecycle adaptations. See /vendor/licenses/ and docs/PROVENANCE.md. */' },
});
const licenseRoot = 'public/vendor/licenses';
await mkdir(licenseRoot, { recursive: true });
await copyFile('vendor/webgazer/LICENSE.md', `${licenseRoot}/WebGazer-NOTICE.txt`);
await copyFile('LICENSE', `${licenseRoot}/GPL-3.0.txt`);
await copyFile('vendor/webgazer/src/util.mjs', `${licenseRoot}/WebGazer-utility-copyrights.mjs.txt`);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [];
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue;
  const files = await readdir(location).catch(() => []);
  const licenseFiles = files.filter(name => /^(licen[sc]e|notice|copying)(\.|$|-)/i.test(name));
  for (const file of licenseFiles) {
    const name = `${location.replaceAll('/', '_')}_${file}`;
    await copyFile(path.join(location, file), path.join(licenseRoot, name)).catch(() => {});
  }
  notices.push({ package: location.replace('node_modules/', ''), version: pkg.version, license: pkg.license ?? 'See package notices', licenseFiles });
}
await writeFile(`${licenseRoot}/DEPENDENCIES.json`, JSON.stringify(notices, null, 2) + '\n');
const fingerprint = async file => ({ path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
const manifest = {
  sourceRevision: 'b12701dd7b6d7b00d4b8dbebf87fdec840c24999',
  files: await Promise.all(['vendor/webgazer/src/index.mjs', 'vendor/webgazer/src/params.mjs', 'vendor/webgazer/src/facemesh.mjs', 'public/vendor/webgazer.js', 'public/vendor/webgazer.js.LEGAL.txt', 'scripts/adapt-webgazer.py'].map(fingerprint)),
};
await writeFile('public/vendor/BUILD.json', JSON.stringify(manifest, null, 2) + '\n');
