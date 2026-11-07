#!/usr/bin/env node
/**
 * Record the whole compose loop at 1440×900 with the mouse standing in for gaze, as a WebM, and
 * save a frame-by-frame screencast of one dwell for scrubbing.
 *   node scripts/record-demo.mjs http://localhost:5105 <out-dir>
 * Every selection below is a real dwell (the pointer rests on a tile) unless marked "key".
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const [url = 'http://localhost:5105', out = 'evidence'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const Q = { 1: [180, 200], 4: [1260, 200], 5: [180, 700], 6: [540, 700], 7: [900, 700], 8: [1260, 700], rest: [720, 230] };
const look = async (q, ms) => { const [x, y] = Q[q]; await page.mouse.move(x, y, { steps: 8 }); await wait(ms); };
const dwell = async (q, ms = 1250) => { await look(q, ms); await look('rest', 450); };
const phase = () => page.evaluate(() => window.clarteDebug.phase());

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => document.fonts.ready);
await look('rest', 0);
// First run: positioning and the first three points of calibration, then skip.
await wait(2600 + 700 + 3400 * 3);
await page.keyboard.press('Escape');            // key: skip calibration
await wait(900);
await dwell(1);                                 // Listen
await wait(3200);                               // the partner speaks (scripted)
await dwell(1);                                 // Stop: the turn joins the thread, a reply is suggested
await wait(1400);
// Type "tired": T–Z, G–N, O–S, A–F, A–F (the last double needs a look away and back)
for (const q of [8, 6, 7, 5]) await dwell(q, 900);
await dwell(5, 900);
await wait(600);
await dwell(1);                                 // Accept "tired"
await dwell(4);                                 // Delete: reopen at the next candidate
await wait(700);
await dwell(4);                                 // Delete word
for (const q of [8, 6, 7, 5]) await dwell(q, 900);
await dwell(5, 900);
await dwell(1);                                 // Accept "tired"
await wait(500);
await dwell(1);                                 // Speak
await wait(2600);                               // spoken-word highlight, then Say again
await dwell(4);                                 // Menu
await dwell(6);                                 // Settings
await wait(500);
await dwell(1);                                 // Back
await dwell(1);                                 // Back to the conversation
await wait(1200);
console.log('final phase', await phase());

// Frame-by-frame screencast of one dwell on a group, for 10% scrubbing.
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); });
await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
await look('rest', 600);
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1440, maxHeight: 900 });
await look(6, 1100);                            // dwell to commit and bloom
await look('rest', 500);                        // re-arm fade
await look(7, 380);                             // start a dwell, then leave: drain
await look('rest', 400);
await cdp.send('Page.stopScreencast');
const dir = join(out, 'dwell-frames');
mkdirSync(dir, { recursive: true });
const t0 = frames[0]?.t ?? 0;
frames.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(3, '0')}-${Math.round((f.t - t0) * 1000)}ms.png`), Buffer.from(f.data, 'base64')));
console.log('dwell frames', frames.length);

const video = page.video();
await context.close();
if (video) { const path = await video.path(); renameSync(path, join(out, 'demo-loop.webm')); console.log('video', join(out, 'demo-loop.webm')); }
await browser.close();
