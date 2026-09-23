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
// What one raw circuit account actually holds.
//
// Ten megabytes, per the SDK, and the earlier reading of this was wrong in
// an instructive way. An account that refused to grow past 94009 bytes
// looked like a hard per-account ceiling, and 94009 happened to be exactly
// the old circuit plus its header, which made the coincidence convincing.
//
// It was not a ceiling. embiggen grows an account to the length the comp
// def declares, and the comp def was declaring the old length because the
// deployed program had been built against the old circuit and bakes that
// number in through the macro. So the account was not refusing to grow, it
// was already the size it had been told to be. Redeploying the program
// fixed the declaration and the account grew the rest of the way on its
// own.
//
// The split across accounts stays in the code because the index exists and
// a genuinely large circuit will need it. It just does not trigger here.
const PER_ACC = 10_485_760 - 9;

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

async function onchainBytes(idx) {
  const a = await retry(() => conn.getAccountInfo(getRawCircuitAccAddress(compDef, idx)));
  return a ? a.data.slice(HEADER) : null;
}

function badWindows(onchain, slice) {
  const out = [];
  for (let start = 0; start < slice.length; start += PER_TX) {
    const end = Math.min(start + PER_TX, slice.length);
    for (let i = start; i < end; i++) {
      if (onchain[i] !== slice[i]) { out.push(start); break; }
    }
  }
  return out;
}

const nAcc = Math.ceil(local.length / PER_ACC);
console.log(`${local.length} bytes across ${nAcc} raw account${nAcc > 1 ? "s" : ""} of ${PER_ACC}`);

for (let idx = 0; idx < nAcc; idx++) {
  const slice = local.subarray(idx * PER_ACC, Math.min((idx + 1) * PER_ACC, local.length));
  const addr = getRawCircuitAccAddress(compDef, idx);
  console.log(`\nraw account ${idx}: ${slice.length} bytes at ${addr.toBase58()}`);

  // ── Make room ──────────────────────────────────────────────────────
  let acc = await retry(() => conn.getAccountInfo(addr));
  if (!acc) {
    console.log("  creating it");
    const block = await retry(() => conn.getLatestBlockhash("confirmed"));
    await send(await program.methods.initRawCircuitAcc(offset, PROGRAM_ID, idx)
      .accounts({ signer: owner.publicKey }).transaction(), block);
    await sleep(1200);
    acc = await retry(() => conn.getAccountInfo(addr));
  }
  const want = slice.length + HEADER;
  let stuck = 0;
  while (acc && acc.data.length < want && stuck < 40) {
    const before = acc.data.length;
    const block = await retry(() => conn.getLatestBlockhash("confirmed"));
    try {
      await send(await program.methods.embiggenRawCircuitAcc(offset, PROGRAM_ID, idx)
        .accounts({ signer: owner.publicKey }).transaction(), block);
    } catch (e) {
      stuck++;
      if (stuck === 1) console.log(`\n  embiggen failed at ${before}: ${String(e.message || e).slice(0, 200)}`);
    }
    await sleep(900);
    acc = await retry(() => conn.getAccountInfo(addr));
    if (acc.data.length === before) stuck++; else stuck = 0;
    process.stdout.write(`  growing ${acc.data.length} of ${want}\r`);
  }
  console.log(`\n  ${acc.data.length} bytes, need ${want}`);
  if (acc.data.length < want) {
    console.error(`  cannot grow account ${idx} past ${acc.data.length}. PER_ACC is wrong.`);
    process.exit(1);
  }

  // ── Write, check, rewrite ──────────────────────────────────────────
  for (let pass = 1; pass <= 8; pass++) {
    const onchain = await onchainBytes(idx);
    if (!onchain) { console.error("  account vanished"); process.exit(1); }
    const windows = badWindows(onchain, slice);
    console.log(`  pass ${pass}: ${windows.length} of ${Math.ceil(slice.length / PER_TX)} windows to write`);
    if (windows.length === 0) { console.log("  matches the artifact"); break; }

    let block = await retry(() => conn.getLatestBlockhash("confirmed"));
    let ok = 0;
    for (let i = 0; i < windows.length; i++) {
      if (i % 8 === 0) block = await retry(() => conn.getLatestBlockhash("confirmed"));
      const at = windows[i];
      const bytes = Buffer.alloc(PER_TX);
      slice.copy(bytes, 0, at, Math.min(at + PER_TX, slice.length));
      try {
        await retry(async () => {
          const tx = await program.methods
            // The offset is within this account, not within the circuit.
            .uploadCircuit(offset, PROGRAM_ID, idx, Array.from(bytes), at)
            .accounts({ signer: owner.publicKey }).transaction();
          return send(tx, block);
        }, 3);
        ok++;
      } catch (e) {
        if (/AlreadyCompleted/.test(String(e.message))) {
          console.error("\n  comp def is already finalized; this circuit name is spent");
          process.exit(2);
        }
      }
      process.stdout.write(`    ${i + 1}/${windows.length}, ${ok} landed\r`);
      await sleep(Number(process.env.RPC_GAP_MS || 200));
    }
    console.log();
    if (pass === 8) { console.error("  still incomplete"); process.exit(1); }
  }
}

if (DO_FINALIZE) {
  console.log("finalizing against verified bytes");
  const tx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await retry(() => conn.getLatestBlockhash("confirmed"))).blockhash;
  const sig = await sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
  console.log("finalized:", sig.slice(0, 28) + "…");
}
