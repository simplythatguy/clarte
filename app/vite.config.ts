import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Plugin } from 'vite';
import { phraseApi } from './phrase-api.mjs';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/** Development only: what the sound detector hears in the browser, appended to .scratch/sound.log at the repo root. */
const soundLog = (): Plugin => ({
  name: 'clarte-sound-log',
  configureServer(server) {
    const dir = page('../.scratch');
    mkdirSync(dir, { recursive: true });
    server.ws.on('clarte:sound', (data) => appendFileSync(`${dir}/sound.log`, `${new Date().toISOString().slice(11, 23)} ${JSON.stringify(data)}\n`));
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), soundLog(), phraseApi()],
  // shadcn's alias: `@/components/ui/...` resolves to src/components/ui.
  resolve: { alias: { '@': page('src') } },
  server: { port: 5200, strictPort: true },
  // Two pages: the app, and the sound listening page (NAT-24).
  build: { rollupOptions: { input: { main: page('index.html'), sounds: page('sounds.html') } } },
  preview: { port: 5200, strictPort: true },
});
