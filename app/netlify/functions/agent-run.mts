// A manual pass of the loop, for testing the pipeline outside market hours.
//
// Guarded by the server secret, so nobody outside can make the agent trade.
// A forced proposal is still real: signed by the agent, decided on chain by
// the owner's sentence, and filled on paper at the live price. Its activity
// line says it came from a manual test run.
import { bookKey, runTick, store, type Ticker } from "./loop-core.mts";

export default async (req: Request) => {
  const secret = process.env.CLEAT_BOOK_SECRET;
  if (!secret || req.headers.get("x-cleat-secret") !== secret) {
    return new Response(JSON.stringify({ error: "not allowed" }), { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as {
    owner?: string; index?: number; ticker?: Ticker; side?: 0 | 1; bps?: number; reset?: boolean;
  };
  if (b.owner && b.reset) {
    await store().delete(bookKey(b.owner, b.index ?? 0));
    return new Response(JSON.stringify({ reset: true }), { headers: { "content-type": "application/json" } });
  }
  const r = b.owner && b.ticker
    ? await runTick({ force: { owner: b.owner, index: b.index ?? 0, ticker: b.ticker, side: b.side ?? 0, bps: b.bps } })
    : await runTick();
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
};

export const config = { path: "/api/agent-run" };
