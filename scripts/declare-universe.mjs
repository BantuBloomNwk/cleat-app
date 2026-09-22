// Write down which instruments a mandate may touch, and their sectors.
//
// The agent used to assert two independent things about the same asset, a
// category and a mint, and nothing on chain made them agree. It could call an
// energy name a healthcare name to get past a full sector, or name an
// instrument the deny list had never been told about and be judged only on
// size. This is the owner settling both, once, in an account no agent can
// write.
//
// Run: node scripts/declare-universe.mjs [--owner sandbox-owner]

import fs from "node:fs";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const IDL = JSON.parse(fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"));
const disc = (n) => Buffer.from(IDL.instructions.find((i) => i.name === n).discriminator);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

// Sector ids as the program counts them, matching SECTORS in app/src/lib/chain.ts:
// 0 unspecified, 1 technology, 2 energy, 3 healthcare, 4 financials, 5 consumer.
const ENTRIES = [
  // Nvidia, Backed's wrapper. The name every one of the size scenarios uses.
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", category: 1 },
  // Exxon, Ondo's wrapper. Declared as energy and separately on the deny list,
  // which is the point: it is in scope and still refused, so the refusal is a
  // decision about the asset rather than a gap in the list.
  { mint: "qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo", category: 2 },
];

const name = process.argv.includes("--owner")
  ? process.argv[process.argv.indexOf("--owner") + 1]
  : "sandbox-owner";
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(new URL(`./.${name}.json`, import.meta.url), "utf8"))));

const connection = new Connection(baseRpc(), "confirmed");
const [mandate] = PublicKey.findProgramAddressSync(
  [Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);
const [universe] = PublicKey.findProgramAddressSync(
  [Buffer.from("universe"), mandate.toBuffer()], PROGRAM_ID);

console.log(`owner    ${owner.publicKey.toBase58()}`);
console.log(`mandate  ${mandate.toBase58()}`);
console.log(`universe ${universe.toBase58()}`);

// Borsh: vec length as u32, then each entry as 32 byte mint plus a byte.
const len = Buffer.alloc(4);
len.writeUInt32LE(ENTRIES.length);
const data = Buffer.concat([
  disc("declare_universe"), u16(0), len,
  ...ENTRIES.map((e) => Buffer.concat([
    new PublicKey(e.mint).toBuffer(), Buffer.from([e.category]),
  ])),
]);

const sig = await sendAndConfirmTransaction(connection,
  new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: mandate, isSigner: false, isWritable: false },
      { pubkey: universe, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })), [owner], { commitment: "confirmed" });

console.log(`\ndeclared ${ENTRIES.length} instruments  ${sig}`);
for (const e of ENTRIES) console.log(`  ${e.mint}  sector ${e.category}`);
