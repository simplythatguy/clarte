// Source/model integrity is independent of dist, local dependencies and test evidence.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const manifestPath = 'docs/WEBEYETRACK-SOURCE-FINGERPRINT.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = [];
async function walk(root) {
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = `${root}/${item.name}`;
    if (item.isDirectory()) await walk(file);
    else if (item.isFile() && file !== manifestPath) paths.push(file);
  }
}
for (const root of ['src', 'tests', 'scripts', 'vendor', 'public', 'docs']) await walk(root);
paths.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.worker.json', 'vite.config.ts', 'index.html', 'README.md', 'LICENSE', '.gitignore');
const files = await Promise.all(paths.sort().map(async path => {
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: sha(bytes) };
}));
const sourceSha256 = sha(files.map(file => `${file.sha256}  ${file.path}\n`).join(''));
if (process.argv.includes('--verify')) {
  const saved = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(files.length, saved.files.length, 'Fingerprint file count changed');
  for (let i = 0; i < files.length; i++) assert.deepEqual(files[i], saved.files[i], `Fingerprint drift: ${files[i].path}`);
  assert.equal(sourceSha256, saved.sourceSha256);
  console.log('PASS: all imported source/model/asset paths, sizes and SHA-256 values match.');
} else {
  await writeFile(manifestPath, JSON.stringify({ kind: 'prototype-source-content-fingerprint', sourceSha256, files }, null, 2) + '\n');
}
console.log(`Source SHA-256 ${sourceSha256}; ${files.length} source/model/asset files. Manifest SHA-256 ${sha(await readFile(manifestPath))}`);
