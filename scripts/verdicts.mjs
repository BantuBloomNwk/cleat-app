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
import { baseRpc } from "./rpc.mjs";

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


const SECTORS = ["unspecified", "technology", "energy", "healthcare", "financials", "consumer"];

// What "no fossil fuels" resolves to.
//
// The program cannot read English, so the clause is resolved off chain into a
// list of mints and the list is what gets enforced. These two are real, live on
// Solana mainnet today, and they are Exxon and Chevron wrapped by Backed. The
// point of naming them rather than inventing an address is that a reader can go
// and look.
const DENIED = [
  new PublicKey("XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh"), // XOMx, Exxon
  new PublicKey("XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts"), // CVXx, Chevron
];

// The same two companies, wrapped by somebody else.
//
// This is the part a deny list gets wrong. A ticker on Solana is not one
// thing: Exxon exists today as Backed's XOMx and as Ondo's XOMon, two
// addresses for one company, and an agent refused at the first routes to
// the second without breaking a rule, because the rule only knew about the
// first. MicroStrategy currently has three. So a clause resolves across
// issuers or it is decoration.
const DENIED_EVERY_ISSUER = DENIED.concat([
  new PublicKey("qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo"), // XOMon, Exxon
  new PublicKey("7tgKziACteG26VjV5xKufojKxwTgCFyTwmWUmz5ondo"), // CVXon, Chevron
]);
// A technology name, so the ordinary proposals have something to name.
const NVDAX = new PublicKey("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
const OUTCOME = ["cleared", "clamped", "refused"];
const REASON = [
  "",
  "past the position cap",
  "larger than one trade may be",
  "asset the mandate refuses",
  "mandate changed since the grant",
  "instruction came from something it read",
  "book wider than the mandate will trade into",
  "sector already at its cap",
  "past the agent's hard ceiling in cash",
  "the owner halted the mandate",
];

async function main() {
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const owner = persisted("demo-owner");
  const agent = persisted("demo-agent");
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
      data: Buffer.concat([disc("create_mandate"), str(text), u16(1500), u16(500), u16(20), vecPubkey(DENIED)]),
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

  // A hundred thousand dollars of book, and a cash ceiling of two and a half
  // thousand on any one trade. Two limits of different kinds on purpose: a
  // percentage cap alone misbehaves when the book is small, and a cash cap
  // alone misbehaves when it is large.
  const BOOK = 100_000_000_000; // 100,000.000000 in six decimal quote units
  const CEILING = 5_000_000_000; // 5,000.000000, which is what a 5% trade costs

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true)],
    data: Buffer.concat([disc("set_book_size"), u64(BOOK)]),
  })], [owner]);

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), agent.publicKey.toBuffer(), i64(3600), u64(CEILING)]),
  })], [owner]);
  console.log("agent granted for one hour, book 100,000, cash ceiling 5,000 a trade");

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

  const propose = async (label, category, bps, ingested, side = 0, spreadBps = 0, mint = null) => {
    const t0 = performance.now();
    await send([new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(agent.publicKey, true, true), meta(vault, false, false), meta(mandate, false, false), meta(log, false, true)],
      data: Buffer.concat([
        disc("propose_trade"), u8(category), u16(bps), bool(ingested),
        u8(side ?? 0), u16(spreadBps ?? 0), (mint ?? NVDAX).toBuffer(),
      ]),
    })], [agent]);
    console.log(`  ${label.padEnd(46)} ${String(Math.round(performance.now() - t0)).padStart(5)}ms`);
  };

  console.log("\nthe agent proposes sixteen things");
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
  // The English clause, enforced. Size never enters into it.
  await propose("5% of Exxon, which the sentence rules out", 2, 500, false, 0, 0, DENIED[0]);

  // The owner changes their mind, which is the point of holding the key.
  //
  // Nothing about the mandate moves and nothing about the agent moves. The
  // owner simply lowers what one trade may cost in cash, from five thousand to
  // two and a half, and the next proposal is refused for a reason no percentage
  // cap could have expressed. That is why there are two ceilings of different
  // kinds rather than one.
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), agent.publicKey.toBuffer(), i64(3600), u64(2_500_000_000)]),
  })], [owner]);
  console.log("  the owner lowers the cash ceiling to 2,500 a trade");

  await propose("3% of technology, now $3,000 a trade", 1, 300, false);

  // The part a single trade cap cannot do.
  //
  // Technology already stands at 9% from the two that went through above. Each
  // of these is inside the 5% single trade cap and inside the 15% position cap
  // on its own, and it is the running total that stops them. Without one, all
  // four would clear and the book would sit at 17% under a sentence that says
  // fifteen.
  await propose("2% more of technology, taking it to 11%", 1, 200, false);
  await propose("2% more, taking it to 13%", 1, 200, false);
  await propose("3% more, with only 2% of room left", 1, 300, false);
  await propose("2% again, with the sector now full", 1, 200, false);

  // The kill switch, which is the one control that is always reachable.
  //
  // Revoking the agent writes to the vault, and a vault delegated to the
  // ephemeral rollup is owned by the delegation program on base, so that path
  // needs the rollup to answer. This one does not: a mandate is never
  // delegated, so a single transaction from the owner stops everything
  // regardless of what the rollup is doing.
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(mandate, false, true)],
    data: Buffer.concat([disc("set_halted"), bool(true)]),
  })], [owner]);
  console.log("  the owner halts the mandate");

  await propose("1% of technology, well inside every cap", 1, 100, false);

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(mandate, false, true)],
    data: Buffer.concat([disc("set_halted"), bool(false)]),
  })], [owner]);
  console.log("  the owner lifts the halt");

  // A different sector, because technology has been full since the fill above.
  await propose("1% of healthcare, with the halt lifted", 3, 100, false);

  // The gap a deny list has when it names one issuer.
  //
  // The sentence has ruled out fossil fuels the whole way through, and the
  // agent could have bought Exxon anyway, because the list named Backed's
  // wrapper and Ondo's is a different address. So the owner widens the
  // clause to every issuer that has wrapped those two companies.
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(mandate, false, true)],
    data: Buffer.concat([
      disc("update_mandate"), str(text), u16(1500), u16(500), u16(20),
      vecPubkey(DENIED_EVERY_ISSUER),
    ]),
  })], [owner]);
  console.log("  the owner widens the fossil fuel clause to every issuer");

  // Editing the mandate moved its version, and the agent's grant was pinned
  // to the old one. Nothing it proposes counts until the owner re-issues,
  // which is the whole point: a sentence the agent has not been granted
  // against is a sentence it cannot act on.
  await propose("1% of healthcare, on a grant that no longer matches", 3, 100, false);

  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(vault, false, true), meta(mandate, false, false)],
    data: Buffer.concat([disc("set_agent"), agent.publicKey.toBuffer(), i64(3600), u64(2_500_000_000)]),
  })], [owner]);
  console.log("  the owner re-issues the grant against the new version");

  // The address that was not on the list an hour ago.
  await propose("2% of Exxon through Ondo instead", 2, 200, false, 0, 0, DENIED_EVERY_ISSUER[2]);

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
  const exposure = [];
  for (let i = 0; i < SECTORS.length; i++) { exposure.push(d.readUInt16LE(o)); o += 2; }
  console.log("\nwhere the book stands now, by sector, with no holding revealed");
  exposure.forEach((bps, i) => {
    if (bps > 0) console.log(`  ${SECTORS[i].padEnd(14)} ${(bps / 100).toFixed(2)}% of a 15.00% cap`);
  });

  console.log(`\nring buffer head at ${head}, capacity 16`);
}

main().catch((e) => {
  console.error("\nverdict run failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-12).join("\n"));
  process.exit(1);
});
