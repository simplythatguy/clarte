// Browser-side helpers for the fixture generator. Everything here runs inside
// Chromium via page.evaluate; it draws a photo of a face into a 1280×720 "camera" frame over a textured
// background, with a small drift per frame, so the real face landmarker and gaze network have something to track.
export const WIDTH = 1280, HEIGHT = 720;
export const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>face fixture</title></head><body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas></body></html>`;
/** Source for page.evaluate: defines window.fixture with drawFrame(index) → ImageData and workerCaller(url). */
export const FIXTURE_SCRIPT = String.raw`
window.fixture = (() => {
  const W = ${WIDTH}, H = ${HEIGHT};
  const canvas = document.getElementById('c'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let image = null;
  // Deterministic textured background: the camera-motion detector needs texture to match against.
  const background = document.createElement('canvas'); background.width = W; background.height = H;
  const b = background.getContext('2d'); let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  b.fillStyle = '#9a9a96'; b.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) { const g = Math.floor(90 + rnd() * 120); b.fillStyle = 'rgb(' + g + ',' + g + ',' + (g - 10) + ')'; b.fillRect(rnd() * W, rnd() * H * .85, 6 + rnd() * 40, 6 + rnd() * 40); }
  async function load(url) { image = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image failed: ' + url)); i.src = url; }); }
  /** faceHeightShare: how much of the frame height the photo covers. drift: px offset of the face for this frame. */
  function drawFrame(index, faceHeightShare = .62, extra = { dx: 0, dy: 0, scale: 1 }) {
    ctx.drawImage(background, 0, 0);
    const h = H * faceHeightShare * extra.scale, w = image.width * h / image.height;
    const dx = Math.sin(index / 6) * 3 + extra.dx, dy = Math.cos(index / 7) * 2 + extra.dy;
    ctx.drawImage(image, (W - w) / 2 + dx, (H - h) / 2 + 20 + dy, w, h);
    return ctx.getImageData(0, 0, W, H);
  }
  function workerCaller(url, deadlineMs = 120000) {
    const worker = new Worker(url); let id = 0;
    const call = (type, payload = null, transfer = []) => new Promise((resolve, reject) => {
      const me = ++id;
      const timer = setTimeout(() => { worker.removeEventListener('message', onMessage); reject(new Error(type + ' timed out')); }, deadlineMs);
      const onMessage = ({ data }) => { if (!data || data.id !== me) return; clearTimeout(timer); worker.removeEventListener('message', onMessage); if ('error' in data) reject(new Error(data.error)); else resolve(data.value); };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', e => { clearTimeout(timer); reject(new Error('worker error: ' + e.message)); }, { once: true });
      worker.postMessage({ id: me, type, payload }, transfer);
    });
    return { call, terminate: () => worker.terminate() };
  }
  const copy = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  // RGBA → I420 planes, for the y4m writer.
  function toI420(img) {
    const { width: w, height: h, data } = img; const y = new Uint8Array(w * h), u = new Uint8Array(w * h / 4), v = new Uint8Array(w * h / 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const p = (j * w + i) * 4, r = data[p], g = data[p + 1], bl = data[p + 2];
      y[j * w + i] = Math.max(0, Math.min(255, Math.round(.257 * r + .504 * g + .098 * bl + 16)));
      if ((i & 1) === 0 && (j & 1) === 0) { const q = (j / 2) * (w / 2) + i / 2; u[q] = Math.max(0, Math.min(255, Math.round(-.148 * r - .291 * g + .439 * bl + 128))); v[q] = Math.max(0, Math.min(255, Math.round(.439 * r - .368 * g - .071 * bl + 128))); } }
    const out = new Uint8Array(y.length + u.length + v.length); out.set(y); out.set(u, y.length); out.set(v, y.length + u.length);
    let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(s);
  }
  return { load, drawFrame, workerCaller, copy, toI420, W, H };
})();`;
