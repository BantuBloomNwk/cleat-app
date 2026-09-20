// Bundle each Netlify function into one self-contained file.
//
// Netlify's own packaging ships the dependency tree as it sits on disk, and
// @solana/web3.js drags in rpc-websockets, whose CommonJS entry requires an
// ESM-only uuid. Node refuses that at import time, so the confidential gate
// returned a 502 with an empty body while every function that avoids web3.js
// was fine. Setting node_bundler in netlify.toml did not change it.
//
// So the bundling happens here instead, where it is the same esbuild call that
// already works locally and the output can be run before it is deployed. Each
// function comes out as one file with no bare imports left to resolve, which
// removes the whole class of problem rather than this instance of it.
//
// solana-lite.mts is a shared helper rather than a function, so it is not an
// entry point. It still ends up inside the bundles that import it.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const SRC = "netlify/functions";
const OUT = "netlify/functions-dist";
const HELPERS = new Set(["solana-lite.mts"]);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const entries = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".mts") && !HELPERS.has(f));

for (const f of entries) {
  const name = path.basename(f, ".mts");
  await build({
    entryPoints: [path.join(SRC, f)],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    // web3.js reaches for require() from inside an ESM bundle. Giving it a
    // real one is the documented shim and is what makes the interop work.
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
    outfile: path.join(OUT, `${name}.mjs`),
    logLevel: "warning",
  });
  const kb = (fs.statSync(path.join(OUT, `${name}.mjs`)).size / 1024).toFixed(0);
  console.log(`  ${name}.mjs  ${kb} KiB`);
}
console.log(`bundled ${entries.length} functions into ${OUT}`);
