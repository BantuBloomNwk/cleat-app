// The owner's paper book: positions, profit and loss, fills and what the
// agent has been doing.
//
// Private by default, because a book is exactly what the rest of Cleat is
// built never to publish. The owner signs one message with their key, which
// works for a passkey and for a wallet, and gets a token good for a day. The
// demo account's book is the one exception, open so the loop can be seen
// working by anyone who has not set up.
import { ed25519 } from "@noble/curves/ed25519";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DEMO_OWNER, INSTRUMENTS, LOOP_AGENT, PAPER_BOOK_USD, checkToken, issueToken, mark, quote,
  mandatePda, readBook, store, vaultPda, type Ticker,
} from "./loop-core.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const message = (owner: string, index: number, ts: number) =>
  `Cleat: show me my paper book. ${owner} sleeve ${index} at ${ts}. This signature moves nothing.`;

export default async (req: Request) => {
  const url = new URL(req.url);
  let owner = url.searchParams.get("owner") ?? "";
  let index = Number(url.searchParams.get("index") ?? "0");
  let token = url.searchParams.get("token") ?? "";

  if (req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as {
      owner?: string; index?: number; ts?: number; signature?: string; token?: string; publish?: boolean;
    };
    // Publishing a paper record, with a read token the owner already holds.
    if (typeof b.publish === "boolean" && b.owner && b.token) {
      const i = Number(b.index ?? 0);
      if (!checkToken(b.owner, i, b.token)) return json({ error: "sign in again" }, 403);
      const mandate = mandatePda(new PublicKey(b.owner), i).toBase58();
      if (b.publish) await store().setJSON(`public/${mandate}`, { owner: b.owner, index: i, since: Date.now() });
      else await store().delete(`public/${mandate}`);
      return json({ published: b.publish });
    }
    owner = String(b.owner ?? "");
    index = Number(b.index ?? 0);
    const ts = Number(b.ts ?? 0);
    if (!owner || !b.signature || Math.abs(Date.now() / 1000 - ts) > 300) return json({ error: "sign a fresh request" }, 400);
    try {
      const ok = ed25519.verify(
        Buffer.from(String(b.signature), "base64"),
        new TextEncoder().encode(message(owner, index, ts)),
        new PublicKey(owner).toBytes(),
      );
      if (!ok) return json({ error: "that signature is not from this key" }, 403);
    } catch {
      return json({ error: "that signature could not be read" }, 400);
    }
    token = issueToken(owner, index);
  }

  if (!owner || !Number.isInteger(index) || index < 0 || index > 31) return json({ error: "owner and sleeve" }, 400);
  const isDemo = owner === DEMO_OWNER.toBase58();
  // Locked is an answer, not a failure: a 401 put a red line in the console
  // for every signed-in visitor who had not opened their book yet.
  if (!isDemo && !checkToken(owner, index, token)) return json({ locked: true, needsSignature: true });

  // The grant, read off chain rather than remembered.
  let grant: { live: boolean; expiresAt: number } = { live: false, expiresAt: 0 };
  try {
    const conn = new Connection(process.env.SOLANA_RPC_URL ?? "", "confirmed");
    const v = await conn.getAccountInfo(vaultPda(new PublicKey(owner), index));
    if (v) {
      const agent = new PublicKey(v.data.subarray(74, 106));
      const exp = Number(v.data.readBigInt64LE(106));
      grant = { live: agent.equals(LOOP_AGENT) && exp > Date.now() / 1000, expiresAt: agent.equals(LOOP_AGENT) ? exp : 0 };
    }
  } catch { /* the book still reads without it */ }

  const book = await readBook(owner, index);
  const published = isDemo || !!(await store().get(`public/${mandatePda(new PublicKey(owner), index).toBase58()}`));
  const prices: Partial<Record<Ticker, number>> = {};
  const moves: Partial<Record<Ticker, number>> = {};
  const sources: Partial<Record<Ticker, string>> = {};
  for (const i of INSTRUMENTS) {
    const q = await quote(i.symbol);
    if (q) { prices[i.ticker] = q.price; moves[i.ticker] = q.momentumBps; sources[i.ticker] = q.source; }
  }
  const lastTick = (await store().get("last-tick", { type: "json" })) as { at?: number } | null;
  const lastScheduled = (await store().get("last-scheduled", { type: "json" })) as { at?: number } | null;

  return json({
    token: isDemo ? undefined : token,
    demo: isDemo,
    published,
    simulated: true,
    paperBookUsd: PAPER_BOOK_USD,
    agent: LOOP_AGENT.toBase58(),
    grant,
    marked: mark(book, prices),
    prices, moves, sources,
    fills: book.fills.slice(-20).reverse(),
    activity: book.activity.slice(-20).reverse(),
    lastTickAt: lastTick?.at ?? null,
    lastScheduledAt: lastScheduled?.at ?? null,
    watching: INSTRUMENTS.map((i) => ({ ticker: i.ticker, name: i.name, sector: i.sector })),
  });
};

export const config = { path: "/api/agent-book" };
