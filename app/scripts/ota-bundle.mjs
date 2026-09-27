// Package the built site as an over-the-air bundle for the Android app.
//
// Runs after `vite build`. Zips dist/ (without the ota folder itself) into
// dist/ota/<version>.zip and writes dist/ota/latest.json, which /api/ota
// reads to tell an installed app whether there is something newer. The
// updater refuses a bundle without a SHA-256, so every one carries it.
//
// Run: node scripts/ota-bundle.mjs   (CLEAT_APP_HOST overrides the host)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const host = process.env.CLEAT_APP_HOST ?? 'cleat-preview.netlify.app';
const dist = path.resolve('dist');
const out = path.join(dist, 'ota');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('build first: dist/index.html is missing');

// Monotonic and readable: the commit it came from, and when.
let sha = 'local';
try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); } catch { /* not a checkout */ }
const version = `1.0.${Math.floor(Date.now() / 1000)}-${sha}`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const file = `${version}.zip`;
execFileSync('zip', ['-qr', path.join(out, file), '.', '-x', 'ota/*'], { cwd: dist });
const checksum = createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex');

fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({
  version,
  url: `https://${host}/ota/${file}`,
  checksum,
}, null, 2));
console.log(`ota bundle ${version}, ${(fs.statSync(path.join(out, file)).size / 1e6).toFixed(1)} MB`);
