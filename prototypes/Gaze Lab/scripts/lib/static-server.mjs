// Loopback static file server for the test scripts (parity, fixture, e2e). Never binds outside 127.0.0.1.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.bin': 'application/octet-stream', '.task': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.map': 'application/json' };
/** Serves `roots` in order (first hit wins) plus optional in-memory `pages` ({ '/index.html': html }). */
export async function serveStatic({ roots, pages = {}, port = 0 }) {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html');
    res.setHeader('Cache-Control', 'no-store');
    if (pages[pathname] !== undefined) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pages[pathname]); return; }
    for (const root of roots) {
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(path.resolve(root) + path.sep)) continue;
      try { const bytes = await readFile(file); res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream'); res.end(bytes); return; } catch { /* next root */ }
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
