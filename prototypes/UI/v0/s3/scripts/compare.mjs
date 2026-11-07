#!/usr/bin/env node
/**
 * Side by side at 1440 × 900: this style's Compose stage next to the light-direction mock
 * (reference/11-light-direction-mock-1440x900.png), as the brief's quality bar requires.
 *
 *   node scripts/compare.mjs http://localhost:5103 evidence/compare-compose-vs-mock.png
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out = 'evidence/compare-compose-vs-mock.png'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?partner=script&phase=compose-pending`, { waitUntil: 'networkidle' });
await page.mouse.move(720, 120);
await page.waitForTimeout(600);
const mine = (await page.screenshot()).toString('base64');
const mock = readFileSync(new URL('../../reference/11-light-direction-mock-1440x900.png', import.meta.url)).toString('base64');
const png = await page.evaluate(async ({ mine, mock }) => {
  const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${b64}`; });
  const [a, b] = await Promise.all([load(mine), load(mock)]);
  const h = 900, gap = 40, label = 56;
  const bw = Math.round(b.width * (h / b.height));
  const c = document.createElement('canvas');
  c.width = 1440 + gap + bw; c.height = h + label;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(a, 0, label, 1440, h);
  x.drawImage(b, 1440 + gap, label, bw, h);
  x.fillStyle = '#1D1D1F'; x.font = '600 26px -apple-system, Helvetica, sans-serif';
  x.fillText('Style 3 · Stages — Compose, 1440 × 900', 0, 38);
  x.fillText('Light-direction mock (reference/11), the minimum bar', 1440 + gap, 38);
  return c.toDataURL('image/png').split(',')[1];
}, { mine, mock });
writeFileSync(out, Buffer.from(png, 'base64'));
console.log(`→ ${out}`);
await browser.close();
