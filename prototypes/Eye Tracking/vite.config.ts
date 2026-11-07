import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';

// No HMR socket: runtime connections are limited to local static GET requests.
const headers = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function readOnly(server: Pick<ViteDevServer, 'middlewares'> | Pick<PreviewServer, 'middlewares'>) {
  server.middlewares.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
      response.end('This local prototype only serves static files.');
      return;
    }
    next();
  });
}

export default defineConfig({
  plugins: [{ name: 'read-only-local-prototype', configureServer: readOnly, configurePreviewServer: readOnly }],
  server: { host: 'localhost', port: 4318, strictPort: true, hmr: false, headers },
  preview: { host: 'localhost', port: 4318, strictPort: true, headers },
  build: { sourcemap: true },
});
