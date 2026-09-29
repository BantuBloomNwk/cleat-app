// The agent loop, on our own server instead of as a Netlify schedule.
//
// Same logic as agent-tick, from the same file. It writes a heartbeat each
// pass; while that is fresh the Netlify schedule stands down, and if this
// process dies the schedule picks the loop back up by itself within 45
// minutes. Nothing needs redeploying to move the loop in either direction.
//
// Build:  node scripts/bundle-runner.mjs      (from app/)
// Run:    node --env-file=/etc/cleat-agent.env runner/dist/agent-runner.mjs
import os from "node:os";
import { RUNNER_HEARTBEAT, runTick, store } from "../netlify/functions/loop-core.mts";

const EVERY_MS = 30 * 60 * 1000;
const need = ["SOLANA_RPC_URL", "CLEAT_LOOP_AGENT", "CLEAT_STORE_URL", "CLEAT_RUNNER_SECRET"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing ${missing.join(", ")}; see runner/README.md`);
  process.exit(1);
}

async function pass() {
  const at = new Date().toISOString();
  try {
    const r = await runTick();
    const done = (r as { done?: unknown[] }).done?.length ?? 0;
    const model = (r as { gemini?: { model?: string; status?: string } }).gemini;
    console.log(`${at} vaults=${(r as { vaults?: number }).vaults ?? 0} proposals=${done} model=${model?.model ?? "-"}:${model?.status ?? "-"}`);
    await store().setJSON(RUNNER_HEARTBEAT, { at: Date.now(), host: os.hostname(), proposals: done });
  } catch (e) {
    // A failed pass still says it is alive: the schedule taking over would
    // only fail the same way, and two agents would ask twice.
    console.error(`${at} pass failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
    await store().setJSON(RUNNER_HEARTBEAT, { at: Date.now(), host: os.hostname(), error: true }).catch(() => {});
  }
}

// On the half hour, the same rhythm as the schedule it replaces.
await pass();
const toNext = EVERY_MS - (Date.now() % EVERY_MS);
setTimeout(() => {
  void pass();
  setInterval(() => void pass(), EVERY_MS);
}, toNext);
