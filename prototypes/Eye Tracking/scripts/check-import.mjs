// Verify unchanged copies against the parent source pin, without its scratch checkout.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(await readFile('docs/IMPORT-SOURCE.json', 'utf8'));
const adapted = new Set(manifest.packagingChanges.map(change => change.path));
let exact = 0;
for (const file of manifest.files) {
  if (adapted.has(file.path)) continue;
  const bytes = await readFile(file.path);
  assert.equal(bytes.length, file.bytes, `Imported file size changed: ${file.path}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Imported file changed: ${file.path}`);
  exact++;
}
console.log(`PASS: ${exact} exact copies from parent source ${manifest.parentSourceSha256}; ${adapted.size} documented packaging adaptations.`);
