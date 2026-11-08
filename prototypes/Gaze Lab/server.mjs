// gaze-lab recording server: serves the built app from dist/ and the worker/model from public/, and accepts
// session parts at POST /api/session/<id>/<part>. Loopback only (127.0.0.1:4330). Nothing leaves the machine.
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MIME } from './scripts/lib/static-server.mjs';

const LAB = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 4330);
const SESSIONS = path.join(LAB, 'sessions');
const ROOTS = [path.join(LAB, 'dist'), path.join(LAB, 'public')];
const MAX_BODY = 256 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const PARTS = new Set(['session', 'frames', 'landmarks', 'video', 'replay', 'clarte', 'summary', 'calibration', 'quickcalibration', 'note']);
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const meta = { source: JSON.parse(await readFile(path.join(LAB, 'SOURCE.json'), 'utf8').catch(() => '{}')), workerSha256: await sha(path.join(LAB, 'public/vendor/webeyetrack/worker.js')).catch(() => null), shippedWorkerSha256: await sha(path.join(LAB, 'public/vendor/webeyetrack/worker.shipped.js')).catch(() => null) };
// Appends to one session are serialized so chunks land in upload order even if requests overlap.
const chains = new Map();
const serialize = (key, work) => { const next = (chains.get(key) ?? Promise.resolve()).then(work, work); chains.set(key, next.catch(() => {})); return next; };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
/** Splits a CLARTE-REPLAY-1 blob into PNGs and merges its entries into eyestrips/replay.json. */
export async function storeReplay(dir, body) {
  const head = body.subarray(0, 64).toString('latin1'), match = /^CLARTE-REPLAY-1 (\d{1,9})\n/.exec(head);
  if (!match) throw new Error('Not a Clarte replay file');
  const start = match[0].length, length = Number(match[1]);
  const manifest = JSON.parse(body.subarray(start, start + length).toString('utf8'));
  const base = start + length, out = path.join(dir, 'eyestrips');
  await mkdir(out, { recursive: true });
  const file = path.join(out, 'replay.json');
  const existing = JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) ?? { format: 'GAZE-LAB-EYESTRIPS-1', model: manifest.model, viewport: manifest.viewport, pixelRatio: manifest.pixelRatio, camera: manifest.camera, crop: manifest.crop ?? 'upstream', entries: [] };
  let index = existing.entries.length;
  for (const entry of manifest.entries) {
    const name = `${String(index++).padStart(5, '0')}.png`;
    await writeFile(path.join(out, name), body.subarray(base + entry.offset, base + entry.offset + entry.length));
    const { offset, length, ...rest } = entry;
    existing.entries.push({ ...rest, file: name, bytes: length });
  }
  await writeFile(file, JSON.stringify(existing) + '\n');
  return { entries: manifest.entries.length, total: existing.entries.length };
}
/** Builds <id>.clarte-session from the manifest and the uploaded video.webm, filling in the real byte count. */
export async function storeClarte(dir, id, manifestJson) {
  const manifest = JSON.parse(manifestJson.toString('utf8'));
  const videoFile = path.join(dir, 'video.webm');
  const info = await stat(videoFile).catch(() => null);
  if (!info) throw new Error('No video.webm uploaded for this session');
  manifest.video = { ...manifest.video, bytes: info.size };
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.from(`CLARTE-SESSION-1 ${json.byteLength}\n`, 'utf8');
  const target = path.join(dir, `${id}.clarte-session`);
  await writeFile(target, Buffer.concat([header, json, await readFile(videoFile)]));
  return { file: path.basename(target), bytes: header.length + json.length + info.size };
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, port: PORT });
  if (req.method === 'GET' && url.pathname === '/api/meta') return json(res, 200, { commit: meta.source.commit ?? null, app: meta.source.app ?? null, workerSha256: meta.workerSha256, shippedWorkerSha256: meta.shippedWorkerSha256 });
  const match = /^\/api\/session\/([^/]+)\/([a-z]+)$/.exec(url.pathname);
  if (!match || req.method !== 'POST') return json(res, 404, { error: 'Unknown endpoint' });
  const id = decodeURIComponent(match[1]), part = match[2];
  if (!ID.test(id)) return json(res, 400, { error: 'Invalid session id' });
  if (!PARTS.has(part)) return json(res, 400, { error: 'Unknown part' });
  const body = await readBody(req);
  const dir = path.join(SESSIONS, id);
  await mkdir(dir, { recursive: true });
  const result = await serialize(id, async () => {
    switch (part) {
      case 'frames': await appendFile(path.join(dir, 'frames.jsonl'), body); return { appended: body.length };
      case 'landmarks': await appendFile(path.join(dir, 'landmarks.f32'), body); return { appended: body.length };
      case 'video': await appendFile(path.join(dir, 'video.webm'), body); return { appended: body.length };
      case 'session': JSON.parse(body.toString('utf8')); await writeFile(path.join(dir, 'session.json'), body); return { written: body.length };
      case 'summary': JSON.parse(body.toString('utf8')); await writeFile(path.join(dir, 'summary.json'), body); return { written: body.length };
      case 'calibration': JSON.parse(body.toString('utf8')); await writeFile(path.join(dir, 'calibration.json'), body); return { written: body.length };
      case 'quickcalibration': JSON.parse(body.toString('utf8')); await writeFile(path.join(dir, 'quick-calibration.json'), body); return { written: body.length };
      case 'note': await appendFile(path.join(dir, 'notes.log'), body.toString('utf8').replace(/\n*$/, '\n')); return { appended: body.length };
      case 'replay': return storeReplay(dir, body);
      case 'clarte': return storeClarte(dir, id, body);
    }
  });
  return json(res, 200, { ok: true, ...result });
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }

async function serveFile(res, pathname) {
  for (const root of ROOTS) {
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(path.resolve(root) + path.sep)) continue;
    try {
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes); return true;
    } catch { /* next root */ }
  }
  return false;
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!(await serveFile(res, pathname))) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(pathname === '/index.html' ? 'dist/ is missing: run npm run build first' : 'Not found'); }
  } catch (error) { json(res, error.message === 'Body too large' ? 413 : 500, { error: error.message }); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(LAB, 'server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log(`gaze-lab: http://127.0.0.1:${PORT}  (sessions → ${SESSIONS})`));
}
