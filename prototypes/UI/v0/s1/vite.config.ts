import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared engine lives one folder up and is imported as TypeScript source.
export default defineConfig({
  plugins: [react()],
  server: { port: 5101, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5101, strictPort: true },
});
