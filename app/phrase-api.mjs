// phrase prediction model implementation and file using that model
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openPhrases } from './phrase-store.mjs';

/** Shared by Vite dev and preview; no prediction model required. */
export function phraseApi() {
  let store;
  const attach = (server) => {
    if (!store) {
      const dir = new URL('./data/', import.meta.url);
      mkdirSync(dir, { recursive: true });
      store = openPhrases(fileURLToPath(new URL('phrases.sqlite', dir)));
    }
    server.middlewares.use('/api/phrases', async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required');
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new Error('Same origin required');
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('Request too large'); }
          const { text, id } = JSON.parse(raw);
          store.record(text, id);
        } else if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
        res.end(JSON.stringify(store.snapshot()));
      } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'Could not save phrase' })); }
    });
  };
  return { name: 'clarte-phrases', configureServer: attach, configurePreviewServer: attach };
}
