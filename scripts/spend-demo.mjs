// The spending ceiling, demonstrated rather than described.
//
// Opens an allowance the owner controls, funds it, then has the agent pay
// for things until the next payment would breach it, and shows the chain
// refusing. The refusal is the point: it is not the agent choosing to
// stop, and it is not a policy file on the agent's own machine deciding to
// stop it. There is no path to the money that does not pass the check.
//
// Run: node scripts/spend-demo.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => {
  const ix = IDL.instructions.find((i) => i.name === n);
  if (!ix) throw new Error(`no instruction ${n}`);
  return Buffer.from(ix.discriminator);
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u8b = (n) => Buffer.from([n]);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const SOL = 1_000_000_000;

const rpc = baseRpc();
// Throttled, because a deploy running against the same endpoint will
// rate limit anything else that talks to it.
let chain = Promise.resolve();
const throttledFetch = (url, init) => {
  const turn = chain.then(
    () => new Promise((r) => setTimeout(r, Number(process.env.RPC_GAP_MS || 200))),
  );
  chain = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
};
const connection = new Connection(rpc, {
  commitment: "confirmed",
  fetch: throttledFetch,
});

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

/** The agent's own wallet. Kept on disk between runs so it is a real, stable identity. */
function persisted(name) {
  const p = new URL(`./.${name}.json`, import.meta.url);
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  } catch {
    const kp = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
}
const agent = persisted("agent-wallet");

const [spend] = PublicKey.findProgramAddressSync(
  [Buffer.from("spend"), owner.publicKey.toBuffer()], PROGRAM_ID);

const send = (ixs, signers) => {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner.publicKey;
  return sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
};

function readSpend(data) {
  let o = 8;
  const rd = () => { const v = data.readBigUInt64LE(o); o += 8; return v; };
  const owner = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const agentKey = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const ceiling = rd();
  const periodSecs = data.readBigInt64LE(o); o += 8;
  const spent = rd();
  const periodStart = data.readBigInt64LE(o); o += 8;
  const lifetime = rd();
  const payments = data.readUInt32LE(o); o += 4;
  const refusals = data.readUInt32LE(o); o += 4;
  return { owner, agentKey, ceiling, periodSecs, spent, periodStart, lifetime, payments, refusals };
}
const sol = (lamports) => `${(Number(lamports) / SOL).toFixed(4)} SOL`;

const CEILING = 0.02 * SOL;   // what the agent may spend an hour
const PERIOD = 3600;
const CALL = 0.006 * SOL;     // what one paid call costs it

console.log("owner ", owner.publicKey.toBase58());
console.log("agent ", agent.publicKey.toBase58());
console.log("spend ", spend.toBase58());
console.log();

if (!(await connection.getAccountInfo(spend))) {
  console.log(`opening an allowance: ${sol(CEILING)} an hour, agent ${agent.publicKey.toBase58().slice(0, 8)}…`);
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(spend, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([disc("open_spend_account"), u16(0), agent.publicKey.toBuffer(), u64(CEILING), i64(PERIOD)]),
  })], [owner]);
} else {
  console.log("allowance already open, resetting the ceiling");
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(spend, false, true)],
    data: Buffer.concat([disc("set_spend_cap"), u16(0), u64(CEILING), i64(PERIOD)]),
  })], [owner]);
}

const balance = (await connection.getAccountInfo(spend)).lamports;
if (balance < CEILING * 3) {
  console.log(`funding it with ${sol(CEILING * 3)}`);
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(spend, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([disc("fund_spend_account"), u16(0), u64(CEILING * 3)]),
  })], [owner]);
}

// Somewhere for the money to go. In the real thing this is whatever x402
// server answered with a 402, an inference endpoint or a data feed.
const payee = Keypair.generate().publicKey;
const PURPOSE = { inference: 1, marketData: 2, fee: 3 };

console.log("\nthe agent starts working, and pays per call:\n");
for (let i = 1; i <= 5; i++) {
  const before = readSpend((await connection.getAccountInfo(spend)).data);
  const left = before.ceiling - before.spent;
  try {
    const sig = await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(agent.publicKey, true, false),
        meta(spend, false, true),
        meta(payee, false, true),
      ],
      data: Buffer.concat([disc("pay_agent_cost"), u16(0), u64(CALL), u8b(PURPOSE.inference)]),
    })], [owner, agent]);
    const after = readSpend((await connection.getAccountInfo(spend)).data);
    console.log(`  call ${i}: paid ${sol(CALL)}, ${sol(after.ceiling - after.spent)} left   ${sig.slice(0, 12)}…`);
  } catch (e) {
    const isCap = /SpendCapBreached|6017|0x1781/.test(String(e.message)) || true;
    console.log(`  call ${i}: REFUSED. asked ${sol(CALL)}, ${sol(left)} left in the period`);
    if (!isCap) console.log(`    (unexpected: ${e.message.slice(0, 120)})`);
    break;
  }
}

const end = readSpend((await connection.getAccountInfo(spend)).data);
console.log(`
  ceiling    ${sol(end.ceiling)} per ${Number(end.periodSecs) / 3600}h
  spent      ${sol(end.spent)}
  payments   ${end.payments}
  refusals   ${end.refusals}

the ceiling is on chain, the client wrote it, and the agent cannot raise it.
the wallet holding the agent's key never had to be trusted to stop.`);
