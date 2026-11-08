#!/usr/bin/env node
// Replays a recorded gaze-lab session's webcam video through the gaze-lab worker build with candidate fixes on or off and
// scores every block, without another live session.
//
//   node scripts/replay-blocks.mjs <session_dir> --fixes none|layout|freeze|both [--port 4335-4338] [--offset <ms>] [--no-align]
//
// Headless Chromium (Playwright, SwiftShader WebGL as analysis/rerun_head.mjs): video.webm is decoded frame by frame with
// WebCodecs (dev/webm-demux.ts); for every live frames.jsonl row with a video time the nearest decoded frame (within 40 ms of
// row.videoT + offset) is stepped through the worker with the live `t` as its clock, so the replay sees the frame sequence
// the live worker saw (the face landmarker runs in IMAGE mode, so only the blink state, the depth guess and the camera-motion
// detector carry state between frames). The 42 recorded calibration labels (.clarte-session `label` events, video clock) are
// collected on their recorded frames (or the next frames within +150 ms), `train` runs at the recorded `train` moment, and
// every block is stepped. Output in the session folder: replay-<fixes>.jsonl (one row per stepped frame, joined to the live
// row: block/point/phase/target plus the live estimates for the fidelity gate), replay-<fixes>.json (summary) and
// replay-<fixes>.md (fidelity gate + per-block table with analysis/analyze.py's statistics).
//
// Offset: MediaRecorder timestamps and the live `videoT` (performance.now at canvas capture minus the recorder start) differ
// by the capture-to-display latency. Unless --offset is given, an alignment pass steps the five decoded frames around 60
// sampled live rows and picks the offset whose frame reproduces the recorded landmarks (landmarks.f32) best; the chosen offset
// is written to replay-align.json and reused by later variants so every variant steps the same frames.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { serveStatic } from './lib/static-server.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = [4335, 4336, 4337, 4338];
const FIXES = { none: { matrixLayout: false, freezePose: false }, layout: { matrixLayout: true, freezePose: false }, freeze: { matrixLayout: false, freezePose: true }, both: { matrixLayout: true, freezePose: true } };
const args = process.argv.slice(2);
const opt = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const sessionDir = args.find(a => !a.startsWith('--') && !Object.values(FIXES).includes(a) && existsSync(path.join(a, 'session.json')));
const fixesName = opt('--fixes', 'none');
if (!sessionDir || !(fixesName in FIXES)) { console.error('usage: node scripts/replay-blocks.mjs <session_dir> --fixes none|layout|freeze|both [--port 4335] [--offset ms] [--no-align]'); process.exit(1); }
const S = path.resolve(sessionDir);
const forcedPort = opt('--port') ? Number(opt('--port')) : null;
// --suffix <s>: write replay-<fixes><s>.* (a repeat run for replay-vs-replay repeatability) without touching the main outputs.
const suffix = opt('--suffix', '');
const outName = fixesName + suffix;
const MAX_GAP_MS = 40;

