import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The app imports ../shared/*.ts directly, so the dev server may read the v0 folder.
const v0 = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5107, strictPort: true, fs: { allow: [v0] } },
  preview: { port: 5107, strictPort: true },
});
