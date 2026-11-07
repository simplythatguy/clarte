#!/usr/bin/env node
/** SHA-256 of every source and script file, so evidence can be tied to the build it shows. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [out = 'evidence/source-fingerprint.json'] = process.argv.slice(2);
const files = ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', ...readdirSync('src').map((f) => `src/${f}`), ...readdirSync('scripts').map((f) => `scripts/${f}`)].sort();
const hashes = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
const all = createHash('sha256').update(Object.values(hashes).join('')).digest('hex');
writeFileSync(out, JSON.stringify({ build: all, at: new Date().toISOString(), files: hashes }, null, 2));
console.log(all);