const session = JSON.parse(await readFile(path.join(S, 'session.json'), 'utf8'));
const rows = (await readFile(path.join(S, 'frames.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
rows.forEach((r, i) => { r.idx = i; });
const manifestFile = (await import('node:fs/promises')).readdir(S).then(names => names.find(n => n.endsWith('.clarte-session')));
const manifest = await (async () => {
  const name = await manifestFile; if (!name) throw new Error('no .clarte-session file');
  const fh = await (await import('node:fs/promises')).open(path.join(S, name));
  try {
    const head = Buffer.alloc(64); await fh.read(head, 0, 64, 0);
    const m = /^CLARTE-SESSION-1 (\d{1,9})\n/.exec(head.toString('latin1')); if (!m) throw new Error('not a session file');
    const buf = Buffer.alloc(Number(m[1])); await fh.read(buf, 0, buf.length, m[0].length);
    return JSON.parse(buf.toString('utf8'));
  } finally { await fh.close(); }
})();
const labelEvents = manifest.events.filter(e => e.type === 'label');
const trainAt = manifest.events.find(e => e.type === 'train')?.t ?? null;
if (labelEvents.length !== 42 || trainAt === null) throw new Error(`expected 42 labels and a train event, got ${labelEvents.length} / ${trainAt}`);
const W = session.viewport.width, H = session.viewport.height, cmPerPx = session.screen?.cmPerCssPx ?? null;
const liveRows = rows.filter(r => typeof r.videoT === 'number' && r.videoT >= 0);
// Each label event sits on the live row the worker labelled (phase *:label, same video time to 0.1 ms).
const labelRows = rows.filter(r => r.block === 'C0' && (r.phase ?? '').endsWith(':label'));
const labels = labelEvents.map(e => {
  const row = labelRows.reduce((best, r) => (Math.abs(r.videoT - e.t) < Math.abs(best.videoT - e.t) ? r : best), labelRows[0]);
  if (Math.abs(row.videoT - e.t) > 1) throw new Error(`label at ${e.t} has no live label row (nearest ${row.videoT})`);
  return { rowIdx: row.idx, x: e.x, y: e.y, t: e.t };
});
const trainRow = liveRows.find(r => r.videoT >= trainAt);
const finalBlocks = session.blocks.filter(b => b.status === 'complete');
const finalKeys = new Set(finalBlocks.map(b => b.key));

async function freePort() {
  for (const port of forcedPort ? [forcedPort] : PORTS) {
    const ok = await new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (ok) return port;
  }
  throw new Error(`no free port in ${PORTS.join(', ')}`);
}
const bundle = await build({ entryPoints: [path.join(LAB, 'scripts/lib/replay-page.ts')], bundle: true, write: false, format: 'iife', target: 'es2022' });
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>gaze-lab replay</title></head><body></body></html>';
const served = await serveStatic({ roots: [path.join(LAB, 'public'), S], pages: { '/index.html': PAGE, '/replay-page.js': bundle.outputFiles[0].text }, port: await freePort() });
// serveStatic sets text/html for in-memory pages; serve the script through its own tiny route instead.
served.server.removeAllListeners('request');
served.server.on('request', async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p === '/replay-page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (p === '/' || p === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); return; }
  for (const root of [path.join(LAB, 'public'), S]) {
    const file = path.resolve(root, '.' + p); if (!file.startsWith(root + path.sep)) continue;
    try { const bytes = await readFile(file); const ext = path.extname(file); res.setHeader('Content-Type', { '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.webm': 'video/webm', '.task': 'application/octet-stream', '.bin': 'application/octet-stream', '.f32': 'application/octet-stream' }[ext] ?? 'application/octet-stream'); res.end(bytes); return; } catch { /* next */ }
  }
  res.writeHead(404); res.end();
});
console.log(`serving ${served.origin}; session ${session.id}; ${rows.length} live rows (${liveRows.length} with video time), 42 labels, train at ${trainAt} ms (live row ${trainRow?.idx}), fixes ${fixesName} ${JSON.stringify(FIXES[fixesName])}`);

const basePayload = {
  videoUrl: '/video.webm', landmarksUrl: existsSync(path.join(S, 'landmarks.f32')) ? '/landmarks.f32' : null, workerUrl: '/vendor/webeyetrack/worker.js',
  rows: liveRows.map(r => ({ idx: r.idx, t: r.t, videoT: r.videoT, landmarkRow: r.landmarkRow ?? null })),
  labels, trainRowIdx: trainRow?.idx ?? null, trainAt, fixes: FIXES[fixesName], maxGapMs: MAX_GAP_MS, maxWidth: 1280,
};
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const median = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const p90 = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(.9 * s.length) - 1))] : NaN; };
let result, align = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error', e.message));
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.startsWith('[replay]')) console.log('  ', t); });
  await page.goto(served.origin + '/');
  await page.addScriptTag({ url: '/replay-page.js' });
  // ---- offset: given, cached, or measured ----
  const alignFile = path.join(S, 'replay-align.json');
  let offsetMs = opt('--offset') !== null ? Number(opt('--offset')) : null;
  if (offsetMs === null && existsSync(alignFile) && !args.includes('--realign')) { align = JSON.parse(await readFile(alignFile, 'utf8')); offsetMs = align.offsetMs; console.log(`offset ${offsetMs} ms from ${alignFile}`); }
  if (offsetMs === null) {
    if (!basePayload.landmarksUrl) throw new Error('alignment needs landmarks.f32; pass --offset');
    const candidates = liveRows.filter(r => r.facePresent && r.landmarkRow !== null && r.videoT > 1000);
    const sample = Array.from({ length: 60 }, (_, i) => candidates[Math.floor((i + .5) * candidates.length / 60)].idx);
    const a = await page.evaluate(P => window.replay.run(P), { ...basePayload, mode: 'align', offsetMs: 0, alignRows: sample });
    // Per sampled row: which of the five frames (k = -2..2 around the nearest) reproduces the landmarks best; offset = that frame's time minus videoT.
    const byRow = new Map();
    for (const rec of a.alignRecords) if (rec.lmd !== null) byRow.set(rec.idx, [...(byRow.get(rec.idx) ?? []), rec]);
    const picks = [...byRow.values()].map(list => list.reduce((b, r) => (r.lmd < b.lmd ? r : b))).map(r => ({ idx: r.idx, k: r.k, offset: r.ts - r.videoT, lmd: r.lmd }));
    const kHist = {}; picks.forEach(p => { kHist[p.k] = (kHist[p.k] ?? 0) + 1; });
    offsetMs = Math.round(median(picks.map(p => p.offset)) * 10) / 10;
    const lmdAtBest = median(picks.map(p => p.lmd)), lmdAtNeighbours = median(a.alignRecords.filter(r => r.lmd !== null && Math.abs(r.k - (picks.find(p => p.idx === r.idx)?.k ?? 99)) === 1).map(r => r.lmd));
    align = { offsetMs, samples: picks.length, kHistogram: kHist, offsetRangeMs: [Math.min(...picks.map(p => p.offset)), Math.max(...picks.map(p => p.offset))], landmarkMeanAbsDeltaAtBestFrame: lmdAtBest, landmarkMeanAbsDeltaAtAdjacentFrames: lmdAtNeighbours, videoFrameDtMs: a.video.frameDtMs, elapsedS: a.elapsedS };
    await writeFile(alignFile, JSON.stringify(align, null, 1) + '\n');
    console.log(`alignment: offset ${offsetMs} ms (median over ${picks.length} rows; frame picks ${JSON.stringify(kHist)}; landmark mean|Δ| best ${lmdAtBest.toExponential(2)} vs adjacent frames ${lmdAtNeighbours.toExponential(2)}) in ${a.elapsedS.toFixed(0)} s → ${alignFile}`);
  }
  result = await page.evaluate(P => window.replay.run(P), { ...basePayload, mode: 'run', offsetMs, alignRows: [] });
  result.offsetMs = offsetMs;
} finally { await browser.close(); await served.close(); }

