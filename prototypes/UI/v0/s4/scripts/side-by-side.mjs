#!/usr/bin/env node
/** The compose screen next to the owner's light-direction mock, both at 1440×900, in one image. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104', out = 'evidence/side-by-side-mock.png'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const app = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await app.goto(`${url}/?phase=composing-pending`, { waitUntil: 'networkidle' });
await app.evaluate(() => document.fonts.ready);
await app.waitForTimeout(600);
const mine = (await app.screenshot()).toString('base64');
const mock = readFileSync('../reference/11-light-direction-mock-1440x900.png').toString('base64');
const sheet = await browser.newPage({ viewport: { width: 2960, height: 1000 } });
await sheet.setContent(`<style>body{margin:0;background:#fff;font:600 28px system-ui;color:#1d1d1f;display:flex;gap:40px;padding:20px 20px 0}figure{margin:0}img{width:1440px;height:900px;display:block;outline:1px solid #d2d2d7}figcaption{padding:12px 0 0}</style>
<figure><img src="data:image/png;base64,${mock}"><figcaption>Owner's light-direction mock (minimum bar)</figcaption></figure>
<figure><img src="data:image/png;base64,${mine}"><figcaption>Style 4 · Split, compose, same viewport</figcaption></figure>`);
await sheet.waitForTimeout(300);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
