import { defineConfig } from 'vite';

// The page talks only to itself and to the local voice service on this machine.
const service = process.env.VITE_CLARTE_VOICE_URL ?? 'http://localhost:4322';
const headers = {
  'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: ${service}; connect-src 'self' ${service}; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  server: { host: 'localhost', port: 4321, strictPort: true, hmr: false, headers },
  preview: { host: 'localhost', port: 4321, strictPort: true, headers },
});
