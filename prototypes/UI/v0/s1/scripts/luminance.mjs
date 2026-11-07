#!/usr/bin/env node
/**
 * Mean linear luminance (Rec. 709 relative luminance, 0–1) of every screenshot in a folder, as a
 * check on the brief's "mean screen luminance stays constant across every state".
 *
 *   node scripts/luminance.mjs evidence/layout
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = resolve(process.argv[2] ?? 'evidence/layout');
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
  const data = `data:image/png;base64,${readFileSync(join(dir, file)).toString('base64')}`;
  const mean = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height); const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let sum = 0; for (let i = 0; i < data.length; i += 4) sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
    return sum / (data.length / 4);
  }, data);
  rows.push([file, mean]);
}
await browser.close();
const max = Math.max(...rows.map((r) => r[1]));
for (const [file, mean] of rows) console.log(`${mean.toFixed(3)}  ${(((max - mean) / max) * 100).toFixed(1).padStart(5)}% below max  ${file}`);
