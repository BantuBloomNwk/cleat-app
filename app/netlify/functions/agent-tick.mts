// The agent, running on its own every thirty minutes. Every ten was the first
// setting; thirty keeps the function bill down and is still quicker than a
// four hour signal can change its mind.
//
// Everything it does is in loop-core. This file is only the schedule, which
// Netlify runs on the published deploy and nowhere else.
import { runTick, store } from "./loop-core.mts";

export default async () => {
  const r = await runTick();
  // Written only here, so it proves the schedule fires rather than a manual run.
  await store().setJSON("last-scheduled", { at: Date.now(), proposals: (r as { done?: unknown[] }).done?.length ?? 0 });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "*/30 * * * *" };
