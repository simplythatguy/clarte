#!/usr/bin/env node
/**
 * A stand-in for the prediction engine that speaks the v1 contract (`Word Prediction/v1/CONTRACT.md`,
 * rounds 1–3) from the local decoder (`src/local.ts`), with a chosen latency, for driving the s6 UI
 * when the real engine is busy (the GPU benchmarks) or absent. Not a model: its words are the
 * fallback's. What it lets the UI tests exercise is everything that depends on the engine's timing
 * and shape: the dead-dwell fix at 0, 300, 700 and 3000 ms, the hold while the partner speaks,
 * `display` ("I", names), `branch` by the local rule, `corrected` on a slip page, `commit`.
 *
 *   node scripts/stub-engine.mjs [--port 8799] [--delay 0]
 *
 * `POST /api/v1/delay {"ms": 700}` changes the latency while running (the hostile script does).
 */
import { createServer } from 'node:http';
import { predictLocal, fallbackFor } from '../src/local.ts';
import { conflictFor } from '../src/conflict.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const PORT = Number(args.port ?? 8799);
let delay = Number(args.delay ?? 0);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'cache-control': 'no-store' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DISPLAY = { i: 'I', "i'm": "I'm", "i'll": "I'll", "i've": "I've", "i'd": "I'd" };

function predict(body) {
  const req = { history: body.history ?? [], message: body.message ?? [], groups: String(body.groups ?? ''), offset: Number(body.offset ?? 0), limit: Math.max(1, Math.min(64, Number(body.limit ?? 8))), ...(body.complete ? { complete: true } : {}) };
  const t0 = performance.now();
  const local = predictLocal(req, req.limit);
  const words = local.words.map((w) => {
    const out = { word: w.word, p: Number(w.p.toFixed(6)), complete: w.complete };
    const display = w.display ?? DISPLAY[w.word];
    if (display) out.display = display;
    return out;
  });
  // A slip page (round 3): nothing matches, the one-digit-off correction comes marked.
  if (!words.length && local.fallback?.kind === 'corrected' && !req.complete) words.push({ word: local.fallback.word, p: 1, complete: false, corrected: true });
  const branch = Boolean(req.groups && !req.complete && conflictFor(local, req.groups.length));
  return { id: body.id ?? null, groups: req.groups, words, total: local.total, longer: Number(local.longer.toFixed(6)), branch, ms: Number((performance.now() - t0).toFixed(1)) };
}

const server = createServer(async (req, res) => {
  const send = (status, obj) => res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(obj));
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (req.method === 'GET' && req.url === '/api/v1/health') { send(200, { ok: true, model: 'stub-local', rescorer: 'none', vocabulary: 22901, delay }); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { send(400, { error: 'bad json' }); return; }
  if (req.url === '/api/v1/delay') { delay = Number(body.ms ?? 0); send(200, { ok: true, delay }); return; }
  if (req.url === '/api/v1/predict') {
    if (delay) await sleep(delay);
    try { send(200, predict(body)); } catch (e) { send(500, { error: String(e) }); }
    return;
  }
  if (req.url === '/api/v1/commit') { send(200, { ok: true, ms: 0 }); return; }
  send(404, { error: 'not found' });
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub engine on http://127.0.0.1:${PORT} (delay ${delay} ms); fallbackFor('1') = ${JSON.stringify(fallbackFor('1'))}`));