// ---- join with the live rows, write jsonl ----
const toPx = p => [(p[0] + .5) * W, (p[1] + .5) * H];
const finite2 = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const out = result.records.map(rec => {
  const r = rows[rec.idx];
  return { i: r.idx, t: r.t, videoT: r.videoT, ts: rec.ts, gapMs: Math.round(rec.gap * 10) / 10, screen: r.screen, block: r.block, point: r.point, phase: r.phase, target: r.target,
    facePresent: rec.fp, eyeState: rec.es, rawNormPog: rec.raw, network: rec.net, geometric: rec.geo, headVector: rec.hv, faceOrigin3D: rec.fo, faceRt: rec.rt, landmarkMeanAbsDelta: rec.lmd, label: rec.label, trained: rec.trained,
    live: { facePresent: r.facePresent, eyeState: r.eyeState, rawNormPog: r.rawNormPog, network: r.network, geometric: r.geometric, headVector: r.headVector, faceOrigin3D: r.faceOrigin3D } };
});
await writeFile(path.join(S, `replay-${outName}.jsonl`), out.map(o => JSON.stringify(o)).join('\n') + '\n');

// ---- fidelity vs the live recording (meaningful for `none`; reported for every variant) ----
const pxDelta = (a, b) => (finite2(a) && finite2(b) ? Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H) : null);
const fid = {};
const labelSet = new Set(labels.map(l => l.rowIdx));
for (const [name, pick] of [['labelFrames', o => labelSet.has(o.i)], ['recordFrames', o => o.screen === 'block' && o.phase === 'record' && finalKeys.has(o.block) && o.facePresent && o.eyeState === 'open' && o.live.facePresent && o.live.eyeState === 'open']]) {
  const sel = out.filter(pick);
  const net = sel.map(o => pxDelta(o.network, o.live.network)).filter(v => v !== null), raw = sel.map(o => pxDelta(o.rawNormPog, o.live.rawNormPog)).filter(v => v !== null);
  const hv = sel.map(o => (o.headVector && o.live.headVector ? Math.max(...o.headVector.map((v, i) => Math.abs(v - o.live.headVector[i]))) : null)).filter(v => v !== null);
  const fo = sel.map(o => (o.faceOrigin3D && o.live.faceOrigin3D ? Math.max(...o.faceOrigin3D.map((v, i) => Math.abs(v - o.live.faceOrigin3D[i]))) : null)).filter(v => v !== null);
  const lmd = sel.map(o => o.landmarkMeanAbsDelta).filter(v => v !== null);
  const sameState = sel.length ? out.filter(pick).filter(o => o.facePresent === o.live.facePresent && o.eyeState === o.live.eyeState).length : 0;
  fid[name] = { frames: sel.length, network_px: { median: median(net), p90: p90(net), max: Math.max(...net, -Infinity), n: net.length }, rawNormPog_px: { median: median(raw), p90: p90(raw), max: Math.max(...raw, -Infinity), n: raw.length },
    headVector_maxAbs: { median: median(hv), max: Math.max(...hv, -Infinity) }, faceOrigin3D_cm_maxAbs: { median: median(fo), max: Math.max(...fo, -Infinity) }, landmarkMeanAbsDelta: { median: median(lmd), p90: p90(lmd) }, sameFaceAndEyeState: sameState };
}
// Every live record row: did the replay step it with the same face / eye state?
const liveUsable = rows.filter(r => r.screen === 'block' && r.phase === 'record' && finalKeys.has(r.block) && r.facePresent && r.eyeState === 'open');
const stepped = new Map(out.map(o => [o.i, o]));
fid.liveUsableRows = { live: liveUsable.length, stepped: liveUsable.filter(r => stepped.has(r.idx)).length, steppedUsable: liveUsable.filter(r => stepped.get(r.idx)?.facePresent && stepped.get(r.idx)?.eyeState === 'open').length };
const tr = session.calibration?.trainingReport ?? null, rr = result.trainingReport;

