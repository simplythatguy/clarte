#!/usr/bin/env node
/** A dwell under prefers-reduced-motion: no arc, no bloom; the ring steps in opacity (acceptance 9). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104', outDir = 'evidence/motion'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.mouse.move(1180, 760);
await page.waitForTimeout(600);
// Each shot is timed from one moment, so screenshot time never pushes later shots late; the
// time actually reached is recorded beside each name.
const taken = {};
const shoot = async (t0, ms, name, clip) => {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  taken[name] = Date.now() - t0;
  await page.screenshot({ path: join(outDir, name), clip });
};
await page.mouse.move(540, 225, { steps: 1 });
const dwellAt = Date.now();
for (const ms of [120, 330, 520, 640]) await shoot(dwellAt, ms, `reduced-${ms}ms.png`, { x: 388, y: 40, width: 304, height: 352 });
// Calibration under reduced motion: the guide jumps, the target's ring appears in opacity steps.
await page.evaluate(() => window.clarteDebug.setPhase('calibration-points'));
await page.waitForSelector('.cal-target.is-active', { timeout: 10000 });
const activeAt = Date.now();
for (const ms of [100, 700, 1300, 1750]) await shoot(activeAt, ms, `reduced-calibration-${ms}ms.png`, { x: 40, y: 40, width: 200, height: 140 });
writeFileSync(join(outDir, 'reduced-times.json'), JSON.stringify(taken, null, 2));
await browser.close();
