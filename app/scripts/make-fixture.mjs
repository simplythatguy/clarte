// Builds fixtures/face.y4m: a synthetic 1280×720 "webcam" loop made from the frontal face photo in fixtures/face, so
// Chromium's --use-file-for-fake-video-capture gives the app's real tracker worker a detectable face. It proves
// plumbing only: the eyes in a photo never move, so no accuracy claim can come from it.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from './lib/static-server.mjs';
import { FIXTURE_SCRIPT, PAGE, WIDTH, HEIGHT } from './lib/fixture-page.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO = 'gautam_biswas.jpg', SHARE = 1, FRAMES = 24, FPS = 30;
const served = await serveStatic({ roots: [path.join(APP, 'public'), path.join(APP, 'fixtures/face')], pages: { '/index.html': PAGE } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  await page.goto(served.origin + '/');
  await page.evaluate(FIXTURE_SCRIPT);
  // Every frame of the drift loop must give a face: the app's readiness gate (five fresh face frames in a row)
  // never opens on a face that flickers.
  const faces = await page.evaluate(async ({ photo, share, frames }) => {
    const f = window.fixture, worker = f.workerCaller('/vendor/webeyetrack/worker.js');
    try {
      await worker.call('init', { development: false });
      await f.load('/' + photo);
      let valid = 0;
      for (let i = 0; i < frames; i++) { const img = f.drawFrame(i, share); const r = await worker.call('step', { frame: img, at: i + 1, epoch: Date.now() }, [img.data.buffer]); if (r.face) valid++; }
      return valid;
    } finally { worker.terminate(); }
  }, { photo: PHOTO, share: SHARE, frames: FRAMES });
  if (faces !== FRAMES) throw new Error(`the tracker found a face in ${faces} of ${FRAMES} frames`);
  const header = `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`;
  const parts = [Buffer.from(header)];
  for (let i = 0; i < FRAMES; i++) {
    const b64 = await page.evaluate(([i, share]) => window.fixture.toI420(window.fixture.drawFrame(i, share)), [i, SHARE]);
    parts.push(Buffer.from('FRAME\n'), Buffer.from(b64, 'base64'));
  }
  const file = path.join(APP, 'fixtures/face.y4m');
  await writeFile(file, Buffer.concat(parts));
  console.log(`wrote ${file} (${Buffer.concat(parts).length} bytes)`);
} finally { await browser.close(); await served.close(); }
