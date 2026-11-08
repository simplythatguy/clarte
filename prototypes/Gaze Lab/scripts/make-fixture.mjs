// Builds fixtures/face.y4m: a synthetic 1280×720 "webcam" loop made from a frontal face photo shipped with the
// vendored WebEyeTrack docs, so Chromium's --use-file-for-fake-video-capture gives the real worker a detectable
// face. It proves plumbing only: the eyes in a photo never move, so no accuracy claim can come from it.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from './lib/static-server.mjs';
import { FIXTURE_SCRIPT, PAGE, WIDTH, HEIGHT } from './lib/fixture-page.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS = ['gautam_biswas.jpg', 'amanda_goodwin.jpg', 'yike_zhang.jpeg', 'sara_mcfadden.png', 'jorge_a_salas.jpeg', 'yashvitha_thatigotla.jpeg'];
const FRAMES = 24, FPS = 30;
const served = await serveStatic({ roots: [path.join(LAB, 'public'), path.join(LAB, 'vendor/webeyetrack/docs/public')], pages: { '/index.html': PAGE } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  await page.goto(served.origin + '/');
  await page.evaluate(FIXTURE_SCRIPT);
  const probe = await page.evaluate(async (photos) => {
    const f = window.fixture, worker = f.workerCaller('/vendor/webeyetrack/worker.shipped.js');
    const results = [];
    try {
      await worker.call('init', { development: false });
      let at = 0;
      // Every frame of the drift loop must give a face with open eyes: a marginal face flickers frame to frame and
      // the app's readiness gate (five fresh face frames in a row) then never opens.
      for (const photo of photos) {
        await f.load('/profiles/' + photo);
        for (const share of [1, .9, .8]) {
          let valid = 0;
          for (let i = 0; i < 24; i++) { const img = f.drawFrame(i, share); const r = await worker.call('step', { frame: img, at: ++at, epoch: Date.now() }, [img.data.buffer]); if (r.face) valid++; }
          results.push({ photo, share, validShare: valid / 24 });
          if (valid === 24) return { chosen: { photo, share }, results };
        }
      }
    } finally { worker.terminate(); }
    return { chosen: null, results };
  }, PHOTOS);
  console.log(JSON.stringify(probe.results, null, 0).slice(0, 2000));
  if (!probe.chosen) throw new Error('No photo gave a detected face with open eyes; see probe results above.');
  console.log('chosen', probe.chosen);
  await page.evaluate(async photo => { await window.fixture.load('/profiles/' + photo); }, probe.chosen.photo);
  const header = `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`;
  const parts = [Buffer.from(header)];
  for (let i = 0; i < FRAMES; i++) {
    const b64 = await page.evaluate(([i, share]) => window.fixture.toI420(window.fixture.drawFrame(i, share)), [i, probe.chosen.share]);
    parts.push(Buffer.from('FRAME\n'), Buffer.from(b64, 'base64'));
  }
  await mkdir(path.join(LAB, 'fixtures'), { recursive: true });
  const file = path.join(LAB, 'fixtures/face.y4m');
  await writeFile(file, Buffer.concat(parts));
  await writeFile(path.join(LAB, 'fixtures/face.json'), JSON.stringify({ photo: probe.chosen.photo, source: 'vendor/webeyetrack/docs/public/profiles (upstream WebEyeTrack docs, MIT)', faceHeightShare: probe.chosen.share, frames: FRAMES, fps: FPS, width: WIDTH, height: HEIGHT, note: 'Synthetic camera for plumbing tests only. A photo cannot move its eyes; nothing measured on it says anything about gaze accuracy.' }, null, 2) + '\n');
  console.log(`wrote ${file} (${Buffer.concat(parts).length} bytes)`);
} finally { await browser.close(); await served.close(); }
