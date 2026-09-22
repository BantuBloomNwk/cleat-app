// What the confidential gate actually costs, measured rather than asserted.
//
// The demo script answers "does it work". This one answers "how long, how
// much, and what happens when it does not come back", which is what a paper
// needs and what a sentence like "about five seconds" is not.
//
// Three things it does that gate-run.mjs does not:
//
// It polls at 250ms instead of 2000ms. The demo's resolution is coarser than
// the thing being measured, so every latency it reports is rounded to the
// nearest two seconds and a four second answer could be anything from three
// to five. That is fine for a demo and useless for a distribution.
//
// It reads the fee off both transactions. The owner pays to queue the
// question. Somebody else pays for the callback that writes the answer, and
// who that is and what it costs is a fact about running this at scale rather
// than an implementation detail.
//
// It runs the same question many times. One sample is an anecdote.
//
// Run: node scripts/measure-gate.mjs [samples]     default 12

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
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const MINT = new PublicKey("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
const CIRCUIT = "gate_breach_v7";
const CLUSTER = 456;
const SAMPLES = Number(process.argv[2] || 12);
const POLL_MS = 250;
const WAIT_MS = Number(process.env.GATE_WAIT_MS || 180_000);

const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => Buffer.from(IDL.instructions.find((i) => i.name === n).discriminator);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u8b = (n) => Buffer.from([n]);
const str = (s) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
const vecPubkey = (k) => { const l = Buffer.alloc(4); l.writeUInt32LE(k.length); return Buffer.concat([l, ...k.map((x) => x.toBuffer())]); };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function persisted(name) {
  const p = new URL(`./.${name}.json`, import.meta.url);
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))); }
  catch { const kp = Keypair.generate(); fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey))); return kp; }
}

function readLog(data) {
  let o = 8 + 32 + 32;
  const head = data.readUInt8(o); o += 1;
  const cleared = data.readUInt32LE(o); o += 4;
  const clamped = data.readUInt32LE(o); o += 4;
  const refused = data.readUInt32LE(o); o += 4;
  const count = data.readUInt32LE(o); o += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      slot: data.readBigUInt64LE(o), version: data.readUInt16LE(o + 8),
      category: data.readUInt8(o + 10), proposed: data.readUInt16LE(o + 11),
      allowed: data.readUInt16LE(o + 13), outcome: data.readUInt8(o + 15),
      reason: data.readUInt8(o + 16),
    });
    o += 17;
  }
  return { head, cleared, clamped, refused, entries, total: cleared + clamped + refused };
}

