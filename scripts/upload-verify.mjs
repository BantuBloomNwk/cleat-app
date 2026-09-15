// Upload a circuit and then check that what landed is what was sent.
//
// This exists because six circuits in a row came back as signed failures and
// the reason turned out to be neither the circuit nor the MXE nor the cluster.
// Arcium's node said `CircuitFailure(CircuitSerialization)`, which means it
// could not deserialize what it fetched, and reading the raw circuit account
// back showed why: 3,947 bytes across 2,359 separate runs were zeros on chain
// where the local artifact had data.
//
// The cause was a throttle. uploadCircuit fires its chunks as fast as the loop
// allows, the endpoint answers 429, so a 260ms gap was put in front of every
// RPC call. That made a forty chunk upload take minutes, which is longer than
// a blockhash lives, so some chunk transactions expired and were dropped. The
// SDK returned success either way, and the comp def was finalized over a
// circuit full of holes. The same bug had already been found and fixed for the
// finalize transaction and nobody went back for the chunks.
//
// So: upload, read back, compare, and repeat until the bytes agree. Never
// finalize anything that has not been verified.
//
// Run: node scripts/upload-verify.mjs <circuitName> [--finalize]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import {
  uploadCircuit, buildFinalizeCompDefTx, getCompDefAccOffset,
  getCompDefAccAddress, getRawCircuitAccAddress,
} from "@arcium-hq/client";
import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = process.argv[2];
const DO_FINALIZE = process.argv.includes("--finalize");
if (!CIRCUIT) { console.error("need a circuit name"); process.exit(1); }

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

// A gentle gap, not a crippling one. 60ms keeps us under the rate limit while
// leaving a forty chunk upload well inside the life of a blockhash.
let chain = Promise.resolve();
const gapped = (url, init) => {
  const turn = chain.then(() => new Promise((r) => setTimeout(r, Number(process.env.RPC_GAP_MS || 60))));
  chain = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
};

const connection = new Connection(baseRpc(), { commitment: "confirmed", fetch: gapped });
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });
const plain = new Connection(baseRpc(), "confirmed");

const local = Buffer.from(fs.readFileSync(new URL(`../build/${CIRCUIT}.arcis`, import.meta.url)));
const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);
const compDef = getCompDefAccAddress(PROGRAM_ID, offset);

console.log(`${CIRCUIT}: ${local.length} bytes, comp def ${compDef.toBase58()}`);

/** A read that survives the endpoint hiccuping, which it does. */
async function readAccount(key) {
  for (let i = 0; i < 6; i++) {
    try {
      return await plain.getAccountInfo(key);
    } catch (e) {
      if (i === 5) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return null;
}

/** What is actually on chain, with the account header stripped. */
async function onchain() {
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const a = await readAccount(getRawCircuitAccAddress(compDef, i));
    if (!a) break;
    parts.push(a.data.slice(9));
  }
  return parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
}

function diff(a, b) {
  let bad = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) bad++;
  return bad + Math.abs(a.length - b.length);
}

for (let attempt = 1; attempt <= 4; attempt++) {
  const before = await onchain();
  const bad = diff(before.slice(0, local.length), local);
  console.log(`attempt ${attempt}: ${bad} bytes wrong on chain`);
  if (bad === 0) { console.log("circuit on chain matches the artifact"); break; }

  console.log("  uploading...");
  try {
    const sigs = await uploadCircuit(provider, CIRCUIT, PROGRAM_ID, new Uint8Array(local), false);
    console.log(`  sent ${sigs.length} transactions`);
  } catch (e) {
    console.log("  upload threw:", String(e.message).slice(0, 120));
  }
  await new Promise((r) => setTimeout(r, 3000));
  const after = await onchain();
  const left = diff(after.slice(0, local.length), local);
  console.log(`  now ${left} bytes wrong`);
  if (left === 0) { console.log("circuit on chain matches the artifact"); break; }
  if (attempt === 4) { console.error("could not get a clean upload in four attempts"); process.exit(1); }
}

if (DO_FINALIZE) {
  console.log("\nfinalizing against verified bytes");
  await new Promise((r) => setTimeout(r, 1500));
  const tx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await plain.getLatestBlockhash()).blockhash;
  const sig = await sendAndConfirmTransaction(plain, tx, [owner], { commitment: "confirmed" });
  console.log("finalized:", sig.slice(0, 28) + "…");
}
