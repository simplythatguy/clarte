import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The app imports the framework-free engine from ../shared, outside this folder.
export default defineConfig({
  server: { port: 5102, strictPort: true, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { port: 5102, strictPort: true },
});
