// Write the bytes that never landed, and verify before finalizing.
//
// Six circuits in a row came back as signed failures. The reason was not the
// circuit, the MXE, the cluster or the key material. Arcium's node reported
// `CircuitFailure(CircuitSerialization)`: it could not deserialize what it
// fetched. Reading the raw circuit account back showed why. Thousands of bytes
// were zeros on chain where the artifact had data.
//
// Two bugs in the client compound to produce that, and both are in
// uploadCircuit:
//
//   One blockhash is fetched before the upload loop and reused for every chunk
//   transaction in it. A forty chunk upload behind any rate limiting outlives
//   that blockhash, and the cluster drops whatever is still in flight when it
//   expires. Nothing throws. The function returns the signatures it managed.
//
//   Running it again does not repair anything, because uploadToCircuitAcc
//   returns early when the account merely exists at the right size. It checks
//   the length and never the contents, so once the space is allocated every
//   later upload writes nothing at all.
//
// Between them, a circuit can be finalized over an account full of holes and
// stay that way forever. So this writes the missing ranges directly, takes a
// fresh blockhash for every batch, and refuses to finalize until what is on
// chain equals the artifact byte for byte.
//
// Run: node scripts/circuit-repair.mjs <circuitName> [--finalize]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import {
  getArciumProgram, getCompDefAccOffset, getCompDefAccAddress,
  getRawCircuitAccAddress, buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const PER_TX = 814;        // MAX_UPLOAD_PER_TX_BYTES
const HEADER = 9;          // discriminator + bump
const MAX_REALLOC = 10240; // solana caps a single realloc at 10KB

const CIRCUIT = process.argv[2];
const DO_FINALIZE = process.argv.includes("--finalize");
if (!CIRCUIT) { console.error("need a circuit name"); process.exit(1); }

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

const conn = new Connection(baseRpc(), "confirmed");
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(owner), { commitment: "confirmed" });
const program = getArciumProgram(provider);

const local = Buffer.from(fs.readFileSync(new URL(`../build/${CIRCUIT}.arcis`, import.meta.url)));
const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);
const compDef = getCompDefAccAddress(PROGRAM_ID, offset);
console.log(`${CIRCUIT}: ${local.length} bytes, comp def ${compDef.toBase58()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, n = 6) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { if (i === n - 1) throw e; await sleep(700 * (i + 1)); }
  }
}

const send = async (tx, block) => {
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = block.blockhash;
  tx.lastValidBlockHeight = block.lastValidBlockHeight;
  return sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed", maxRetries: 5 });
};

async function onchainBytes() {
  const a = await retry(() => conn.getAccountInfo(getRawCircuitAccAddress(compDef, 0)));
  return a ? a.data.slice(HEADER) : null;
}

// ── Make room ────────────────────────────────────────────────────────
// initRawCircuitAcc creates the account, embiggenRawCircuitAcc grows it.
// Both are skipped when the account is already big enough, which is safe
// because size is the one thing the client's own check gets right.
{
  let acc = await retry(() => conn.getAccountInfo(getRawCircuitAccAddress(compDef, 0)));
  if (!acc) {
    console.log("creating the raw circuit account");
    const block = await retry(() => conn.getLatestBlockhash("confirmed"));
    await send(await program.methods.initRawCircuitAcc(offset, PROGRAM_ID, 0)
      .accounts({ signer: owner.publicKey }).transaction(), block);
    await sleep(1200);
    acc = await retry(() => conn.getAccountInfo(getRawCircuitAccAddress(compDef, 0)));
  }
  const want = local.length + HEADER;
  // embiggen takes no size: it grows by a fixed step, so it is called until
  // the account is big enough rather than told how big to be.
  let stuck = 0;
  while (acc && acc.data.length < want && stuck < 200) {
    const before = acc.data.length;
    const block = await retry(() => conn.getLatestBlockhash("confirmed"));
    try {
      await send(await program.methods
        .embiggenRawCircuitAcc(offset, PROGRAM_ID, 0)
        .accounts({ signer: owner.publicKey }).transaction(), block);
    } catch (e) {
      stuck++;
    }
    await sleep(250);
    acc = await retry(() => conn.getAccountInfo(getRawCircuitAccAddress(compDef, 0)));
    if (acc.data.length === before) stuck++; else stuck = 0;
    process.stdout.write(`  account ${acc.data.length} of ${want}\r`);
  }
  console.log(`\naccount is ${acc.data.length} bytes, need ${want}`);
}

// ── Write, check, rewrite ────────────────────────────────────────────
function badWindows(onchain) {
  const out = [];
  for (let start = 0; start < local.length; start += PER_TX) {
    const end = Math.min(start + PER_TX, local.length);
    for (let i = start; i < end; i++) {
      if (onchain[i] !== local[i]) { out.push(start); break; }
    }
  }
  return out;
}

for (let pass = 1; pass <= 8; pass++) {
  const onchain = await onchainBytes();
  if (!onchain) { console.error("no raw circuit account"); process.exit(1); }
  const windows = badWindows(onchain);
  console.log(`pass ${pass}: ${windows.length} of ${Math.ceil(local.length / PER_TX)} windows to write`);
  if (windows.length === 0) { console.log("on chain matches the artifact"); break; }

  let block = await retry(() => conn.getLatestBlockhash("confirmed"));
  let ok = 0;
  for (let i = 0; i < windows.length; i++) {
    // A fresh blockhash every few, which is the bug this whole script exists
    // for: the client takes one before the loop and reuses it throughout.
    if (i % 8 === 0) block = await retry(() => conn.getLatestBlockhash("confirmed"));
    const start = windows[i];
    const bytes = Buffer.alloc(PER_TX);
    local.copy(bytes, 0, start, Math.min(start + PER_TX, local.length));
    try {
      await retry(async () => {
        const tx = await program.methods
          .uploadCircuit(offset, PROGRAM_ID, 0, Array.from(bytes), start)
          .accounts({ signer: owner.publicKey }).transaction();
        return send(tx, block);
      }, 3);
      ok++;
    } catch (e) {
      if (/AlreadyCompleted/.test(String(e.message))) {
        console.error("\ncomp def is already finalized; this circuit name is spent");
        process.exit(2);
      }
    }
    process.stdout.write(`  ${i + 1}/${windows.length}, ${ok} landed\r`);
    await sleep(Number(process.env.RPC_GAP_MS || 200));
  }
  console.log();
  if (pass === 8) { console.error("still incomplete"); process.exit(1); }
}

if (DO_FINALIZE) {
  console.log("finalizing against verified bytes");
  const tx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await retry(() => conn.getLatestBlockhash("confirmed"))).blockhash;
  const sig = await sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
  console.log("finalized:", sig.slice(0, 28) + "…");
}
