#!/usr/bin/env node
/**
 * MOTION acceptance 8: record a Chromium performance trace during one dwell and count the
 * main-thread rendering work (style recalculation, layout, paint) frame by frame.
 *
 *   node scripts/perf.mjs http://localhost:5103 [trace.json]
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?partner=script&phase=compose-pending`, { waitUntil: 'networkidle' });
await page.mouse.move(720, 120);
await page.waitForTimeout(800);

await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
const t0 = await page.evaluate(() => performance.now());
await page.mouse.move(540, 640);                 // one look at G–N, held
await page.waitForTimeout(1400);                 // hold 150 + delay 150 + dwell 450 + commit and bloom 450
const buffer = await browser.stopTracing();
if (out) writeFileSync(out, buffer);

const events = JSON.parse(buffer.toString()).traceEvents;
const main = events.filter((e) => e.ph === 'X' && ['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'Commit'].includes(e.name));
const start = Math.min(...main.map((e) => e.ts));
const bucket = new Map();
for (const e of main) {
  const ms = Math.round((e.ts - start) / 1000 / 100) * 100;
  const row = bucket.get(ms) ?? { Layout: 0, Paint: 0, UpdateLayoutTree: 0 };
  if (e.name in row) row[e.name] += 1;
  bucket.set(ms, row);
}
const total = (name) => main.filter((e) => e.name === name).length;
console.log('per 100 ms after the look arrives (Layout / Paint / Style):');
for (const [ms, r] of [...bucket].sort((a, b) => a[0] - b[0])) console.log(`  ${String(ms).padStart(5)} ms  ${r.Layout} / ${r.Paint} / ${r.UpdateLayoutTree}`);
console.log(`totals over ${1400} ms: Layout ${total('Layout')}, Paint ${total('Paint')}, Style ${total('UpdateLayoutTree')}`);
await browser.close();
