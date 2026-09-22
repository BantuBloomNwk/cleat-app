// The vault judges are invited to attack.
//
// The diary reads a curated log of sixteen decisions that between them
// exercise every reason the program has. That log is the record and it should
// not move, so anybody pushing on the boundary from the app pushes on this one
// instead: a separate owner, a separate mandate, a separate ring buffer, the
// same program and the same rules.
//
// Run once: node scripts/sandbox-setup.mjs
// It prints the agent secret to put in the Netlify environment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const IDL = JSON.parse(
  fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"),
);
const disc = (n) => {
  const ix = IDL.instructions.find((i) => i.name === n);
  if (!ix) throw new Error(`no instruction ${n}`);
  return Buffer.from(ix.discriminator);
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
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

// The same two companies the demo mandate rules out, across both issuers.
const DENIED = [
  new PublicKey("XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh"), // XOMx
  new PublicKey("XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts"), // CVXx
  new PublicKey("qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo"), // XOMon
  new PublicKey("7tgKziACteG26VjV5xKufojKxwTgCFyTwmWUmz5ondo"), // CVXon
];

async function main() {
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const owner = persisted("sandbox-owner");
  const agent = persisted("sandbox-agent");
  const base = new Connection(baseRpc(), "confirmed");

  const pda = (seed, who) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed), who.toBuffer()], PROGRAM_ID)[0];
  const mandate = pda("mandate", owner.publicKey);
  const vault = pda("vault", owner.publicKey);
  const log = pda("verdicts", owner.publicKey);

  const send = (ixs, signers) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(base, tx, signers, { commitment: "confirmed" });
  };

  for (const [who, need] of [[owner, 120_000_000], [agent, 300_000_000]]) {
    if ((await base.getBalance(who.publicKey)) < need / 2) {
      await send([SystemProgram.transfer({
        fromPubkey: funder.publicKey, toPubkey: who.publicKey, lamports: need,
      })], [funder]);
    }
  }

  // The same sentence the demo runs, so what a judge attacks is the same
  // policy the record was made under.
  const text = "Moderate growth, nothing over fifteen percent in one name, and no fossil fuels.";

  if (!(await base.getAccountInfo(mandate))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("create_mandate"), u16(0), str(text), u16(1500), u16(500), u16(20), vecPubkey(DENIED)]),
    })], [owner]);
    console.log("mandate created");
  }
  if (!(await base.getAccountInfo(vault))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, false), meta(vault, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("open_vault"), u16(0)]),
    })], [owner]);
    console.log("vault opened");
  }
  if (!(await base.getAccountInfo(log))) {
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(vault, false, false), meta(log, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("open_verdict_log"), u16(0)]),
    })], [owner]);
    console.log("verdict log opened");
  }

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true)],
    data: Buffer.concat([disc("set_book_size"), u16(0), u64(100_000_000_000)]),
  })], [owner]);

  // Thirty days, because the grant has to outlive the judging window and
  // thirty days is the longest the program will issue.
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), u16(0), agent.publicKey.toBuffer(), i64(60 * 60 * 24 * 30), u64(5_000_000_000)]),
  })], [owner]);

  console.log("\nsandbox ready");
  console.log("owner   ", owner.publicKey.toBase58());
  console.log("agent   ", agent.publicKey.toBase58());
  console.log("mandate ", mandate.toBase58());
  console.log("log     ", log.toBase58());
  console.log("\nput this in the netlify environment as CLEAT_SANDBOX_AGENT:");
  console.log(JSON.stringify(Array.from(agent.secretKey)));
}

main().catch((e) => {
  console.error("\nsandbox setup failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-10).join("\n"));
  process.exit(1);
});