// ---- per-block scoring (analysis/analyze.py conventions) ----
const usable = out.filter(o => o.screen === 'block' && o.phase === 'record' && finalKeys.has(o.block) && o.facePresent && o.eyeState === 'open' && o.target);
const stats = pairs => {
  if (!pairs.length) return null;
  const d = pairs.map(([p, t]) => [p[0] - t[0], p[1] - t[1]]), e = d.map(([x, y]) => Math.hypot(x, y));
  const s = { frames: pairs.length, median_px: median(e), abs_dx_px: median(d.map(v => Math.abs(v[0]))), abs_dy_px: median(d.map(v => Math.abs(v[1]))), bias_dx_px: median(d.map(v => v[0])), bias_dy_px: median(d.map(v => v[1])), p90_px: p90(e) };
  if (cmPerPx) s.median_cm = s.median_px * cmPerPx;
  return s;
};
const cellOf = p => (p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H ? Math.floor(p[1] / H * 2) * 4 + Math.floor(p[0] / W * 4) : null);
const STREAMS = { blend: 'rawNormPog', network: 'network', geometric: 'geometric' };
const blocks = {};
for (const b of finalBlocks) {
  const fr = usable.filter(o => o.block === b.key);
  const entry = { id: b.id, title: b.title, usableFrames: fr.length, liveUsableFrames: liveUsable.filter(r => r.block === b.key).length, headShift: b.headShift ?? null, streams: {} };
  for (const [name, field] of Object.entries(STREAMS)) {
    const pairs = fr.filter(o => finite2(o[field])).map(o => [toPx(o[field]), [o.target.x, o.target.y]]);
    const perFrame = stats(pairs);
    const dots = [];
    for (const t of session.targets) {
      const ps = fr.filter(o => o.point === t.index && finite2(o[field])).map(o => toPx(o[field]));
      if (!ps.length) continue;
      const m = [median(ps.map(p => p[0])), median(ps.map(p => p[1]))];
      dots.push({ point: t.index, frames: ps.length, estimate: m, target: [t.x, t.y], error_px: Math.hypot(m[0] - t.x, m[1] - t.y), dx: m[0] - t.x, dy: m[1] - t.y, cellHit: cellOf(m) === t.cell, rowHit: (m[1] >= H / 2) === (t.y >= H / 2) });
    }
    entry.streams[name] = { perFrame, perDot: { dots: dots.length, median_error_px: median(dots.map(d => d.error_px)), mean_error_px: dots.length ? dots.reduce((s, d) => s + d.error_px, 0) / dots.length : NaN, cellHits: dots.filter(d => d.cellHit).length, rowHits: dots.filter(d => d.rowHit).length, list: dots } };
  }
  blocks[b.key] = entry;
}
const summary = { session: session.id, fixes: fixesName, flags: FIXES[fixesName], backend: result.backend, offsetMs: result.offsetMs, alignment: align, video: result.video, counts: result.counts, unmatchedLiveRows: result.unmatched, trained: result.trained, trainError: result.trainError,
  trainingReport: { replay: rr, live: tr }, fidelity: fid, viewport: { width: W, height: H, cmPerCssPx: cmPerPx }, blocks, elapsedS: result.elapsedS, createdAt: new Date().toISOString() };
