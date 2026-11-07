#!/usr/bin/env node
// Serves the S0–S6 preview on http://localhost:5100 (PORT overrides it). Starts any of the six
// style dev servers (s1–s6 on the six ports after it, 5101–5106 by default) and the local
// prediction engine for S0 (port 8765) that are not already running. Ctrl+C stops what this
// script started.
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 5100);
const WINDOWS = process.platform === 'win32';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.json': 'application/json' };

// Vite listens on "localhost", which macOS resolves to ::1 only, so check both loopbacks.
const listeningOn = (port, host) => new Promise((resolve) => {
  const s = createConnection({ port, host });
  s.once('connect', () => { s.end(); resolve(true); });
  s.once('error', () => resolve(false));
});
const listening = async (port) => (await listeningOn(port, '127.0.0.1')) || (await listeningOn(port, '::1'));

const children = [];
for (let n = 1; n <= 6; n++) {
  const port = PORT + n;
  if (await listening(port)) { console.log(`s${n}: already running on ${port}`); continue; }
  // npm is npm.cmd on Windows, which Node can only start through a shell.
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: join(ROOT, `s${n}`), stdio: 'ignore', shell: WINDOWS });
  children.push(child);
  console.log(`s${n}: starting on ${port}`);
}
const ENGINE = join(ROOT, '../../Word Prediction/v0');
const PYTHON = join(ENGINE, WINDOWS ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (await listening(8765)) console.log('prediction engine: already running on 8765');
else if (existsSync(PYTHON)) {
  children.push(spawn(PYTHON, ['server.py', '--port', '8765'], { cwd: ENGINE, stdio: ['ignore', 'ignore', 'inherit'] }));
  console.log('prediction engine: starting on 8765; S0 shows "Engine offline" until it is up');
} else console.log(`prediction engine not set up (no ${PYTHON}): S0 will show "Engine offline". See prototypes/Word Prediction/v0/README.md`);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/s_all/index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`switcher: http://localhost:${PORT}`));

// On Windows, kill() stops only the shell, so end each child's whole process tree.
const end = (c) => WINDOWS ? spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' }) : c.kill();
const stop = () => { for (const c of children) end(c); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
