#!/usr/bin/env node
/**
 * What the browser does while a dwell fills (MOTION.md acceptance 8).
 *
 *   node scripts/perf-dwell.mjs http://localhost:5104 evidence/perf-dwell.json
 *
 * Rests the pointer on a key long enough to commit, records a Chrome trace for the dwell window,
 * and reports how many Layout, Paint, style recalculation and composite events ran, and their time.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5104', out = 'evidence/perf-dwell.json'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.mouse.move(1180, 760); // rest zone
await page.waitForTimeout(800);

const windows = {};
// Windows: idle; the arc filling (from 320 ms after arrival, after the focus step has settled,
// to 560 ms, before the 600 ms commit); and the commit with its bloom.
for (const [name, x, y, lead, ms] of [['idle (rest zone)', 1180, 760, 0, 700], ['arc filling on G-N, 320-560 ms', 540, 225, 320, 240], ['arc filling on G-N, steady, 420-580 ms', 540, 225, 420, 160], ['commit and bloom', 540, 225, 580, 500]]) {
  await page.mouse.move(x, y, { steps: 1 });
  if (lead) await page.waitForTimeout(lead);
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const buffer = await browser.stopTracing();
  const events = JSON.parse(buffer.toString()).traceEvents ?? [];
  const tally = {};
  for (const e of events) {
    const key = { Layout: 'Layout', Paint: 'Paint', UpdateLayoutTree: 'Recalculate style', RecalculateStyles: 'Recalculate style', 'Layerize': 'Layerize', CompositeLayers: 'Composite', 'Commit': 'Commit' }[e.name];
    if (!key || e.ph !== 'X') continue;
    tally[key] ??= { count: 0, ms: 0 };
    tally[key].count += 1;
    tally[key].ms += (e.dur ?? 0) / 1000;
  }
  for (const v of Object.values(tally)) v.ms = +v.ms.toFixed(2);
  windows[name] = { windowMs: Date.now() - t0, ...tally };
  await page.mouse.move(1180, 760, { steps: 1 });
  await page.waitForTimeout(900);
}
await browser.close();
writeFileSync(out, JSON.stringify(windows, null, 2));
console.log(JSON.stringify(windows, null, 2));