/** Percentiles on a small sample, nearest rank. Stated plainly because a
 *  twelve sample p90 is a weak claim and the paper should say so. */
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
  const owner = persisted("gate-owner-v2");
  const connection = new Connection(baseRpc(), "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });

  const [mandate] = PublicKey.findProgramAddressSync([Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [log] = PublicKey.findProgramAddressSync([Buffer.from("verdicts"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [universe] = PublicKey.findProgramAddressSync([Buffer.from("universe"), mandate.toBuffer()], PROGRAM_ID);

  const arcium = new PublicKey(ARCIUM_ADDR);
  const mxe = getMXEAccAddress(PROGRAM_ID);
  const compDef = getCompDefAccAddress(PROGRAM_ID, Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0));

  // Retry the transient ones. A long run should not die because devnet
  // handed back a blockhash that had already aged out by the time the
  // transaction arrived, which happens often enough to lose a whole sample
  // set to it. Anything that is a real rejection by the program is rethrown
  // immediately, because retrying that would just hide it.
  const TRANSIENT = /Blockhash not found|block height exceeded|Node is behind|429|timed out/i;
  const send = async (ixs, signers, skipPreflight = false) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const tx = new Transaction().add(...ixs);
        tx.feePayer = signers[0].publicKey;
        return await sendAndConfirmTransaction(connection, tx, signers,
          { commitment: "confirmed", skipPreflight });
      } catch (e) {
        if (attempt >= 4 || !TRANSIENT.test(String(e.message || e))) throw e;
        await sleep(1500 * (attempt + 1));
      }
    }
  };

  if ((await connection.getBalance(owner.publicKey)) < 400_000_000) {
    await send([SystemProgram.transfer({
      fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 800_000_000 })], [funder]);
    console.log("funded the owner");
  }

  const text = "Moderate growth, nothing over fifteen percent in one name, and no fossil fuels.";
  if (!(await connection.getAccountInfo(mandate))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("create_mandate"), u16(0), str(text), u16(1500), u16(500), u16(20), vecPubkey([])]) })], [owner]);
  }
  if (!(await connection.getAccountInfo(vault))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, false), meta(vault, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("open_vault"), u16(0)]) })], [owner]);
  }
  if (!(await connection.getAccountInfo(log))) {
    await send([new TransactionInstruction({ programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(vault, false, false), meta(log, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("open_verdict_log"), u16(0)]) })], [owner]);
  }
  await send([new TransactionInstruction({ programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), u16(0), owner.publicKey.toBuffer(), i64(7200), u64(750_000_000)]) })], [owner]);

  const mxePub = await getMXEPublicKey(provider, PROGRAM_ID);
  if (!mxePub) throw new Error("no MXE x25519 key yet");

  console.log(`program   ${PROGRAM_ID.toBase58()}`);
  console.log(`cluster   ${CLUSTER}`);
  console.log(`circuit   ${CIRCUIT}`);
  console.log(`samples   ${SAMPLES}, polling every ${POLL_MS}ms\n`);

  /** The fee a transaction actually cost, and who paid it. */
  const feeOf = async (sig) => {
    for (let i = 0; i < 12; i++) {
      const tx = await connection.getTransaction(sig, {
        commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx) return { fee: tx.meta?.fee ?? null, payer: tx.transaction.message.staticAccountKeys?.[0]?.toBase58() ?? null };
      await sleep(500);
    }
    return { fee: null, payer: null };
  };

  const runs = [];

  for (let n = 0; n < SAMPLES; n++) {
    // Alternate the hidden holding so the sample covers both a verdict that
    // clears and one that refuses. The public facts are identical in both,
    // which is the point of the system and also means latency should not
    // depend on the answer. If it does, that is a leak and worth reporting.
    const exposureBps = n % 2 === 0 ? 100 : 1400;
    const proposedBps = 300;
    // Rotate the sector. Every proposal that clears adds to that sector's
    // public running total, so hammering one sector walks it into its own
    // cap after five clears and the public check then refuses before the
    // confidential gate is ever queued. That is the program behaving
    // correctly and it makes the thing unmeasurable, so spread the load.
    // Sector zero is the unspecified one and is skipped.
    const category = (n % 5) + 1;

    const priv = x25519.utils.randomPrivateKey();
    const pub = x25519.getPublicKey(priv);
    const cipher = new RescueCipher(x25519.getSharedSecret(priv, mxePub));
    const nonce = crypto.randomBytes(16);
    const ct = cipher.encrypt([BigInt(exposureBps)], nonce);

    const handleSig = await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, false), meta(vault, false, true)],
      data: Buffer.concat([disc("set_position_handle"), u16(0), Buffer.from(ct[0])]),
    })], [owner]);

    const compOffset = crypto.randomBytes(8).readBigUInt64LE(0) >> 1n;
    const computation = getComputationAccAddress(CLUSTER, new anchor.BN(compOffset.toString()));
    const [pending] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), computation.toBuffer()], PROGRAM_ID);

    const before = readLog((await connection.getAccountInfo(log)).data);
    const t0 = performance.now();

    let sig;
    try {
      sig = await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true), meta(vault, false, false),
        meta(mandate, false, false), meta(log, false, true),
        meta(universe, false, false), meta(getArciumSignerAccAddress(PROGRAM_ID), false, true),
        meta(mxe, false, false), meta(getMempoolAccAddress(CLUSTER), false, true),
        meta(getExecutingPoolAccAddress(CLUSTER), false, true), meta(computation, false, true),
        meta(compDef, false, false), meta(pending, false, true),
        meta(getClusterAccAddress(CLUSTER), false, true), meta(getFeePoolAccAddress(), false, true),
        meta(getClockAccAddress(), false, true), meta(SystemProgram.programId, false, false),
        meta(arcium, false, false),
      ],
      data: Buffer.concat([
        disc("gate_trade"), u64(compOffset), u16(0), Buffer.from(ct[0]),
        Buffer.from(pub), Buffer.from(nonce), u8b(category), u16(proposedBps), u8b(0), MINT.toBuffer(),
      ]),
      })], [owner], true);
    } catch (e) {
      // The public caps sit in front of the confidential gate and are
      // cheaper, so a proposal can be refused before anything is queued.
      // That is a decision too, and one worth counting separately, because
      // it never cost an MPC round.
      const code = String(e.message || e).match(/"Custom":(\d+)/)?.[1];
      const name = IDL.errors?.find((x) => String(x.code) === code)?.name ?? `custom ${code}`;
      runs.push({ n, exposureBps, proposedBps, category, outcome: "refused before queue",
                  reason: name, queuedMs: Math.round(performance.now() - t0),
                  totalMs: null, landed: false, publicRefusal: true });
      console.log(`${String(n + 1).padStart(2)}/${SAMPLES}  held ${String(exposureBps / 100).padStart(4)}%  ` +
                  `refused by the public cap before queuing  (${name})`);
      continue;
    }

    const queuedMs = Math.round(performance.now() - t0);

    // Watch the log and the computation account together. A cluster that
    // never picked the job up leaves the account sitting; a job that ran and
    // failed closes it with nothing written. From the log alone those are
    // the same observation, and they are very different facts.
    let after = before, waited = 0, compSeen = true, compGoneAt = null;
    while (waited < WAIT_MS) {
      await sleep(POLL_MS); waited += POLL_MS;
      const [logInfo, compInfo] = await Promise.all([
        connection.getAccountInfo(log), connection.getAccountInfo(computation)]);
      if (compSeen && !compInfo) { compSeen = false; compGoneAt = waited; }
      after = readLog(logInfo.data);
      if (after.total > before.total) break;
      if (!compSeen && waited > compGoneAt + 4000) break;
    }
    const totalMs = Math.round(performance.now() - t0);
    const landed = after.total > before.total;
    const v = landed ? after.entries[after.entries.length - 1] : null;

    // The callback is submitted by the network, not by us. Find it by asking
    // the log account what touched it last, and read who paid.
    let callback = { fee: null, payer: null, sig: null };
    if (landed) {
      const sigs = await connection.getSignaturesForAddress(log, { limit: 1 }, "confirmed");
      if (sigs[0]) callback = { ...(await feeOf(sigs[0].signature)), sig: sigs[0].signature };
    }

    const queue = await feeOf(sig);
    const handle = await feeOf(handleSig);
    const outcome = v ? ["cleared", "clamped", "refused"][v.outcome] : (compSeen ? "never ran" : "no verdict");

    runs.push({
      n, exposureBps, proposedBps, category, outcome, reason: v?.reason ?? null,
      queuedMs, totalMs, landed,
      handleFee: handle.fee, queueFee: queue.fee,
      callbackFee: callback.fee, callbackPayer: callback.payer,
      queueSig: sig, callbackSig: callback.sig, computation: computation.toBase58(),
    });

    console.log(
      `${String(n + 1).padStart(2)}/${SAMPLES}  held ${String(exposureBps / 100).padStart(4)}%  ` +
      `${outcome.padEnd(9)}  queued ${String(queuedMs).padStart(5)}ms  verdict ${String(totalMs).padStart(6)}ms  ` +
      `fee ${queue.fee ?? "?"}+${callback.fee ?? "?"}`);
  }

  const landed = runs.filter((r) => r.landed);
  const lat = landed.map((r) => r.totalMs);
  const cleared = landed.filter((r) => r.outcome === "cleared").map((r) => r.totalMs);
  const refused = landed.filter((r) => r.outcome === "refused").map((r) => r.totalMs);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  const report = {
    measuredAt: new Date().toISOString(),
    program: PROGRAM_ID.toBase58(), cluster: CLUSTER, circuit: CIRCUIT,
    samples: SAMPLES, landed: landed.length, pollMs: POLL_MS,
    refusedBeforeQueue: runs.filter((r) => r.publicRefusal).length,
    latencyMs: {
      min: Math.min(...lat), p50: pct(lat, 50), p90: pct(lat, 90), max: Math.max(...lat),
      mean: Math.round(sum(lat) / lat.length),
    },
    // Reported separately because if they differ the answer is leaking
    // through the clock, which would be a finding rather than a footnote.
    byOutcomeMs: { cleared: { n: cleared.length, p50: pct(cleared, 50) },
                   refused: { n: refused.length, p50: pct(refused, 50) } },
    queueMs: { p50: pct(runs.map((r) => r.queuedMs), 50) },
    lamports: {
      handle: pct(runs.map((r) => r.handleFee).filter(Boolean), 50),
      queue: pct(runs.map((r) => r.queueFee).filter(Boolean), 50),
      callback: pct(landed.map((r) => r.callbackFee).filter(Boolean), 50),
      callbackPaidBy: [...new Set(landed.map((r) => r.callbackPayer).filter(Boolean))],
    },
    runs,
  };

  const dir = new URL("../measurements/", import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const out = new URL(`gate-${Date.now()}.json`, dir);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`\nlanded        ${landed.length}/${SAMPLES}`);
  console.log(`latency ms    min ${report.latencyMs.min}  p50 ${report.latencyMs.p50}  p90 ${report.latencyMs.p90}  max ${report.latencyMs.max}`);
  console.log(`cleared p50   ${report.byOutcomeMs.cleared.p50}ms over ${cleared.length}`);
  console.log(`refused p50   ${report.byOutcomeMs.refused.p50}ms over ${refused.length}`);
  console.log(`lamports      handle ${report.lamports.handle}  queue ${report.lamports.queue}  callback ${report.lamports.callback}`);
  console.log(`callback paid by ${report.lamports.callbackPaidBy.join(", ") || "unknown"}`);
  console.log(`\nwritten to ${path.basename(out.pathname)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
