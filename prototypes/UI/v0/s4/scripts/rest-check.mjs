#!/usr/bin/env node
/** Q7 and Q8 must be rest in every phase at both viewports: no actionable element touches them. */
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
let bad = 0;
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: 'networkidle' });
  for (const phase of await page.evaluate(() => window.clarteDebug.phases)) {
    await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
    await page.waitForTimeout(250);
    const owners = await page.evaluate(() => {
      const W = innerWidth, H = innerHeight, out = {};
      for (const el of document.querySelectorAll('[data-action]')) {
        if (el.closest('[aria-hidden="true"]') || el.getAttribute('aria-disabled') === 'true') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) continue;
        for (const [q, x0] of [['Q7', W / 2], ['Q8', W * 3 / 4]]) {
          if (Math.min(r.right, x0 + W / 4) - Math.max(r.left, x0) >= 2 && Math.min(r.bottom, H) - Math.max(r.top, H / 2) >= 2) (out[q] ??= []).push(el.dataset.action);
        }
      }
      return out;
    });
    const ok = !owners.Q7 && !owners.Q8;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}x${h} ${phase}: Q7 ${owners.Q7?.join(',') ?? 'rest'} · Q8 ${owners.Q8?.join(',') ?? 'rest'}`);
  }
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
