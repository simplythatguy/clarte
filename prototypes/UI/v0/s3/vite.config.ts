import { defineConfig } from 'vite';

// No React plugin: the app needs JSX only, which Vite compiles from tsconfig's "jsx": "react-jsx".
export default defineConfig({
  server: { port: 5103, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5103, strictPort: true },
});
