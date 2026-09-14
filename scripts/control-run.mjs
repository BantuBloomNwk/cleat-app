// The control: does a circuit that is known to work run under our MXE?
//
// Five of our circuits have aborted, differing in every dimension we could
// think to vary. This one is Ilowa's init_pool_state_v4 copied without
// changes, which runs today on this same cluster under a different MXE. It
// takes no input, so there is no encryption on the way in to get wrong.
//
// If it works here the fault is ours and the search halves. If it aborts
// here the fault is this MXE or this program, and no rewrite of the gate
// was ever going to fix it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import {
  getMXEAccAddress, getCompDefAccAddress, getCompDefAccOffset,
  getMempoolAccAddress, getExecutingPoolAccAddress, getComputationAccAddress,
  getClusterAccAddress, getFeePoolAccAddress, getClockAccAddress,
  getArciumSignerAccAddress, getLookupTableAddress, ARCIUM_ADDR, ARCIUM_IDL,
  uploadCircuit, buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = "control_init_pool";
const CLUSTER = 456;
const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => Buffer.from(IDL.instructions.find((i) => i.name === n).discriminator);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// This machine resolves IPv6 first and stalls before falling back, so a
// single fetch failing means the network rather than the experiment.
async function retry(fn, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < attempts) await sleep(600 * i); }
  }
  throw last;
}

const rpc = baseRpc();

let chain = Promise.resolve();
const throttled = (url, init) => {
  const turn = chain.then(() => new Promise((r) => setTimeout(r, Number(process.env.RPC_GAP_MS || 240))));
  chain = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
};

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const connection = new Connection(rpc, { commitment: "confirmed", fetch: throttled });
const plain = new Connection(rpc, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });
const arcium = new PublicKey(ARCIUM_ADDR);
const mxe = getMXEAccAddress(PROGRAM_ID);

const send = (ixs, conn = plain) => {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner.publicKey;
  return sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
};

const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);
const compDef = getCompDefAccAddress(PROGRAM_ID, offset);
console.log("mxe     ", mxe.toBase58());
console.log("comp def", compDef.toBase58());

if (!(await retry(() => plain.getAccountInfo(compDef)))) {
  const ap = new anchor.Program(ARCIUM_IDL, provider);
  const mxeAcc = await retry(() => ap.account.mxeAccount.fetch(mxe));
  const lut = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true), meta(mxe, false, true), meta(compDef, false, true),
      meta(lut, false, true), meta(LUT_PROGRAM_ID, false, false),
      meta(arcium, false, false), meta(SystemProgram.programId, false, false),
    ],
    data: disc("init_control_comp_def"),
  })]);
  console.log("comp def created");
} else {
  console.log("comp def exists");
}

const raw = new Uint8Array(fs.readFileSync(new URL(`../build/${CIRCUIT}.arcis`, import.meta.url)));
console.log(`circuit ${raw.length} bytes, uploading`);
try { await uploadCircuit(provider, CIRCUIT, PROGRAM_ID, raw, true); }
catch (e) { if (!/AlreadyCompleted|OnchainFinalized/.test(String(e.message))) throw e; console.log("already finalized"); }

await sleep(1500);
try {
  const tx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await retry(() => plain.getLatestBlockhash())).blockhash;
  await sendAndConfirmTransaction(plain, tx, [owner], { commitment: "confirmed" });
  console.log("finalized");
} catch (e) { console.log("finalize skipped:", String(e.message).slice(0, 60)); }

const compOffset = crypto.randomBytes(8).readBigUInt64LE(0) >> 1n;
const computation = getComputationAccAddress(CLUSTER, new anchor.BN(compOffset.toString()));

console.log("\nqueueing the control");
const sig = await send([new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    meta(owner.publicKey, true, true),
    meta(getArciumSignerAccAddress(PROGRAM_ID), false, true),
    meta(mxe, false, false),
    meta(getMempoolAccAddress(CLUSTER), false, true),
    meta(getExecutingPoolAccAddress(CLUSTER), false, true),
    meta(computation, false, true),
    meta(compDef, false, false),
    meta(getClusterAccAddress(CLUSTER), false, true),
    meta(getFeePoolAccAddress(), false, true),
    meta(getClockAccAddress(), false, true),
    meta(SystemProgram.programId, false, false),
    meta(arcium, false, false),
  ],
  data: Buffer.concat([disc("queue_control"), u64(compOffset)]),
})]);
console.log("queued", sig.slice(0, 20) + "…");

for (let i = 0; i < 60; i++) {
  await sleep(3000);
  if (!(await retry(() => plain.getAccountInfo(computation)).catch(() => null))) break;
}
await sleep(4000);

const sigs = await retry(() => plain.getSignaturesForAddress(computation, { limit: 12 }));
let said = false;
for (const s of sigs) {
  const tx = await plain.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  const line = (tx?.meta?.logMessages || []).find((l) => l.includes("CONTROL"));
  if (line) { console.log("\n" + line.replace(/^Program log: /, "")); said = true; break; }
}
if (!said) console.log("\nno callback log found; computation", computation.toBase58());
