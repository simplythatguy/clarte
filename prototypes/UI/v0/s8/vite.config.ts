import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The app imports ../shared/*.ts directly, so the dev server may read the v0 folder.
const v0 = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5108, strictPort: true, fs: { allow: [v0] } },
  // Two pages: the app, and the sound listening page (NAT-24).
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), sounds: fileURLToPath(new URL('sounds.html', import.meta.url)) } } },
  preview: { port: 5108, strictPort: true },
});
