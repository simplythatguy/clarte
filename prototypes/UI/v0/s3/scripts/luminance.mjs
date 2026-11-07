#!/usr/bin/env node
/**
 * Mean relative luminance of every screen (BRIEF "Luminance": constant across states, no swing of
 * 10% over large areas). Also saves the dark theme of one screen for inspection.
 *
 *   node scripts/luminance.mjs http://localhost:5103 [dark-screenshot.png]
 */
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', darkShot] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
const phases = await page.evaluate(() => window.clarteDebug.phases);
const mean = async () => {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = new OffscreenCanvas(img.width / 4, img.height / 4); const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return sum / (d.length / 4);
  }, png);
};
const rows = [];
for (const phase of phases) {
  await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
  await page.waitForTimeout(250);
  rows.push([phase, await mean()]);
}
const values = rows.map((r) => r[1]);
const max = Math.max(...values), min = Math.min(...values);
for (const [p, v] of rows) console.log(`${p.padEnd(20)} ${v.toFixed(3)}`);
console.log(`range ${min.toFixed(3)}–${max.toFixed(3)}: largest difference ${(((max - min) / max) * 100).toFixed(1)}% of the brightest screen`);
// The optional dark theme, every screen (set after each phase so the app does not reset it).
const dark = [];
for (const phase of phases) {
  await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(250);
  dark.push([phase, await mean()]);
}
const dv = dark.map((r) => r[1]);
const dmax = Math.max(...dv), dmin = Math.min(...dv);
console.log('dark theme:');
for (const [p, v] of dark) console.log(`${p.padEnd(20)} ${v.toFixed(3)}`);
console.log(`dark range ${dmin.toFixed(3)}–${dmax.toFixed(3)}: largest difference ${(dmax - dmin).toFixed(3)} absolute`);
if (darkShot) {
  await page.evaluate(() => window.clarteDebug.setPhase('compose-pending'));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: darkShot });
  console.log(`dark compose-pending mean ${(await mean()).toFixed(3)} → ${darkShot}`);
}
await browser.close();
