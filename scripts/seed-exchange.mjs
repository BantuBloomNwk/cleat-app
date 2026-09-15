// Mandates that differ from one another.
//
// The exchange was showing eleven accounts and nine of them were the same
// sentence, because every test run used the same one. That reads as a bug
// rather than a product: the whole point of the exchange is that people write
// different rules and can see each other's.
//
// So this writes a set that actually differ, in the sentence, the caps, what
// they rule out and whether they were forked from somebody else. Each gets its
// own owner, because a mandate is seeded by its author's key and two owners
// cannot share one.
//
// Run: node scripts/seed-exchange.mjs
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
const disc = (n) => Buffer.from(IDL.instructions.find((i) => i.name === n).discriminator);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const str = (s) => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
};
const vecPubkey = (k) => {
  const len = Buffer.alloc(4); len.writeUInt32LE(k.length);
  return Buffer.concat([len, ...k.map((x) => x.toBuffer())]);
};
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

const XOMx = new PublicKey("XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh");
const CVXx = new PublicKey("XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts");
const XOMon = new PublicKey("qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo");
const CVXon = new PublicKey("7tgKziACteG26VjV5xKufojKxwTgCFyTwmWUmz5ondo");
const MSTRx = new PublicKey("XsP7xzNPvEHS1m6qfanPUGjNmdpmUUypQqgEQXdDMxg");

// Real sentences somebody might actually write, with caps that follow from
// them rather than caps picked to look varied.
const MANDATES = [
  {
    key: "steady",
    text: "Steady income, nothing over eight percent in one sector, and never trade a book wider than ten basis points.",
    position: 800, trade: 300, spread: 10, denied: [],
  },
  {
    key: "ethical",
    text: "Growth, but no fossil fuels and nothing over twelve percent in one sector.",
    position: 1200, trade: 400, spread: 25, denied: [XOMx, CVXx, XOMon, CVXon],
  },
  {
    key: "cautious",
    text: "Preserve capital first. Five percent in any sector, two percent in any single trade, and only tight books.",
    position: 500, trade: 200, spread: 5, denied: [],
  },
  {
    key: "concentrated",
    text: "High conviction. Up to twenty five percent in one sector, no single trade over five percent, no leveraged proxies.",
    position: 2500, trade: 500, spread: 40, denied: [MSTRx],
  },
  {
    key: "overnight",
    text: "Trade the overnight session only, nothing over ten percent in a sector, and refuse anything wider than fifteen basis points.",
    position: 1000, trade: 250, spread: 15, denied: [],
  },
];

async function main() {
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
  const base = new Connection(baseRpc(), "confirmed");
  const send = (ixs, signers) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(base, tx, signers, { commitment: "confirmed" });
  };

  for (const m of MANDATES) {
    const p = new URL(`./.exchange-${m.key}.json`, import.meta.url);
    let owner;
    try {
      owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
    } catch {
      owner = Keypair.generate();
      fs.writeFileSync(p, JSON.stringify(Array.from(owner.secretKey)));
    }
    const [mandate] = PublicKey.findProgramAddressSync(
      [Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);

    if (await base.getAccountInfo(mandate)) {
      console.log(`${m.key.padEnd(13)} exists`);
      continue;
    }
    if ((await base.getBalance(owner.publicKey)) < 30_000_000) {
      await send([SystemProgram.transfer({
        fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 40_000_000,
      })], [funder]);
    }
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(owner.publicKey, true, true), meta(mandate, false, true),
             meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("create_mandate"), str(m.text),
        u16(m.position), u16(m.trade), u16(m.spread), vecPubkey(m.denied)]),
    })], [owner]);
    console.log(`${m.key.padEnd(13)} created  ${owner.publicKey.toBase58().slice(0, 8)}…`);
  }
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-6).join("\n"));
  process.exit(1);
});
