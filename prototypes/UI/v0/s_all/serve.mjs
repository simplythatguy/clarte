#!/usr/bin/env node
// Serves the S0–S7V preview on http://localhost:5100 (PORT overrides it). Starts any of the seven
// style dev servers (s1–s7 on the seven ports after it, 5101–5107 by default) and the local
// prediction engine (`prototypes/Word Prediction`: S6, and S0 through its compatibility route) when
// they are not already running.
//
// The engine is found by its health, not by an open port: `GET /api/v1/health` must answer
// `{ ok: true, vocabulary: n }`. If 8765 is held by something else (the owner's research server,
// for one), the engine starts on the next free port instead, and S6 is told where through
// `GET /engine.json` on this server (the switcher page adds `?engine=<origin>` to S6's URL). A
// cold engine takes about 30 s to bind; S6 decodes locally and switches over when it is healthy.
// Ctrl+C stops what this script started.
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 5100);
const ENGINE_PORT = Number(process.env.ENGINE_PORT ?? 8765);
/** How many ports after ENGINE_PORT to try when it is taken by something that is not the engine. */
const ENGINE_PORT_TRIES = 10;
const WINDOWS = process.platform === 'win32';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.json': 'application/json' };

// Vite listens on "localhost", which macOS resolves to ::1 only, so check both loopbacks.
const listeningOn = (port, host) => new Promise((resolve) => {
  const s = createConnection({ port, host });
  s.once('connect', () => { s.end(); resolve(true); });
  s.once('error', () => resolve(false));
});
const listening = async (port) => (await listeningOn(port, '127.0.0.1')) || (await listeningOn(port, '::1'));

/** True when the prediction engine answers on `origin`. */
export async function engineHealthy(origin, timeoutMs = 1500) {
  try {
    const res = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body) && body.ok === true && typeof body.vocabulary === 'number';
  } catch {
    return false;
  }
}

/**
 * Where the engine is or should go: the first port from `from` that either answers as an engine
 * (`running: true`) or is free (`running: false`). Ports held by something else are skipped.
 */
export async function chooseEnginePort(from = ENGINE_PORT, tries = ENGINE_PORT_TRIES, probe = { listening, healthy: engineHealthy }) {
  for (let port = from; port < from + tries; port++) {
    if (!(await probe.listening(port))) return { port, running: false };
    if (await probe.healthy(`http://127.0.0.1:${port}`)) return { port, running: true };
    console.log(`port ${port} is held by something that is not the prediction engine; trying ${port + 1}`);
  }
  throw new Error(`no free port for the prediction engine between ${from} and ${from + tries - 1}`);
}

const children = [];
// On Windows, kill() stops only the shell, so end each child's whole process tree.
const end = (c) => WINDOWS ? spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' }) : c.kill();
const stop = () => { for (const c of children) end(c); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  for (let n = 1; n <= 7; n++) {
    const port = PORT + n;
    if (await listening(port)) { console.log(`s${n}: already running on ${port}`); continue; }
    // npm is npm.cmd on Windows, which Node can only start through a shell.
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: join(ROOT, `s${n}`), stdio: 'ignore', shell: WINDOWS });
    children.push(child);
    console.log(`s${n}: starting on ${port}`);
  }
  const ENGINE = join(ROOT, '../../Word Prediction');
  const PYTHON = join(ENGINE, WINDOWS ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  /** What `/engine.json` tells the styles: where the engine is (or will be once it has warmed). */
  const engine = { origin: null, started: false };
  try {
    const { port, running } = await chooseEnginePort();
    engine.origin = `http://127.0.0.1:${port}`;
    if (running) console.log(`prediction engine: already running on ${port}`);
    else if (existsSync(PYTHON)) {
      children.push(spawn(PYTHON, ['server.py', '--port', String(port)], { cwd: ENGINE, stdio: ['ignore', 'ignore', 'inherit'] }));
      engine.started = true;
      console.log(`prediction engine: starting on ${port} (about 30 s); S0 shows "Engine offline" and S6 decodes locally until it is up`);
    } else {
      engine.origin = null;
      console.log(`prediction engine not set up (no ${PYTHON}): S0 will show "Engine offline" and S6 decodes locally. See prototypes/Word Prediction/README.md`);
    }
  } catch (error) {
    console.log(`${error.message}; S6 decodes locally`);
  }
  if (engine.origin && engine.origin !== `http://127.0.0.1:${ENGINE_PORT}`) console.log(`S6 is pointed at ${engine.origin} through /engine.json; S0 still expects ${ENGINE_PORT}`);

  createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/engine.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(JSON.stringify(engine));
      return;
    }
    if (path === '/') path = '/s_all/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  }).listen(PORT, '127.0.0.1', () => console.log(`switcher: http://localhost:${PORT}`));
}
