#!/usr/bin/env node
/** Mean relative luminance of the screen in every phase (BRIEF "Luminance"), light theme, 1440 × 900. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104', out = 'evidence/luminance.json'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const phases = await page.evaluate(() => window.clarteDebug.phases);
const meter = await browser.newPage();
const result = {};
for (const phase of phases) {
  await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
  await page.waitForTimeout(phase.startsWith('calibration') ? 2500 : 600);
  const png = (await page.screenshot()).toString('base64');
  result[phase] = await meter.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width / 4, img.height / 4);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
    return +(sum / (px.length / 4)).toFixed(3);
  }, png);
}
await browser.close();
const values = Object.values(result);
const summary = { min: Math.min(...values), max: Math.max(...values), phases: result };
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
