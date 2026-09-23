import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * The endpoint the dev proxy forwards to.
 *
 * Read from the repo's own .env, never baked into the bundle, and never the
 * public devnet endpoint, which rate limits a circuit upload into failure and
 * silently truncates paginated reads. In production the same job is done by a
 * Netlify function so the key stays server side; this exists so `npm run dev`
 * behaves the same way without one running.
 */
function upstreamRpc(): string | null {
  const key = 'SOLANA_RPC_URL=';
  for (const file of ['.env', '../.env']) {
    try {
      const line = fs
        .readFileSync(path.resolve(__dirname, file), 'utf8')
        .split('\n')
        .find((l) => l.startsWith(key));
      if (line) return line.slice(key.length).trim();
    } catch {
      // next candidate
    }
  }
  return process.env.SOLANA_RPC_URL ?? null;
}

export default defineConfig(() => {
  const rpc = upstreamRpc();

  // Split the endpoint into an origin and the rest, because the key usually
  // travels in the query string and a proxy that rewrites the path to nothing
  // drops it. Rewriting to the full path and query keeps it, and keeps it out
  // of the bundle at the same time.
  // Everything else under /api is a Netlify function, and running the
  // Netlify CLI alongside vite to get them has been unreliable on this
  // machine: it reports the dev server ready and then nothing is listening.
  // The deployed functions are public and stateless, so dev borrows them.
  // Nothing secret goes through here; the one endpoint that carries a key
  // is /api/rpc, which is proxied separately to the upstream directly.
  const FUNCTIONS = process.env.CLEAT_FUNCTIONS_ORIGIN
    ?? 'https://cleat-preview.netlify.app';

  const proxy = (() => {
    const forwarded = Object.fromEntries(
      ['backpack', 'sunrise', 'issuers', 'prestocks', 'pyth', 'adopt', 'attack', 'gate']
        .map((name) => [`/api/${name}`, {
          target: FUNCTIONS,
          changeOrigin: true,
          secure: true,
        }]),
    );
    if (!rpc) return forwarded;
    const u = new URL(rpc);
    const rest = `${u.pathname}${u.search}`;
    return {
      ...forwarded,
      '/api/rpc': {
        target: u.origin,
        changeOrigin: true,
        secure: true,
        rewrite: () => rest,
      },
    };
  })();

  // The logo endpoint, in dev.
  //
  // It lives in a Netlify function in production. Dev borrows the deployed
  // functions, so a path that has not shipped yet answers 400 from the old
  // build and every mark falls back to an identicon, which looks like the
  // feature not working rather than the feature not being deployed. Fifteen
  // lines here means dev shows what production will.
  const devLogo = {
    name: 'cleat-dev-logo',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        if (!req.url?.startsWith('/api/backpack?path=logo')) return next();
        const symbol = (new URL(req.url, 'http://x').searchParams.get('symbol') ?? '').toUpperCase();
        if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) { res.statusCode = 400; return res.end('bad symbol'); }
        try {
          const r = await fetch(`https://backpack.exchange/api/stock-logo/${symbol}`);
          const body = await r.text();
          if (!r.ok || !body.includes('<svg')) { res.statusCode = 404; return res.end('no mark'); }
          res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
          res.end(body);
        } catch { res.statusCode = 502; res.end('upstream'); }
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), devLogo],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      // File watching off while an agent is editing, which otherwise reloads
      // the page on every keystroke of every write.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy,
    },
    preview: {
      proxy,
    },
  };
});
