// The confidential gate, running.
//
// Two proposals that are identical in the open and land differently, because
// the only thing separating them is a position nobody can see. That is the
// whole claim, and this is the script that proves it rather than asserting it.
//
// Run: node scripts/gate-run.mjs

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
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = "gate_breach_v2";
const CLUSTER = 456; // the devnet cluster this MXE was initialised on

const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => {
  const ix = IDL.instructions.find((i) => i.name === n);
  if (!ix) throw new Error(`no instruction ${n}`);
  return Buffer.from(ix.discriminator);
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u128 = (buf16) => Buffer.from(buf16); // already 16 LE bytes
const u8b = (n) => Buffer.from([n]);
const str = (s) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
const vecPubkey = (k) => { const l = Buffer.alloc(4); l.writeUInt32LE(k.length); return Buffer.concat([l, ...k.map((x) => x.toBuffer())]); };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

function persisted(name) {
  const p = new URL(`./.${name}.json`, import.meta.url);
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))); }
  catch { const kp = Keypair.generate(); fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey))); return kp; }
}
function baseRpc() {
  const env = fs.readFileSync("~/Ilowa/Ilowa/server/.env", "utf8");
  return env.split("\n").find((l) => l.startsWith("SOLANA_RPC_URL=")).slice("SOLANA_RPC_URL=".length).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLog(data) {
  let o = 8 + 32 + 32;
  const head = data.readUInt8(o); o += 1;
  const cleared = data.readUInt32LE(o); o += 4;
  const clamped = data.readUInt32LE(o); o += 4;
  const refused = data.readUInt32LE(o); o += 4;
  const count = data.readUInt32LE(o); o += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = {
      slot: data.readBigUInt64LE(o), version: data.readUInt16LE(o + 8),
      category: data.readUInt8(o + 10), proposed: data.readUInt16LE(o + 11),
      allowed: data.readUInt16LE(o + 13), outcome: data.readUInt8(o + 15),
      reason: data.readUInt8(o + 16),
    };
    o += 17; entries.push(e);
  }
  return { head, cleared, clamped, refused, entries };
}

async function main() {
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
  const owner = persisted("gate-owner");
  const connection = new Connection(baseRpc(), "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });

  const [mandate] = PublicKey.findProgramAddressSync([Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [log] = PublicKey.findProgramAddressSync([Buffer.from("verdicts"), owner.publicKey.toBuffer()], PROGRAM_ID);

  const arcium = new PublicKey(ARCIUM_ADDR);
  const mxe = getMXEAccAddress(PROGRAM_ID);
  const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);
  const compDef = getCompDefAccAddress(PROGRAM_ID, offset);

  console.log("owner  ", owner.publicKey.toBase58());
  console.log("mxe    ", mxe.toBase58());
  console.log("compdef", compDef.toBase58());

  const send = (ixs, signers, skipPreflight = false) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed", skipPreflight });
  };

  if ((await connection.getBalance(owner.publicKey)) < 150_000_000) {
    await send([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 300_000_000 })], [funder]);
    console.log("funded the owner");
  }

  const text = "Moderate growth, nothing over fifteen percent in one name, and no fossil fuels.";
  if (!(await connection.getAccountInfo(mandate))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("create_mandate"), str(text), u16(1500), u16(500), vecPubkey([])]) })], [owner]);
    console.log("mandate: 15% position cap, 5% single trade cap");
  }
  if (!(await connection.getAccountInfo(vault))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, false), meta(vault, false, true), meta(SystemProgram.programId, false, false)],
      data: disc("open_vault") })], [owner]);
    console.log("vault opened");
  }
  if (!(await connection.getAccountInfo(log))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(vault, false, false), meta(log, false, true), meta(SystemProgram.programId, false, false)],
      data: disc("open_verdict_log") })], [owner]);
    console.log("verdict log opened");
  }
  await send([new TransactionInstruction({ programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), owner.publicKey.toBuffer(), i64(3600), u64(250_000_000)]) })], [owner]);

  const mxePub = await getMXEPublicKey(provider, PROGRAM_ID);
  if (!mxePub) throw new Error("no MXE x25519 key yet");
  console.log("mxe x25519 key present\n");

  const ask = async (label, exposureBps, proposedBps, category) => {
    // Fresh keypair and nonce per request. The holdings are encrypted to a
    // secret shared with the MXE, so the program forwarding them never has a
    // key that would open them.
    const priv = x25519.utils.randomPrivateKey();
    const pub = x25519.getPublicKey(priv);
    const shared = x25519.getSharedSecret(priv, mxePub);
    const cipher = new RescueCipher(shared);
    const nonce = crypto.randomBytes(16);
    // one secret now: the exposure as a share of the book. The circuit needs
    // nothing else, because the caps are public on the mandate.
    const ct = cipher.encrypt([BigInt(exposureBps)], nonce);

    const compOffset = crypto.randomBytes(8).readBigUInt64LE(0) >> 1n;
    const computation = getComputationAccAddress(CLUSTER, new anchor.BN(compOffset.toString()));

    const before = readLog((await connection.getAccountInfo(log)).data);

    const t0 = performance.now();
    let sig;
    try {
      sig = await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true),
        meta(vault, false, false),
        meta(mandate, false, false),
        meta(log, false, true),
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
        disc("gate_trade"), u64(compOffset),
        Buffer.from(ct[0]),
        Buffer.from(pub), u128(nonce),
        u8b(category), u16(proposedBps),
      ]),
    })], [owner], true);
    } catch (err) {
      const m = String(err.message || err).match(/Transaction ([1-9A-HJ-NP-Za-km-z]{60,})/);
      if (m) err.signature = m[1];
      throw err;
    }
    const queued = Math.round(performance.now() - t0);

    // Wait for the MPC network to answer and the callback to write it down.
    let after = before, waited = 0;
    while (waited < 90_000) {
      await sleep(2000); waited += 2000;
      after = readLog((await connection.getAccountInfo(log)).data);
      if (after.entries.length > before.entries.length ||
          after.cleared + after.clamped + after.refused > before.cleared + before.clamped + before.refused) break;
    }
    const total_ms = Math.round(performance.now() - t0);
    const v = after.entries[after.entries.length - 1];
    const words = ["cleared", "clamped", "refused"];
    console.log(`  ${label}`);
    console.log(`    queued in ${queued}ms, decided in ${total_ms}ms`);
    if (v) console.log(`    verdict: ${words[v.outcome]}  asked ${(v.proposed/100).toFixed(0)}%  allowed ${(v.allowed/100).toFixed(0)}%`);
    else console.log(`    no verdict landed inside 90s`);
    return v;
  };

  console.log("two proposals that look identical from outside");
  await ask("3% of tech, with 1% already held there", 100, 300, 1);
  await ask("3% of tech, with 14% already held there", 1400, 300, 1);

  const final = readLog((await connection.getAccountInfo(log)).data);
  console.log(`\ncleared ${final.cleared}   clamped ${final.clamped}   refused ${final.refused}`);
  console.log("the difference was a number nobody outside the computation saw");
}

main().catch(async (e) => {
  console.error("\ngate run failed:", e.message || String(e));
  if (e.logs) console.error(e.logs.slice(-16).join("\n"));
  if (e.signature) {
    const c = new Connection(baseRpc(), "confirmed");
    await new Promise((r) => setTimeout(r, 5000));
    const t = await c.getTransaction(e.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    console.error("on chain err:", JSON.stringify(t?.meta?.err));
    console.error((t?.meta?.logMessages || ["no logs"]).join("\n"));
  }
  process.exit(1);
});
