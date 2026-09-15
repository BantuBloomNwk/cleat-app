// The probes, run.
//
// gate_breach_v2 finalises and comes back a signed failure with no output
// bytes. Everything around it is known good: the computation reaches the
// cluster, executes, finalises, and the callback is delivered, which is
// how we know the failure is the circuit body rather than the plumbing.
//
// So two circuits go up that differ from it by one step each, and their
// callbacks record what came back instead of erroring on it:
//
//   probe_a   a secret compared against a constant
//   probe_b   a secret compared against a plaintext argument
//
// gate_breach_v2 is the third rung, a secret plus a plaintext argument
// compared against another, and its answer is already on chain.
//
//   a fails                 the problem is decrypting Enc<Shared, u16> or
//                           revealing a bool at all, and nothing above it
//                           matters
//   a passes, b fails       mixing a public argument into a secret
//                           comparison is the break
//   a and b pass            the break is the addition, and the fix is to
//                           do it on chain: both terms are public there,
//                           so pass max_position_bps - effective_bps as
//                           one number and the circuit becomes probe_b,
//                           which reveals no more than it does today
//
// Run: node scripts/probe-run.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import { x25519 } from "@noble/curves/ed25519";
import {
  RescueCipher, getMXEPublicKey, getMXEAccAddress, getCompDefAccAddress,
  getCompDefAccOffset, getMempoolAccAddress, getExecutingPoolAccAddress,
  getComputationAccAddress, getClusterAccAddress, getFeePoolAccAddress,
  getClockAccAddress, getArciumSignerAccAddress, ARCIUM_ADDR,
  uploadCircuit, buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CLUSTER = 4500; // moved off 456 on 2026-09-15, see TOOLCHAIN.md
const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => {
  const ix = IDL.instructions.find((i) => i.name === n);
  if (!ix) throw new Error(`no instruction ${n} in the idl`);
  return Buffer.from(ix.discriminator);
};
const u16b = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64b = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rpc = baseRpc();

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
// Throttled, because uploadCircuit fires its forty odd chunks as fast as
// the event loop will let it and the endpoint answers with 429s until it
// gives up. web3.js takes a custom fetch, so the limit goes there rather
// than into a fork of the upload helper.
let chain = Promise.resolve();
const throttledFetch = (url, init) => {
  const turn = chain.then(() => new Promise((r) => setTimeout(r, Number(process.env.RPC_GAP_MS || 260))));
  chain = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
};
const connection = new Connection(rpc, {
  commitment: "confirmed",
  fetch: throttledFetch,
});
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });
const arcium = new PublicKey(ARCIUM_ADDR);
const mxe = getMXEAccAddress(PROGRAM_ID);

const send = (ixs, signers, skipPreflight = false) => {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner.publicKey;
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed", skipPreflight,
  });
};

/** Create the comp def if it is not there, upload the circuit, finalize. */
async function setup(name, initIx) {
  const offset = Buffer.from(getCompDefAccOffset(name)).readUInt32LE(0);
  const compDef = getCompDefAccAddress(PROGRAM_ID, offset);
  process.stdout.write(`  ${name}: comp def ${compDef.toBase58().slice(0, 8)}… `);

  if (!(await connection.getAccountInfo(compDef))) {
    const arciumProgram = new anchor.Program((await import("@arcium-hq/client")).ARCIUM_IDL, provider);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxe);
    const lut = (await import("@arcium-hq/client")).getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true), meta(mxe, false, true), meta(compDef, false, true),
        meta(lut, false, true), meta(LUT_PROGRAM_ID, false, false),
        meta(arcium, false, false), meta(SystemProgram.programId, false, false),
      ],
      data: disc(initIx),
    })], [owner]);
    process.stdout.write("created ");
  } else {
    process.stdout.write("exists ");
  }

  const raw = new Uint8Array(fs.readFileSync(new URL(`../build/${name}.arcis`, import.meta.url)));
  try {
    await uploadCircuit(provider, name, PROGRAM_ID, raw, true);
    process.stdout.write("uploaded ");
  } catch (e) {
    if (!/AlreadyCompleted/.test(String(e.message))) throw e;
    process.stdout.write("already complete ");
  }
  try {
    const tx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    await sendAndConfirmTransaction(connection, tx, [owner], { commitment: "confirmed" });
    process.stdout.write("finalized\n");
  } catch {
    process.stdout.write("finalize skipped\n");
  }
  return { offset, compDef };
}

/** Queue one probe and read the callback's own words out of the logs. */
async function run(name, queueIx, compDef, mxePub, exposureBps, arg) {
  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  const cipher = new RescueCipher(x25519.getSharedSecret(priv, mxePub));
  const nonce = crypto.randomBytes(16);
  const ct = cipher.encrypt([BigInt(exposureBps)], nonce);

  const compOffset = crypto.randomBytes(8).readBigUInt64LE(0) >> 1n;
  const computation = getComputationAccAddress(CLUSTER, new anchor.BN(compOffset.toString()));

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
    data: Buffer.concat([
      disc(queueIx), u64b(compOffset),
      Buffer.from(ct[0]), Buffer.from(pub), Buffer.from(nonce),
      u64b(arg), u64b(0),
    ]),
  })], [owner]);

  // Wait for the computation account to close, which is the network
  // saying it is done one way or the other, then read the callback.
  const WAIT = Number(process.env.PROBE_WAIT_MS || 300_000);
  let waited = 0, gone = false;
  while (waited < WAIT) {
    await sleep(3000); waited += 3000;
    if (!(await connection.getAccountInfo(computation))) { gone = true; break; }
  }
  if (!gone) return `  ${name}: still queued after ${Math.round(waited / 1000)}s`;

  await sleep(4000);
  const sigs = await connection.getSignaturesForAddress(computation, { limit: 12 });
  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    const line = (tx?.meta?.logMessages || []).find((l) => l.includes("PROBE "));
    if (line) return `  ${name}: ${line.replace(/^Program log: /, "")}`;
  }
  return `  ${name}: finished, but no callback log found (queued ${sig.slice(0, 12)}…)`;
}

const mxePub = await getMXEPublicKey(provider, PROGRAM_ID);
if (!mxePub) throw new Error("no MXE x25519 key");
console.log("mxe key present\n");

console.log("setting up:");
const only = process.env.PROBE_ONLY;
const a = only && only !== "a" ? null : await setup("probe_a", "init_probe_a_comp_def");
const b = only && only !== "b" ? null : await setup("probe_b", "init_probe_b_comp_def");

console.log("\nasking, with 12% already held and a 15% cap:");
if (a) console.log(await run("probe_a", "queue_probe_a", a.compDef, mxePub, 1200, 0));
if (b) console.log(await run("probe_b", "queue_probe_b", b.compDef, mxePub, 1200, 1500));
console.log("\nprobe_c is gate_breach_v2 and already answered: it aborts.");
