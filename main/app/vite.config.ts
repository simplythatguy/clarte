import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn's alias: `@/components/ui/...` resolves to src/components/ui.
  resolve: { alias: { '@': page('src') } },
  server: { port: 5200, strictPort: true },
  // Two pages: the app, and the sound listening page (NAT-24).
  build: { rollupOptions: { input: { main: page('index.html'), sounds: page('sounds.html') } } },
  preview: { port: 5200, strictPort: true },
});
