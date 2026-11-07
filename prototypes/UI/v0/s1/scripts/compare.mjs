#!/usr/bin/env node
/**
 * The owner's bar: put the compose screen next to the light-direction mock at 1440×900, in one
 * image (BRIEF "Visual direction").
 *
 *   node scripts/compare.mjs http://localhost:5101 evidence/compose-vs-mock-1440x900.png
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5101', out = 'evidence/compose-vs-mock-1440x900.png'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}/?partner=script`);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); });
await page.reload();
await page.waitForFunction(() => window.clarteDebug);
await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
await page.mouse.move(720, 470);
await page.waitForTimeout(700);
const ours = (await page.screenshot()).toString('base64');
const mock = readFileSync(resolve('../s0/static.html'), 'utf8');
const mockPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mockPage.setContent(mock, { waitUntil: 'networkidle' });
await mockPage.waitForTimeout(600);
const theirs = (await mockPage.screenshot()).toString('base64');
const sheet = await browser.newPage({ viewport: { width: 2960, height: 1000 } });
await sheet.setContent(`<body style="margin:0;background:#E8E8ED;font:600 22px -apple-system,sans-serif;color:#1D1D1F">
  <div style="display:flex;gap:40px;padding:20px 20px 0"><div style="width:1440px">Style 1 · Rails (this build)</div><div>Light-direction mock (owner's minimum bar)</div></div>
  <div style="display:flex;gap:40px;padding:12px 20px 20px">
    <img src="data:image/png;base64,${ours}" width="1440" height="900">
    <img src="data:image/png;base64,${theirs}" width="1440" height="900">
  </div></body>`);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('saved', out);
