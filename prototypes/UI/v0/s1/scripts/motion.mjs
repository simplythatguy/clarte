#!/usr/bin/env node
/**
 * MOTION.md acceptance aids.
 * 1. Frame strip: a group dwell, its commit and bloom, then a cancelled dwell draining, recorded
 *    at 25 fps and laid out frame by frame (40 ms per frame) in one image.
 * 2. Performance trace of a stationary dwell: counts of layout, style and paint events, and the
 *    area each paint covered (acceptance item 8).
 *
 *   node scripts/motion.mjs http://localhost:5101 evidence/motion
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5101', out = 'evidence/motion'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function open(page) {
  await page.goto(`${url}/?partner=script`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); });
  await page.reload();
  await page.waitForFunction(() => window.clarteDebug);
  await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
  await page.mouse.move(720, 470);
  await page.waitForTimeout(800);
}

// 1. Frame strip from screenshots taken every 40 ms (the strip is the scrub at 25 fps).
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await open(page);
  const clip = { x: 360, y: 620, width: 360, height: 260 }; // the G–N card (Q6)
  const frames = [];
  const grab = async (label) => frames.push({ label, data: (await page.screenshot({ clip })).toString('base64') });
  const t0 = Date.now();
  await page.mouse.move(540, 760);
  for (let i = 0; i < 18; i++) { await grab(`${Date.now() - t0} ms`); await page.waitForTimeout(25); }
  await page.keyboard.press('Space');
  for (let i = 0; i < 10; i++) { await grab(`${Date.now() - t0} ms · after Space`); await page.waitForTimeout(25); }
  await page.mouse.move(180, 760); // to A–F; G–N re-arms
  await page.waitForTimeout(500);
  await page.mouse.move(900, 760); // to O–S, then away mid-dwell: the drain
  await page.waitForTimeout(430);
  await page.mouse.move(900, 300); // Q3, well clear of every quadrant line
  const clip2 = { x: 720, y: 620, width: 360, height: 260 };
  const t1 = Date.now();
  for (let i = 0; i < 12; i++) { frames.push({ label: `left O–S +${Date.now() - t1} ms`, data: (await page.screenshot({ clip: clip2 })).toString('base64') }); await page.waitForTimeout(15); }
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 400 } });
  await sheet.setContent(`<body style="margin:0;padding:16px;background:#E8E8ED;font:600 13px -apple-system,sans-serif;color:#1D1D1F;display:grid;grid-template-columns:repeat(6,240px);gap:12px">${frames.map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${f.data}" width="240"><figcaption>${f.label}</figcaption></figure>`).join('')}</body>`);
  await sheet.screenshot({ path: join(out, 'dwell-frames.png'), fullPage: true });
  console.log('frames', frames.length);
  await page.close();
}

// 1b. A screen change (Menu opened by gaze + Space): the outgoing screen fades out while the
//     incoming one fades in from 100 ms, in place.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${url}/?partner=script`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); });
  await page.reload();
  await page.waitForFunction(() => window.clarteDebug);
  await page.evaluate(() => window.clarteDebug.setPhase('page2'));
  await page.mouse.move(720, 470); await page.waitForTimeout(500);
  const end = Date.now() + 1300;
  while (Date.now() < end) { await page.mouse.move(900 + Math.random() * 4, 196); await page.waitForTimeout(40); }
  const frames = [];
  await page.keyboard.press('Space');
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) { frames.push({ label: `+${Date.now() - t0} ms`, data: (await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 'css' })).toString('base64') }); await page.waitForTimeout(10); }
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 400 } });
  await sheet.setContent(`<body style="margin:0;padding:16px;background:#E8E8ED;font:600 13px -apple-system,sans-serif;color:#1D1D1F;display:grid;grid-template-columns:repeat(5,300px);gap:12px">${frames.map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${f.data}" width="300"><figcaption>${f.label}</figcaption></figure>`).join('')}</body>`);
  await sheet.screenshot({ path: join(out, 'screen-change-frames.png'), fullPage: true });
  await page.close();
}

// 2. Performance traces of a dwell with the pointer still (the tracker keeps sampling): the first
//    window covers the arrival and the 150 ms focus cue, the second only the arc filling.
async function trace(page, startAfter, length) {
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await page.mouse.move(540, 760);
  await page.waitForTimeout(startAfter);
  await cdp.send('Tracing.start', { categories: 'devtools.timeline' });
  await page.waitForTimeout(length);
  await cdp.send('Tracing.end');
  await done;
  const count = (name) => events.filter((e) => e.name === name && e.ph !== 'E').length;
  // The raw main-thread work, with its arguments, so each count can be attributed to a cause.
  const start = Math.min(...events.map((e) => e.ts).filter((t) => t > 0));
  const raw = events
    .filter((e) => ['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint'].includes(e.name) && e.ph !== 'E')
    .map((e) => ({ name: e.name, atMs: +((e.ts - start) / 1000).toFixed(2), durMs: e.dur ? +(e.dur / 1000).toFixed(3) : undefined, args: e.args }));
  return { fromMs: startAfter, lengthMs: length, layout: count('Layout'), styleRecalc: count('UpdateLayoutTree'), paint: count('Paint'), raw };
}
{
  const results = [];
  for (const [from, length] of [[0, 330], [330, 270]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await open(page);
    results.push(await trace(page, from, length));
    await page.close();
  }
  // The source these numbers were measured on: sha256 over every file in src/, sorted by name.
  const hash = createHash('sha256');
  for (const name of readdirSync(new URL('../src/', import.meta.url)).sort()) {
    hash.update(name).update(readFileSync(new URL(`../src/${name}`, import.meta.url)));
  }
  const summary = {
    source: hash.digest('hex'),
    windows: results.map(({ raw, ...counts }) => counts),
    events: results.map((r) => r.raw),
    note: 'G–N dwell (600 ms) in headless Chromium at 1440x900. Window 1: arrival, 150 ms quadrant hold and the 150 ms focus cue. Window 2: only the arc filling.',
  };
  writeFileSync(join(out, 'dwell-trace.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ source: summary.source, windows: summary.windows }));
}
await browser.close();
