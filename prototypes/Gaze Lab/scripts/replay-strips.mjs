#!/usr/bin/env node
// Pixel-level fidelity of the video replay: for every labelled calibration frame, the eye strip the worker cuts from the
// re-decoded VP9 frame versus the lossless strip the live worker kept (eyestrips/*.png + replay.json), plus the pretrained
// network's output on both (the live `network` of that row vs the replayed one). Explains the replay-vs-live gap: the
// landmarks match to sub-pixel, so what differs is the pixel content of the strip.
//   node scripts/replay-strips.mjs <session_dir> [--port 4335]      → replay-strips.md / .json in the session folder
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir, open } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const S = path.resolve(args.find(a => !a.startsWith('--')));
const forcedPort = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : null;
const session = JSON.parse(await readFile(path.join(S, 'session.json'), 'utf8'));
const rows = (await readFile(path.join(S, 'frames.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l, i) => ({ ...JSON.parse(l), idx: i }));
const replayJson = path.join(S, 'eyestrips/replay.json');
if (!existsSync(replayJson)) { console.log('no eyestrips/replay.json: strips were not recorded live'); process.exit(0); }
const replay = JSON.parse(await readFile(replayJson, 'utf8'));
const name = (await readdir(S)).find(n => n.endsWith('.clarte-session'));
const fh = await open(path.join(S, name)); const head = Buffer.alloc(64); await fh.read(head, 0, 64, 0);
const m = /^CLARTE-SESSION-1 (\d{1,9})\n/.exec(head.toString('latin1')); const buf = Buffer.alloc(Number(m[1])); await fh.read(buf, 0, buf.length, m[0].length); await fh.close();
const manifest = JSON.parse(buf.toString('utf8'));
const labelRows = rows.filter(r => r.block === 'C0' && (r.phase ?? '').endsWith(':label'));
const labels = manifest.events.filter(e => e.type === 'label').map(e => { const row = labelRows.reduce((b, r) => (Math.abs(r.videoT - e.t) < Math.abs(b.videoT - e.t) ? r : b), labelRows[0]); return { rowIdx: row.idx, x: e.x, y: e.y, t: e.t }; });
const liveStrips = {};
for (const e of replay.entries) if (e.kind === 'calibration') { const row = rows.find(r => r.t === e.at); if (row) liveStrips[row.idx] = e.file; }
const align = existsSync(path.join(S, 'replay-align.json')) ? JSON.parse(await readFile(path.join(S, 'replay-align.json'), 'utf8')) : null;
const offsetMs = args.includes('--offset') ? Number(args[args.indexOf('--offset') + 1]) : (align?.offsetMs ?? 0);
async function freePort() { for (const port of forcedPort ? [forcedPort] : [4335, 4336, 4337, 4338]) { const ok = await new Promise(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(port, '127.0.0.1', () => s.close(() => r(true))); }); if (ok) return port; } throw new Error('no free port'); }
const bundle = await build({ entryPoints: [path.join(LAB, 'scripts/lib/replay-page.ts')], bundle: true, write: false, format: 'iife', target: 'es2022' });
const http = await import('node:http');
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p === '/replay-page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (p === '/' || p === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); return; }
  for (const root of [path.join(LAB, 'public'), S]) { const file = path.resolve(root, '.' + p); if (!file.startsWith(root + path.sep)) continue; try { const bytes = await readFile(file); res.setHeader('Content-Type', { '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.webm': 'video/webm', '.png': 'image/png' }[path.extname(file)] ?? 'application/octet-stream'); res.end(bytes); return; } catch { /* next */ } }
  res.writeHead(404); res.end();
});
const port = await freePort(); await new Promise(r => server.listen(port, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  page.on('console', msg => { const t = msg.text(); if (msg.type() === 'error' || t.startsWith('[replay]')) console.log('  ', t); });
  await page.goto(`http://127.0.0.1:${port}/`); await page.addScriptTag({ url: '/replay-page.js' });
  result = await page.evaluate(P => window.replay.run(P), { videoUrl: '/video.webm', landmarksUrl: existsSync(path.join(S, 'landmarks.f32')) ? '/landmarks.f32' : null, workerUrl: '/vendor/webeyetrack/worker.js',
    rows: rows.filter(r => typeof r.videoT === 'number' && r.videoT >= 0).map(r => ({ idx: r.idx, t: r.t, videoT: r.videoT, landmarkRow: r.landmarkRow ?? null })), labels, trainRowIdx: null, trainAt: Infinity,
    fixes: { matrixLayout: false, freezePose: false }, mode: 'strips', offsetMs, alignRows: [], maxGapMs: 40, maxWidth: 1280, liveStrips });
} finally { await browser.close(); server.close(); }
const W = session.viewport.width, H = session.viewport.height;
const med = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const ok = result.strips.filter(s => !s.error);
for (const s of ok) { const row = rows[s.idx]; s.liveNetwork = row.network; s.networkDeltaPx = row.network && s.replayNetwork ? Math.hypot((s.replayNetwork[0] - row.network[0]) * W, (s.replayNetwork[1] - row.network[1]) * H) : null; s.landmarkMeanAbsDelta = result.records.find(r => r.idx === s.idx)?.lmd ?? null; }
const out = { session: session.id, offsetMs, labels: labels.length, compared: ok.length, errors: result.strips.filter(s => s.error), stripMeanAbs: { median: med(ok.map(s => s.meanAbs)), max: Math.max(...ok.map(s => s.meanAbs)) }, psnr: { median: med(ok.map(s => s.psnr)), min: Math.min(...ok.map(s => s.psnr)) },
  networkDeltaPx: { median: med(ok.map(s => s.networkDeltaPx)), p90: [...ok.map(s => s.networkDeltaPx)].sort((a, b) => a - b)[Math.ceil(.9 * ok.length) - 1], max: Math.max(...ok.map(s => s.networkDeltaPx)) }, landmarkMeanAbsDelta: { median: med(ok.map(s => s.landmarkMeanAbsDelta).filter(v => v !== null)) }, strips: ok, elapsedS: result.elapsedS };
await writeFile(path.join(S, 'replay-strips.json'), JSON.stringify(out, null, 1) + '\n');
const signed = [0, 1, 2].map(c => med(ok.map(s => s.signedMeanRGB[c])));
out.signedMeanRGB = signed; out.meanLiveRGB = [0, 1, 2].map(c => med(ok.map(s => s.meanLiveRGB[c])));
const L = [`# Replay strips · ${session.id}`, '', `${ok.length} of ${labels.length} labelled calibration frames compared (clock offset ${offsetMs} ms). Signed mean difference replay − live per channel (median over strips): R ${signed[0].toFixed(2)}, G ${signed[1].toFixed(2)}, B ${signed[2].toFixed(2)} (live strip mean RGB ${out.meanLiveRGB.map(v => v.toFixed(0)).join('/')}). The worker's 512×128 eye strip cut from the re-decoded VP9 frame vs the lossless strip the live worker kept of the same frame: mean |Δ| per RGB value median ${out.stripMeanAbs.median.toFixed(2)} (max ${out.stripMeanAbs.max.toFixed(2)}) of 255, PSNR median ${out.psnr.median.toFixed(1)} dB (min ${out.psnr.min.toFixed(1)}). Landmarks of the same frames: mean |Δ| ${out.landmarkMeanAbsDelta.median.toExponential(2)} normalized (≈ ${(out.landmarkMeanAbsDelta.median * 1280).toFixed(2)} px). Pretrained network (before any training) on the replayed strip vs the live value: |Δ| median ${out.networkDeltaPx.median.toFixed(1)} px, p90 ${out.networkDeltaPx.p90.toFixed(1)}, max ${out.networkDeltaPx.max.toFixed(1)} (CSS px of ${W}×${H}).`, '',
  '| label | row | strip mean \\|Δ\\| | PSNR dB | network \\|Δ\\| px | landmarks mean \\|Δ\\| |', '|---|---|---|---|---|---|'];
for (const s of ok) L.push(`| (${s.label[0].toFixed(2)}, ${s.label[1].toFixed(2)}) | ${s.idx} | ${s.meanAbs.toFixed(2)} | ${s.psnr.toFixed(1)} | ${s.networkDeltaPx === null ? '—' : s.networkDeltaPx.toFixed(1)} | ${s.landmarkMeanAbsDelta === null ? '—' : s.landmarkMeanAbsDelta.toExponential(2)} |`);
await writeFile(path.join(S, 'replay-strips.md'), L.join('\n') + '\n');
console.log(L[2]); console.log(`wrote ${path.join(S, 'replay-strips.{md,json}')}`);
