import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
console.log('Historical WebGazer audit: retained source/runtime, inactive in the current app.');
const upstream = JSON.parse(await readFile('vendor/webgazer/UPSTREAM.json', 'utf8'));
const adapted = new Set(['src/index.mjs', 'src/params.mjs', 'src/facemesh.mjs']);
let assets = 0;
for (const entry of upstream.files) {
  if (!adapted.has(entry.path)) assert.equal(await hash(`vendor/webgazer/${entry.path}`), entry.sha256, `Upstream file drift: ${entry.path}`);
  if (entry.path.startsWith('src/mediapipe/face_mesh/')) {
    const served = entry.path.replace('src/mediapipe', 'public/vendor/mediapipe');
    assert.equal(await hash(served), entry.sha256, `Served model/runtime differs from source: ${served}`);
    assets++;
  }
}
const build = JSON.parse(await readFile('public/vendor/BUILD.json', 'utf8'));
for (const entry of build.files) assert.equal(await hash(entry.path), entry.sha256, `Stale vendor build: ${entry.path}`);
const source = await readFile('vendor/webgazer/src/index.mjs', 'utf8');
// Retained pristine sources must still match the pinned upstream manifest.
for (const name of adapted) {
  const entry = upstream.files.find(file => file.path === name);
  assert(entry, `Missing upstream manifest entry: ${name}`);
  assert.equal(await hash(`vendor/webgazer/upstream/${name.slice(4)}`), entry.sha256);
}
assert(!source.includes("from 'localforage'"));
assert(!source.includes("document.addEventListener('click'"));
assert(!source.includes("document.addEventListener('mousemove'"));
assert(!/localforage\.(getItem|setItem|clear)\(/.test(source));
const params = await readFile('vendor/webgazer/src/params.mjs', 'utf8');
assert(params.includes('saveDataAcrossSessions: false'));
assert(params.includes("faceMeshSolutionPath: '/vendor/mediapipe/face_mesh'"));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert(!lock.packages['node_modules/localforage']);
assert.equal(lock.packages['node_modules/@mediapipe/face_mesh'].version, '0.4.1633559619');
const html = await readFile('index.html', 'utf8');
assert(html.includes("connect-src 'self'"));
assert(html.includes("form-action 'none'"));
assert(!/https?:\/\//.test(html));
console.log(`PASS: ${upstream.files.length - adapted.size} unchanged upstream source/assets, ${assets} identical served MediaPipe files, current vendor fingerprints, explicit-only training, persistence removed, local CSP.`);
console.log('Source/build audit only. Real browser requests, camera teardown, rendering and speech still require the parent browser review.');
