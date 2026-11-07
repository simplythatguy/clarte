#!/usr/bin/env node
/**
 * Contact sheet of a recorded demo: decodes the webm in Chromium and draws frames at the given
 * times into one PNG, so the saved recording itself can be inspected.
 *
 *   node scripts/frames.mjs evidence/demo-loop.webm out.png [t1,t2,...] [crop x,y,w,h as fractions]
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [file, outPng, list, cropArg] = process.argv.slice(2);
const crop = cropArg ? cropArg.split(',').map(Number) : null;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const data = readFileSync(file).toString('base64');
const result = await page.evaluate(async ({ data, list, crop }) => {
  const video = document.createElement('video');
  video.muted = true;
  video.src = `data:video/webm;base64,${data}`;
  await new Promise((r) => { video.onloadeddata = r; });
  // MediaRecorder webm often reports Infinity until seeked to the end.
  if (!Number.isFinite(video.duration)) { video.currentTime = 1e6; await new Promise((r) => { video.onseeked = r; }); }
  const duration = video.duration;
  const times = list ? list.split(',').map(Number) : Array.from({ length: 16 }, (_, i) => (duration * (i + 0.5)) / 16);
  const cols = 4, w = 360, h = 225, rows = Math.ceil(times.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * w; canvas.height = rows * (h + 22);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, t] of times.entries()) {
    video.currentTime = Math.min(t, duration - 0.05);
    await new Promise((r) => { video.onseeked = r; });
    const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 22);
    if (crop) {
      const [cx, cy, cw, ch] = crop; const vw = video.videoWidth, vh = video.videoHeight;
      ctx.drawImage(video, cx * vw, cy * vh, cw * vw, ch * vh, x, y, w, h);
    } else ctx.drawImage(video, x, y, w, h);
    ctx.fillStyle = '#000'; ctx.font = '14px sans-serif'; ctx.fillText(`${t.toFixed(2)} s`, x + 6, y + h + 16);
  }
  return { duration, png: canvas.toDataURL('image/png').split(',')[1] };
}, { data, list, crop });
const { writeFileSync } = await import('node:fs');
writeFileSync(outPng, Buffer.from(result.png, 'base64'));
console.log(`duration ${result.duration.toFixed(2)} s → ${outPng}`);
await browser.close();