await writeFile(path.join(S, `replay-${outName}.json`), JSON.stringify(summary, null, 1) + '\n');

// ---- markdown ----
const f = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const L = [`# Replay · ${session.id} · fixes = ${fixesName} ${JSON.stringify(FIXES[fixesName])}`, ''];
L.push(`Video ${result.video.frames} frames (${result.video.codec}, ${result.video.width}×${result.video.height}, median frame step ${f(result.video.frameDtMs, 1)} ms); live rows with video time ${liveRows.length}; stepped ${result.counts.stepped} (unmatched live rows ${result.unmatched}); face ${result.counts.withFace}, eyes open ${result.counts.openEyes}. Clock offset (MediaRecorder − live videoT) ${result.offsetMs} ms${align ? ` (alignment over ${align.samples} rows: frame picks ${JSON.stringify(align.kHistogram)}, landmark mean|Δ| at the chosen frame ${align.landmarkMeanAbsDeltaAtBestFrame.toExponential(2)} vs ${align.landmarkMeanAbsDeltaAtAdjacentFrames.toExponential(2)} one frame away)` : ''}. Labels: ${result.counts.collected} collected (${result.counts.shifted} on a later frame within 150 ms), ${result.counts.missed} missed. TFJS backend ${result.backend}; ${f(result.elapsedS, 0)} s.`, '');
L.push('## Fidelity gate (replay vs the live recording, same live rows)', '');
L.push(`Training report: replay heldOutBefore ${f(rr?.heldOutBefore, 6)} / heldOutAfter ${f(rr?.heldOutAfter, 6)} / bestStep ${rr?.bestStep ?? '—'} / stepsUsed ${rr?.stepsUsed ?? '—'} / heldOut ${rr?.heldOut ?? '—'}; live ${f(tr?.heldOutBefore, 6)} / ${f(tr?.heldOutAfter, 6)} / ${tr?.bestStep ?? '—'} / ${tr?.stepsUsed ?? '—'} / ${tr?.heldOut ?? '—'}. Geometric fit: replay heldOutMse ${f(rr?.geometric?.heldOutMse, 6)} weight ${f(rr?.geometric?.weight, 3)}; live ${f(tr?.geometric?.heldOutMse, 6)} weight ${f(tr?.geometric?.weight, 3)}.${result.trainError ? ` **Training error: ${result.trainError}**` : ''}`, '');
L.push('| frames | n | network \\|Δ\\| px median / p90 / max | rawNormPog \\|Δ\\| px median / p90 / max | headVector max\\|Δ\\| median / max | faceOrigin3D cm median / max | landmarks mean\\|Δ\\| median / p90 | same face+eye state |', '|---|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(fid)) if (k !== 'liveUsableRows') L.push(`| ${k === 'labelFrames' ? '42 labelled calibration frames' : 'record-phase usable frames'} | ${v.frames} | ${f(v.network_px.median, 1)} / ${f(v.network_px.p90, 1)} / ${f(v.network_px.max, 1)} | ${f(v.rawNormPog_px.median, 1)} / ${f(v.rawNormPog_px.p90, 1)} / ${f(v.rawNormPog_px.max, 1)} | ${f(v.headVector_maxAbs.median, 4)} / ${f(v.headVector_maxAbs.max, 4)} | ${f(v.faceOrigin3D_cm_maxAbs.median, 3)} / ${f(v.faceOrigin3D_cm_maxAbs.max, 3)} | ${v.landmarkMeanAbsDelta.median === undefined ? '—' : v.landmarkMeanAbsDelta.median.toExponential(2)} / ${v.landmarkMeanAbsDelta.p90 === undefined ? '—' : v.landmarkMeanAbsDelta.p90.toExponential(2)} | ${v.sameFaceAndEyeState}/${v.frames} |`);
L.push('', `Live usable record rows (final attempts): ${fid.liveUsableRows.live}; stepped in the replay ${fid.liveUsableRows.stepped}; usable in the replay too ${fid.liveUsableRows.steppedUsable}. For a variant other than \`none\` the network/rawNormPog columns measure the fix's effect plus the replay gap, not fidelity.`, '');
L.push('## Per-block error (replayed estimates, analyze.py statistics)', '');
L.push(`Frames: record-phase frames of a final block attempt with a face present and eyes open in the replay. Per-frame: median Euclidean error, median |dx|, |dy|, median signed bias, p90 (CSS px of the ${W}×${H} viewport${cmPerPx ? `, ${cmPerPx.toFixed(4)} cm/px` : ''}). Per dot: the median estimate over the dot's frames scored against the dot (the per-dot median error is the median over dots); cells = dots whose median estimate lands in the dot's 4×2 cell, rows = in the dot's top/bottom half. \`blend\` = rawNormPog.`, '');
for (const [key, b] of Object.entries(blocks)) {
  const hs = b.headShift ? ` · head shift x ${f(b.headShift.dx, 1)} y ${f(b.headShift.dy, 1)} z ${f(b.headShift.dz, 1)} cm, yaw ${f(b.headShift.yawDeg ?? b.headShift.yaw, 1)}° pitch ${f(b.headShift.pitchDeg ?? b.headShift.pitch, 1)}°` : '';
  L.push(`### ${b.id} ${b.title} · ${b.usableFrames} usable frames (live ${b.liveUsableFrames})${hs}`, '');
  L.push('| stream | per-dot median px | dots | cells | rows | frame median px (cm) | \\|dx\\| | \\|dy\\| | bias dx | bias dy | p90 | frames |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(b.streams)) { const p = s.perFrame, d = s.perDot; L.push(`| ${name} | ${f(d.median_error_px)} | ${d.dots} | ${d.cellHits}/${d.dots} | ${d.rowHits}/${d.dots} | ${p ? `${f(p.median_px)}${cmPerPx ? ` (${f(p.median_cm, 1)})` : ''}` : '—'} | ${f(p?.abs_dx_px)} | ${f(p?.abs_dy_px)} | ${p ? (p.bias_dx_px >= 0 ? '+' : '') + f(p.bias_dx_px) : '—'} | ${p ? (p.bias_dy_px >= 0 ? '+' : '') + f(p.bias_dy_px) : '—'} | ${f(p?.p90_px)} | ${p?.frames ?? 0} |`); }
  L.push('');
}
await writeFile(path.join(S, `replay-${outName}.md`), L.join('\n') + '\n');
console.log(`stepped ${result.counts.stepped}, labels ${result.counts.collected}/42 (${result.counts.shifted} shifted, ${result.counts.missed} missed), trained ${result.trained}${result.trainError ? ' ERROR ' + result.trainError : ''}; fidelity record frames: network |Δ| median ${f(fid.recordFrames.network_px.median, 1)} px, p90 ${f(fid.recordFrames.network_px.p90, 1)} px; labels: median ${f(fid.labelFrames.network_px.median, 1)} px`);
console.log(`wrote ${path.join(S, `replay-${outName}.{jsonl,json,md}`)} in ${f(result.elapsedS, 0)} s`);
