// Paper records owners chose to show on their sentence.
//
// Opt in, per sentence, and withdrawable. What is shown is the paper book's
// result, marked to market now, how long it has run and how many decisions
// it made. Simulated, and labelled that way wherever it appears. Never
// ranked: a table of returns teaches people to shop for a looser agent,
// and the product's argument is the opposite.
import { PublicKey } from "@solana/web3.js";
import {
  DEMO_OWNER, INSTRUMENTS, mandatePda, mark, quote, readBook, store, type Ticker,
} from "./loop-core.mts";

export default async () => {
  const prices: Partial<Record<Ticker, number>> = {};
  for (const i of INSTRUMENTS) {
    const q = await quote(i.symbol);
    if (q) prices[i.ticker] = q.price;
  }
  const { blobs } = await store().list({ prefix: "public/" });
  const entries: { owner: string; index: number; since: number }[] = [];
  for (const b of blobs.slice(0, 50)) {
    const e = (await store().get(b.key, { type: "json" })) as { owner: string; index: number; since: number } | null;
    if (e) entries.push(e);
  }
  // The demo always shows, so there is one record to see before anyone opts in.
  if (!entries.some((e) => e.owner === DEMO_OWNER.toBase58())) entries.push({ owner: DEMO_OWNER.toBase58(), index: 0, since: 0 });

  const records = [];
  for (const e of entries) {
    const book = await readBook(e.owner, e.index);
    if (book.fills.length === 0) continue;
    const m = mark(book, prices);
    const first = book.fills[0]?.at ?? e.since;
    records.push({
      mandate: mandatePda(new PublicKey(e.owner), e.index).toBase58(),
      owner: e.owner,
      pnlPct: m.pnlPct,
      total: m.total,
      decisions: book.fills.length,
      refused: book.fills.filter((f) => f.outcome === 2).length,
      since: first,
      simulated: true,
    });
  }
  return new Response(JSON.stringify({ records }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=120" },
  });
};

export const config = { path: "/api/agent-records" };
