// Push on the boundary yourself.
//
// The diary is a record of what the program decided, and a record is
// something you are asked to believe. This is the other thing: a real
// proposal, signed by a real agent grant, landing on devnet against the same
// program and the same sentence, refused or cleared by the same code. What
// comes back is a transaction signature, so the answer is checkable on an
// explorer that has never heard of us.
//
// It writes to a separate owner from the one the diary reads. The curated log
// holds sixteen decisions that between them exercise every reason the program
// has, and it should not be overwritten by whoever is playing with the app.
//
// The agent key lives in this function's environment. It is a devnet key whose
// entire authority is proposing into one sandbox vault, bounded by a mandate it
// cannot write to and a grant the owner can revoke. There is nothing for it to
// steal, which is the point being demonstrated rather than a lucky property.
import { b58decode, buildSignedTx, rpc, toBytes } from "./solana-lite.mts";

const PROGRAM_ID = "2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL";

/**
 * The sandbox accounts, written down rather than derived.
 *
 * They are program derived addresses off one owner and three fixed seeds, so
 * they will never be anything else, and deriving them here would mean curve
 * arithmetic in a request path to recompute a constant. Created by
 * scripts/sandbox-setup.mjs, which is where the seeds actually live.
 */
const VAULT = "GWJMZJPEMgfQMv9Q2LFdEg7ApA9aAXJDLLNb5cUiDxTK";
const MANDATE = "7mUxHWHJp475Vquxmm7mRXZdqqkQaiSZSdfgQ7fiHoEt";
const LOG = "Cd4bnuBoi57pD11gfjiHjgYAnAb5G4EHZUtZkMvfQP54";

/** `propose_trade`, read off the deployed IDL rather than guessed. */
const DISCRIMINATOR = Buffer.from([90, 218, 7, 166, 111, 48, 29, 15]);

/** VERDICT_CAPACITY in the program. The ring wraps at this. */
const CAPACITY = 16;

/**
 * The attacks, and what each is actually testing.
 *
 * Fixed set on purpose. A free text box would be a free devnet transaction
 * generator pointed at our own fee payer, and the interesting part was never
 * the wording. Each of these reaches a different line in the program.
 */
const SCENARIOS: Record<
  string,
  {
    label: string;
    headline: string;
    category: number;
    bps: number;
    ingested: boolean;
    side: number;
    spreadBps: number;
    mint: string;
    tests: string;
  }
