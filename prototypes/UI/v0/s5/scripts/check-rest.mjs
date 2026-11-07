#!/usr/bin/env node
/**
 * Style 5 acceptance: Q2 and Q3 are rest zones in every phase, at both check viewports.
 *   node scripts/check-rest.mjs http://localhost:5105
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'http://localhost:5105';
const browser = await chromium.launch();
let failures = 0;
for (const [width, height] of [[1440, 900], [1280, 720]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.clarteDebug?.phases?.length));
  for (const phase of await page.evaluate(() => window.clarteDebug.phases)) {
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(300);
    const owners = await page.evaluate(() => {
      const w = innerWidth / 4, h = innerHeight / 2;
      return [...document.querySelectorAll('[data-action]')].flatMap((el) => {
        const r = el.getBoundingClientRect();
        const hits = [];
        for (const [q, col] of [['Q2', 1], ['Q3', 2]]) {
          const ox = Math.min(r.right, (col + 1) * w) - Math.max(r.left, col * w);
          const oy = Math.min(r.bottom, h) - Math.max(r.top, 0);
          if (ox >= 2 && oy >= 2) hits.push(`${q}:${el.getAttribute('data-action')}`);
        }
        return hits;
      });
    });
    if (owners.length) failures += 1;
    console.log(`${owners.length ? 'FAIL' : 'ok  '} ${width}x${height} ${phase}: Q2 ${owners.some((o) => o.startsWith('Q2')) ? 'action' : 'rest'}, Q3 ${owners.some((o) => o.startsWith('Q3')) ? 'action' : 'rest'} ${owners.join(' ')}`);
  }
  await page.close();
}
await browser.close();
if (failures) { console.error(`${failures} phase(s) put an action in Q2 or Q3`); process.exit(1); }
console.log('Q2 and Q3 are rest in every phase');
