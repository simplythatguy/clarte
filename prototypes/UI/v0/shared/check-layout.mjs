#!/usr/bin/env node
/**
 * Walk every phase of a running style app, assert zero Backend Quadrant violations, and save a
 * screenshot per phase and viewport.
 *
 *   node prototypes/UI/v0/shared/check-layout.mjs http://localhost:5101 /path/to/out-dir
 *
 * The app must expose `window.clarteDebug = { phases, phase(), setPhase(name), validate(), engine }`.
 * Requires playwright in the calling style's node_modules (`npm i -D playwright@1.64.1`) and a
 * matching Chromium (`npx playwright install chromium`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: check-layout.mjs <url> <out-dir>');
  process.exit(2);
}
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
let failures = 0;
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.clarteDebug?.phases?.length), null, { timeout: 15000 });
    const phases = await page.evaluate(() => window.clarteDebug.phases);
    for (const phase of phases) {
      await page.evaluate((name) => window.clarteDebug.setPhase(name), phase);
      await page.waitForTimeout(500);
      const result = await page.evaluate(() => ({
        phase: window.clarteDebug.phase(),
        violations: window.clarteDebug.validate(),
        actions: Array.from(document.querySelectorAll('[data-action]')).map((el) => el.getAttribute('data-action')),
      }));
      const file = join(outDir, `${viewport.name}-${phase}.png`);
      await page.screenshot({ path: file });
      const ok = result.violations.length === 0;
      if (!ok) failures += 1;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${viewport.name} ${phase}: ${result.actions.length} actions [${result.actions.join(', ')}]${ok ? '' : ` violations ${JSON.stringify(result.violations)}`} → ${file}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (failures) { console.error(`${failures} phase/viewport combination(s) violate the Backend Quadrant rule`); process.exit(1); }
console.log('layout ok in every phase');
