// The verdict log, end to end on devnet.
//
// Runs four proposals through a real mandate and shows what the policy did with
// each. This is the demo beat: an agent asks for something, the sentence its
// owner wrote decides, and the attempt is on the record either way.
//
// Nothing here touches the rollup. The verdict log lives on base because it is
// the one part of the product meant to be read by other people.
//
// Run: node scripts/verdicts.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");

const IDL = JSON.parse(
  fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"),
);
const disc = (name) => {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no instruction ${name} in the IDL`);
  return Buffer.from(ix.discriminator);
};

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const bool = (v) => Buffer.from([v ? 1 : 0]);
const u8 = (n) => Buffer.from([n]);
const str = (s) => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
};
const vecPubkey = (keys) => {
  const len = Buffer.alloc(4); len.writeUInt32LE(keys.length);
  return Buffer.concat([len, ...keys.map((k) => k.toBuffer())]);
};
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

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

function baseRpc() {
  const env = fs.readFileSync("~/Ilowa/Ilowa/server/.env", "utf8");
  const line = env.split("\n").find((l) => l.startsWith("SOLANA_RPC_URL="));
  if (!line) throw new Error("no SOLANA_RPC_URL to read");
  return line.slice("SOLANA_RPC_URL=".length).trim();
}

const SECTORS = ["unspecified", "technology", "energy", "healthcare", "financials", "consumer"];
const OUTCOME = ["cleared", "clamped", "refused"];
const REASON = [
  "",
  "past the position cap",
  "larger than one trade may be",
  "asset the mandate refuses",
  "mandate changed since the grant",
  "instruction came from something it read",
];

async function main() {
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const owner = persisted("verdict-owner");
  const agent = persisted("verdict-agent");
  const base = new Connection(baseRpc(), "confirmed");

  const [mandate] = PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [log] = PublicKey.findProgramAddressSync(
    [Buffer.from("verdicts"), owner.publicKey.toBuffer()], PROGRAM_ID);

  console.log("owner ", owner.publicKey.toBase58());
  console.log("agent ", agent.publicKey.toBase58());
  console.log("log   ", log.toBase58(), "\n");

  const send = (ixs, signers) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(base, tx, signers, { commitment: "confirmed" });
  };

  if ((await base.getBalance(owner.publicKey)) < 100_000_000) {
    await send([SystemProgram.transfer({
      fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 200_000_000,
    })], [funder]);
    console.log("funded the owner");
  }

  // A real sentence, with real caps: nothing over 15% in one name, and no
  // single trade may move more than 5% of the book.
  const text = "Moderate growth, nothing over fifteen percent in one name, and no fossil fuels.";
  if (!(await base.getAccountInfo(mandate))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, true), meta(SystemProgram.programId, false, false)],
      // 15% in one name, 5% in one trade, and nothing wider than 20 basis points
      data: Buffer.concat([disc("create_mandate"), str(text), u16(1500), u16(500), u16(20), vecPubkey([])]),
    })], [owner]);
    console.log("mandate created, position cap 15%, single trade cap 5%");
  }

  if (!(await base.getAccountInfo(vault))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, false), meta(vault, false, true), meta(SystemProgram.programId, false, false)],
      data: disc("open_vault"),
    })], [owner]);
    console.log("vault opened");
  }

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), agent.publicKey.toBuffer(), i64(3600), u64(250_000_000)]),
  })], [owner]);
  console.log("agent granted for one hour");

  if (!(await base.getAccountInfo(log))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(vault, false, false), meta(log, false, true), meta(SystemProgram.programId, false, false)],
      data: disc("open_verdict_log"),
    })], [owner]);
    console.log("verdict log opened");
  }

  if ((await base.getBalance(agent.publicKey)) < 20_000_000) {
    await send([SystemProgram.transfer({
      fromPubkey: funder.publicKey, toPubkey: agent.publicKey, lamports: 50_000_000,
    })], [funder]);
    console.log("funded the agent so it can pay its own fees");
  }

  const propose = async (label, category, bps, ingested, side = 0, spreadBps = 0) => {
    const t0 = performance.now();
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(agent.publicKey, true, true), meta(vault, false, false), meta(mandate, false, false), meta(log, false, true)],
      data: Buffer.concat([disc("propose_trade"), u8(category), u16(bps), bool(ingested), u8(side ?? 0), u16(spreadBps ?? 0)]),
    })], [agent]);
    console.log(`  ${label.padEnd(46)} ${String(Math.round(performance.now() - t0)).padStart(5)}ms`);
  };

  console.log("\nthe agent proposes six things");
  await propose("4% of the book in technology", 1, 400, false);
  await propose("12%, over the single trade cap", 1, 1200, false);
  await propose("40%, well past the position cap", 1, 4000, false);
  await propose("3%, but it came from a headline it read", 2, 300, true);
  // The one that needed the book rather than the size. Well inside every
  // cap, and into a market quoting thirty two basis points wide, which is
  // a real reading taken off the venue on a Sunday with New York shut.
  await propose("2% into a book 32 bps wide", 1, 200, false, 0, 32);
  // And the same width on the way out, which the size caps would have
  // waved through, because a cap on buying is not a cap on selling.
  await propose("exiting 8% into that same book", 1, 800, false, 1, 32);

  // Read the log back the way the app would.
  const info = await base.getAccountInfo(log);
  const d = info.data;
  let o = 8 + 32 + 32; // discriminator, owner, vault
  const head = d.readUInt8(o); o += 1;
  const cleared = d.readUInt32LE(o); o += 4;
  const clamped = d.readUInt32LE(o); o += 4;
  const refused = d.readUInt32LE(o); o += 4;
  const count = d.readUInt32LE(o); o += 4;

  console.log(`\nheld the line ${clamped + refused} times out of ${cleared + clamped + refused}`);
  console.log(`cleared ${cleared}   clamped ${clamped}   refused ${refused}\n`);

  const rows = [];
  for (let i = 0; i < count; i++) {
    const slot = d.readBigUInt64LE(o); o += 8;
    const version = d.readUInt16LE(o); o += 2;
    const category = d.readUInt8(o); o += 1;
    const proposed = d.readUInt16LE(o); o += 2;
    const allowed = d.readUInt16LE(o); o += 2;
    const outcome = d.readUInt8(o); o += 1;
    const reason = d.readUInt8(o); o += 1;
    rows.push({ slot, version, category, proposed, allowed, outcome, reason });
  }

  console.log("what a follower would see, with no holding and no amount in it");
  for (const r of rows) {
    const asked = (r.proposed / 100).toFixed(0) + "%";
    const got = r.outcome === 0 ? "allowed" : r.outcome === 1 ? `trimmed to ${(r.allowed / 100).toFixed(0)}%` : "refused";
    const why = r.reason ? `, ${REASON[r.reason]}` : "";
    console.log(`  asked for ${asked.padStart(3)} of ${SECTORS[r.category] || "?"}`.padEnd(40) + `${got}${why}`);
  }
  console.log(`\nring buffer head at ${head}, capacity 16`);
}

main().catch((e) => {
  console.error("\nverdict run failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-12).join("\n"));
  process.exit(1);
});
