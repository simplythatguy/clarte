#!/usr/bin/env node
/**
 * Save the compose screen next to the light-direction mock at 1440×900, as BRIEF "Visual
 * direction" asks: node scripts/side-by-side.mjs http://localhost:5105 evidence/compose-vs-mock.png
 */
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const [url = 'http://localhost:5105', out = 'evidence/compose-vs-mock.png', phase = 'composing-pending'] = process.argv.slice(2);
const mock = resolve('../reference/11-light-direction-mock-1440x900.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/#phase=${phase}`);
await page.evaluate(() => localStorage.setItem('clarte.style5.v1', JSON.stringify({ calibrated: true })));
await page.reload();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
const ours = (await page.screenshot()).toString('base64');
const theirs = readFileSync(mock).toString('base64');
const sheet = await browser.newPage({ viewport: { width: 2000, height: 700 } });
await sheet.setContent(`<body style="margin:0;background:#E8E8ED;font:600 18px -apple-system,system-ui;color:#1D1D1F;display:flex;gap:40px;padding:32px 40px 24px">
  <figure style="margin:0"><img src="data:image/png;base64,${ours}" style="width:940px;display:block;border-radius:12px"><figcaption style="margin-top:10px">Style 5 · Dialogue, compose (1440×900)</figcaption></figure>
  <figure style="margin:0"><img src="data:image/png;base64,${theirs}" style="width:940px;display:block;border-radius:12px"><figcaption style="margin-top:10px">Light-direction mock, reference/11 (1440×900)</figcaption></figure>
</body>`);
await sheet.waitForTimeout(300);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('saved', out);
