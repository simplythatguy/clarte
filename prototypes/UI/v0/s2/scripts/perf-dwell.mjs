#!/usr/bin/env node
/**
 * Performance check for MOTION.md acceptance 8: record a Chrome trace while the gaze dwells on one
 * letter group (from the gaze arriving to just before the commit) and count main-thread rendering
 * work. Modes: dwell (default), baseline (gaze stays in the rest zone), noarc, nosound.
 *   node scripts/perf-dwell.mjs http://localhost:5102 [out.json]
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [url = 'http://localhost:5102', out, mode = 'dwell'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?phase=compose-words`, { waitUntil: 'networkidle' });
if (mode === 'nosound') {
  await page.evaluate(() => localStorage.setItem('clarte-style2-settings', JSON.stringify({ sound: false })));
  await page.reload({ waitUntil: 'networkidle' });
}
if (mode === 'noarc') await page.addStyleTag({ content: '.arcbox{display:none}' });
await page.mouse.move(720, 270);
await page.waitForTimeout(800);
await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-devtools.timeline.invalidationTracking', 'blink.user_timing'] });
await page.evaluate(() => performance.mark('dwell-start'));
if (mode !== 'baseline') await page.mouse.move(180, 225, { steps: 4 });
else await page.mouse.move(724, 274, { steps: 4 });  // baseline: gaze stays in the rest zone
await page.waitForTimeout(700);                 // the dwell itself: 150 ms hold + 600 ms dwell ends at 750 ms
await page.evaluate(() => performance.mark('dwell-end'));
await page.waitForTimeout(400);                 // the commit and its choreography, outside the window
await page.mouse.move(720, 270, { steps: 4 });
await page.waitForTimeout(400);
const trace = JSON.parse((await browser.stopTracing()).toString());
if (out) writeFileSync(out, JSON.stringify(trace));
const events = trace.traceEvents;
const mark = (name) => events.find((e) => e.name === name)?.ts;
const [t0, t1] = [mark('dwell-start'), mark('dwell-end')];
const inDwell = events.filter((e) => e.ts >= t0 && e.ts <= t1 && e.ph === 'X');
const sum = (name) => { const xs = inDwell.filter((e) => e.name === name); return { count: xs.length, ms: +(xs.reduce((s, e) => s + (e.dur ?? 0), 0) / 1000).toFixed(2) }; };
const report = {
  windowMs: +((t1 - t0) / 1000).toFixed(0),
  Layout: sum('Layout'),
  UpdateLayoutTree: sum('UpdateLayoutTree'),
  Paint: sum('Paint'),
  PrePaint: sum('PrePaint'),
  Commit: sum('Commit'),
  RunTask: sum('RunTask'),
  longestTaskMs: +(Math.max(0, ...inDwell.filter((e) => e.name === 'RunTask').map((e) => e.dur ?? 0)) / 1000).toFixed(2),
  frames: inDwell.filter((e) => e.name === 'DrawFrame' || e.name === 'Commit').length,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
