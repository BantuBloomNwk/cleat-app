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
  const proxy = (() => {
    if (!rpc) return undefined;
    const u = new URL(rpc);
    const rest = `${u.pathname}${u.search}`;
    return {
      '/api/rpc': {
        target: u.origin,
        changeOrigin: true,
        secure: true,
        rewrite: () => rest,
      },
    };
  })();

  return {
    plugins: [react(), tailwindcss()],
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
