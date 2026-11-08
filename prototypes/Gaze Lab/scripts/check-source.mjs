// Verifies that every copied file that is not listed as adapted is still byte-identical to its source hash.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(await readFile(path.join(LAB, 'SOURCE.json'), 'utf8'));
let bad = 0, adapted = 0;
for (const f of source.files) {
  const hash = createHash('sha256').update(await readFile(path.join(LAB, f.path))).digest('hex');
  if (f.adapted) { adapted++; if (hash === f.sha256) console.log(`note: ${f.path} is listed as adapted but unchanged`); continue; }
  if (hash !== f.sha256) { bad++; console.error(`MODIFIED: ${f.path}`); }
}
console.log(`${source.files.length} files checked, ${adapted} adapted, ${bad} unexpected modifications`);
process.exit(bad ? 1 : 0);
