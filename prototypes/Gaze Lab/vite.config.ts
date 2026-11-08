import { defineConfig } from 'vite';
// The worker bundle, model and wasm stay in public/ and are served from there by server.mjs; nothing is copied into dist/.
export default defineConfig({
  publicDir: false,
  server: { host: '127.0.0.1', port: 4332, strictPort: true, hmr: false },
  // dev/session.html is the Clarte test-session replay page, copied unchanged, so a recorded .clarte-session can be replayed here.
  build: { sourcemap: true, target: 'es2022', rollupOptions: { input: { main: 'index.html', session: 'dev/session.html' } } },
});
