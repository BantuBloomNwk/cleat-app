#!/usr/bin/env node
// The Open Wallet Standard policy that reads its ceiling off the chain.
//
// OWS keeps the agent's key out of the model's context, which is the hard
// part and it does it well: the agent holds an ows_key_ token, the signing
// core decrypts in hardened memory, signs, and zeroizes, and the key is
// never returned to the caller. What OWS does not ship is a spend cap. Its
// native rules are the chains a key may use and when the grant expires,
// and its own docs say a per transaction or cumulative ceiling has to be
// written as an executable policy.
//
// An executable policy is a file on the agent's own machine, under the
// same operator. That is fine for an operator protecting itself and no use
// at all to a client who wants a number they can check. So this policy
// holds no number. It reads the ceiling and the spend so far out of the
// AgentSpend account on Solana, which the client wrote and the agent
// cannot raise, and refuses anything that would not fit.
//
// OWS pipes a PolicyContext JSON in on stdin and reads a verdict from
// stdout. Non zero exit is a deny.
//
// Install: ows policy add --wallet cleat-agent --exec scripts/ows-policy.mjs

import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const SPEND_SEED = Buffer.from("spend");

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ decision: "deny", reason }));
  process.exit(1);
};
const allow = (reason) => {
  process.stdout.write(JSON.stringify({ decision: "allow", reason }));
  process.exit(0);
};

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

/** Mirrors the Rust layout of AgentSpend, discriminator first. */
function decodeSpend(data) {
  let o = 8;
  const owner = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const agent = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const ceiling = data.readBigUInt64LE(o); o += 8;
  const periodSecs = data.readBigInt64LE(o); o += 8;
  const spent = data.readBigUInt64LE(o); o += 8;
  const periodStart = data.readBigInt64LE(o); o += 8;
  const lifetime = data.readBigUInt64LE(o); o += 8;
  const payments = data.readUInt32LE(o); o += 4;
  const refusals = data.readUInt32LE(o); o += 4;
  return { owner, agent, ceiling, periodSecs, spent, periodStart, lifetime, payments, refusals };
}

const main = async () => {
  const raw = await readStdin();
  let ctx = {};
  try {
    ctx = JSON.parse(raw || "{}");
  } catch {
    return deny("the policy context did not parse, so nothing is signed");
  }

  // Solana only. A key scoped to this wallet has no business anywhere else,
  // and OWS's own chain allowlist should already say so; this is the second
  // lock on the same door.
  const chain = ctx.chain ?? ctx.request?.chain ?? "";
  if (chain && !String(chain).startsWith("solana")) {
    return deny(`this key is for solana, not ${chain}`);
  }

  const owner = process.env.CLEAT_OWNER;
  if (!owner) return deny("CLEAT_OWNER is not set, so there is no ceiling to read");

  // What is being spent, in lamports. OWS reports value per chain; anything
  // it cannot express as a number is refused rather than guessed at.
  const asked = Number(
    ctx.value_lamports ?? ctx.spending?.value ?? ctx.request?.lamports ?? NaN,
  );
  if (!Number.isFinite(asked) || asked < 0) {
    return deny("the payment amount was not legible, so it was not signed");
  }

  const rpcUrl =
    process.env.CLEAT_RPC ||
    fs
      .readFileSync("~/Ilowa/Ilowa/server/.env", "utf8")
      .split("\n")
      .find((l) => l.startsWith("SOLANA_RPC_URL="))
      ?.slice("SOLANA_RPC_URL=".length)
      .trim();
  if (!rpcUrl) return deny("no rpc endpoint, so the ceiling could not be read");

  const [spendPda] = PublicKey.findProgramAddressSync(
    [SPEND_SEED, new PublicKey(owner).toBuffer()],
    PROGRAM_ID,
  );

  let acc;
  try {
    acc = await new Connection(rpcUrl, "confirmed").getAccountInfo(spendPda);
  } catch (e) {
    // A ceiling that cannot be read is not a ceiling of zero, it is an
    // unknown, and an unknown ceiling is a deny. Failing open here would
    // make the whole thing decorative.
    return deny(`could not reach the chain to read the ceiling: ${e.message}`);
  }
  if (!acc) return deny("no spending allowance exists for this owner");

  const s = decodeSpend(acc.data);
  const now = Math.floor(Date.now() / 1000);
  const lapsed = BigInt(now) >= s.periodStart + s.periodSecs;
  const remaining = lapsed ? s.ceiling : s.ceiling - s.spent;

  if (BigInt(Math.ceil(asked)) > remaining) {
    return deny(
      `the allowance has ${remaining} lamports left this period and this asks for ${asked}`,
    );
  }
  return allow(
    `${asked} of ${remaining} lamports remaining, read from ${spendPda.toBase58()}`,
  );
};

main().catch((e) => deny(`policy failed: ${e.message}`));
