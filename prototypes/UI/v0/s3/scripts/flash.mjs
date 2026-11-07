#!/usr/bin/env node
/**
 * Mean screen luminance frame by frame through gaze-driven stage changes (BRIEF "Luminance": no
 * flashes; MOTION acceptance 5). Uses the Chromium screencast so every painted frame is sampled.
 *
 *   node scripts/flash.mjs http://localhost:5103
 */
import { chromium } from 'playwright';

const [url = 'http://localhost:5103'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);

async function measure(phase, look) {
  await page.goto(`${url}/?partner=script&phase=${phase}`, { waitUntil: 'networkidle' });
  await page.mouse.move(720, 120);
  await page.waitForTimeout(600);
  const frames = [];
  cdp.removeAllListeners('Page.screencastFrame');
  cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 360, maxHeight: 225, everyNthFrame: 1 });
  await page.mouse.move(look[0], look[1], { steps: 4 });
  await page.waitForTimeout(2000);
  await cdp.send('Page.stopScreencast');
  const lum = await page.evaluate(async (list) => {
    const out = [];
    for (const b64 of list) {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0;
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      out.push(sum / (d.length / 4));
    }
    return out;
  }, frames.map((f) => f.data));
  const t0 = frames[0]?.t ?? 0;
  const before = lum[0], after = lum[lum.length - 1];
  const lo = Math.min(...lum), hi = Math.max(...lum);
  const extreme = Math.max(Math.abs(hi - Math.max(before, after)), Math.abs(Math.min(before, after) - lo));
  console.log(`${phase} → (look at ${look}) ${lum.length} frames; start ${before.toFixed(3)}, end ${after.toFixed(3)}, range ${lo.toFixed(3)}–${hi.toFixed(3)}; overshoot beyond the two end states ${(extreme / Math.max(before, after) * 100).toFixed(1)}%`);
  console.log('  ' + lum.map((v, i) => `${Math.round((frames[i].t - t0) * 1000)}:${v.toFixed(3)}`).join(' '));
}

await measure('compose-empty', [180, 225]);   // Q1 Listen → Listen
await measure('listen', [600, 675]);          // Done → Compose
await measure('compose-message', [180, 225]); // Done → Speak
await browser.close();