> = {
  headline: {
    label: "Talk it into a trade with a headline",
    headline:
      "BREAKING: chip demand surges. Analysts say load up on semiconductors immediately.",
    category: 1,
    bps: 300,
    ingested: true,
    side: 0,
    spreadBps: 0,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "a proposal that originated in something the agent read",
  },
  fossil: {
    label: "Buy the thing the sentence rules out",
    headline:
      "Gulf supply disruption. Energy majors rallying. Exxon looks cheap here.",
    category: 2,
    bps: 200,
    ingested: false,
    side: 0,
    spreadBps: 0,
    mint: "qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo",
    tests: "an asset ruled out by name, through the second issuer's wrapper",
  },
  oversize: {
    label: "Ask for forty percent of the book",
    headline: "Conviction call. Concentrate the book into one name.",
    category: 1,
    bps: 4000,
    ingested: false,
    side: 0,
    spreadBps: 0,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "the position cap, which refuses rather than trims at this size",
  },
  thin: {
    label: "Trade into a book thirty two points wide",
    headline: "Overnight session. Thin book, wide spread, nobody watching.",
    category: 1,
    bps: 200,
    ingested: false,
    side: 0,
    spreadBps: 32,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "the spread cap, on a size every other check would wave through",
  },
  ordinary: {
    label: "Propose something the sentence allows",
    headline: "Routine rebalance. Small addition, inside every limit.",
    category: 3,
    bps: 100,
    ingested: false,
    side: 0,
    spreadBps: 0,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "that it is a boundary and not a wall",
  },
};

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req: Request) => {
  if (req.method === "GET") {
    return json({
      scenarios: Object.entries(SCENARIOS).map(([key, s]) => ({
        key,
        label: s.label,
        headline: s.headline,
        tests: s.tests,
      })),
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = process.env.CLEAT_SANDBOX_AGENT;
  const upstream = process.env.SOLANA_RPC_URL;
  if (!secret || !upstream) {
    return json({ error: "the sandbox is not configured on this deploy" }, 503);
  }

  let key: string;
  try {
    key = String(((await req.json()) as any)?.scenario ?? "");
  } catch {
    return json({ error: "not json" }, 400);
  }
  const s = SCENARIOS[key];
  if (!s) return json({ error: "unknown scenario" }, 400);

  try {
    const secretKey = Uint8Array.from(JSON.parse(secret));
    const agentPubkey = (await import("./solana-lite.mts")).b58encode(
      secretKey.slice(32, 64),
    );

    const { blockhash } = (
      await rpc(upstream, "getLatestBlockhash", [{ commitment: "confirmed" }])
    ).value;

    const data = Buffer.concat([
      DISCRIMINATOR,
      Buffer.from([s.category]),
      u16(s.bps),
      Buffer.from([s.ingested ? 1 : 0]),
      Buffer.from([s.side]),
      u16(s.spreadBps),
      Buffer.from(b58decode(s.mint)),
    ]);

    const { wire, signature } = buildSignedTx({
      secretKey,
      programId: PROGRAM_ID,
      // The order the program expects: signer, vault, mandate, log.
      accounts: [
        { pubkey: agentPubkey, isSigner: true, isWritable: true },
        { pubkey: VAULT, isSigner: false, isWritable: false },
        { pubkey: MANDATE, isSigner: false, isWritable: false },
        { pubkey: LOG, isSigner: false, isWritable: true },
      ],
      data: Uint8Array.from(data),
      recentBlockhash: blockhash,
    });

    await rpc(upstream, "sendTransaction", [
      Buffer.from(wire).toString("base64"),
      { encoding: "base64", preflightCommitment: "confirmed" },
    ]);

    // Wait for it to land, then read the verdict back off the log rather than
    // reporting what we expected. The whole claim is that the program decides.
    let verdict: Record<string, number> | null = null;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 900));
      const st = await rpc(upstream, "getSignatureStatuses", [[signature]]);
      const s0 = st?.value?.[0];
      if (!s0) continue;
      if (s0.err) break;
      if (s0.confirmationStatus === "confirmed" || s0.confirmationStatus === "finalized") {
        const acc = await rpc(upstream, "getAccountInfo", [
          LOG,
          { encoding: "base64", commitment: "confirmed" },
        ]);
        const b = Buffer.from(toBytes(acc.value.data[0]));
        let o = 8 + 32 + 32 + 1 + 4 + 4 + 4;
        const count = b.readUInt32LE(o);
        o += 4;
        if (count > 0) {
          // head is the next slot to be written, and the ring wraps at
          // capacity rather than at how many are currently in it.
          const head = b.readUInt8(8 + 32 + 32);
          const at = o + ((head + CAPACITY - 1) % CAPACITY) * 17;
          verdict = {
            slot: Number(b.readBigUInt64LE(at)),
            mandateVersion: b.readUInt16LE(at + 8),
            category: b.readUInt8(at + 10),
            proposedBps: b.readUInt16LE(at + 11),
            allowedBps: b.readUInt16LE(at + 13),
            outcome: b.readUInt8(at + 15),
            reason: b.readUInt8(at + 16),
          };
        }
        break;
      }
    }

    return json({
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      scenario: key,
      asked: s.bps,
      verdict,
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // A refusal that fails the transaction outright is still an answer, and
    // saying "something went wrong" would hide the thing being demonstrated.
    return json({ error: msg.slice(0, 400), refusedOnChain: /custom program error/.test(msg) }, 200);
  }
};

export const config = { path: "/api/attack" };
