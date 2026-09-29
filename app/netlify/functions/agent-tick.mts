// The agent, running on its own every thirty minutes. Every ten was the first
// setting; thirty keeps the function bill down and is still quicker than a
// four hour signal can change its mind.
//
// Everything it does is in loop-core. This file is only the schedule, which
// Netlify runs on the published deploy and nowhere else.
import { RUNNER_FRESH_MS, RUNNER_HEARTBEAT, runTick, store } from "./loop-core.mts";

export default async () => {
  // When the runner on our own server is alive, it does the work and this
  // schedule stands down, so there is never a second agent asking twice. If
  // it goes quiet for longer than a pass and a half, this picks the loop up.
  const beat = (await store().get(RUNNER_HEARTBEAT, { type: "json" })) as { at?: number } | null;
  if (beat?.at && Date.now() - beat.at < RUNNER_FRESH_MS) {
    return new Response(JSON.stringify({ ran: false, reason: "the runner is alive" }), { headers: { "content-type": "application/json" } });
  }
  const r = await runTick();
  // Written only here, so it proves the schedule fires rather than a manual run.
  await store().setJSON("last-scheduled", { at: Date.now(), proposals: (r as { done?: unknown[] }).done?.length ?? 0 });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "*/30 * * * *" };
