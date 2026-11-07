import { defineConfig } from 'vite';

// The app imports ../shared/*.ts directly, so the dev server must be allowed to serve the parent folder.
export default defineConfig({
  server: { port: 5104, strictPort: true, fs: { allow: ['..'] } },
  oxc: { jsx: { runtime: 'automatic' } },
});
