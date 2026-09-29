// Bundle the agent runner into one file a server can run with plain node.
//   node scripts/bundle-runner.mjs   ->  runner/dist/agent-runner.mjs
import { build } from "esbuild";

await build({
  entryPoints: ["runner/agent-runner.mts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  outfile: "runner/dist/agent-runner.mjs",
  logLevel: "warning",
});
console.log("runner/dist/agent-runner.mjs");
