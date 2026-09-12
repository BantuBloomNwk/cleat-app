// One time setup for the confidential gate: create the computation definition,
// upload the compiled circuit, finalize it.
//
// Run once per program deployment, and again whenever the circuit's bytecode
// changes. A finalized comp def is immutable and keyed by circuit name, so a
// recompile that changes bytes needs a new name, not a re-upload.
//
// Run: node scripts/gate-setup.mjs

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
import anchor from "@anchor-lang/core";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  ARCIUM_ADDR,
  ARCIUM_IDL,
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = "gate_trade";
const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

const IDL = JSON.parse(
  fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"),
);
const disc = (name) => {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no instruction ${name} in the IDL`);
  return Buffer.from(ix.discriminator);
};
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

function baseRpc() {
  const env = fs.readFileSync("~/Ilowa/Ilowa/server/.env", "utf8");
  const line = env.split("\n").find((l) => l.startsWith("SOLANA_RPC_URL="));
  return line.slice("SOLANA_RPC_URL=".length).trim();
}

async function main() {
  const owner = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const connection = new Connection(baseRpc(), "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    { commitment: "confirmed" },
  );

  const mxe = getMXEAccAddress(PROGRAM_ID);
  const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);
  const compDef = getCompDefAccAddress(PROGRAM_ID, offset);

  console.log("mxe      ", mxe.toBase58());
  console.log("comp def ", compDef.toBase58(), "offset", offset);

  // The MXE carries the slot its lookup table was created at, and the table
  // address derives from it, so it has to be read rather than guessed. Decoded
  // with Arcium's own IDL instead of poking at byte offsets.
  const arcium = new PublicKey(ARCIUM_ADDR);
  const arciumProgram = new anchor.Program(ARCIUM_IDL, provider);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxe);
  const lut = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);
  console.log("lut      ", lut.toBase58(), "from slot", mxeAcc.lutOffsetSlot.toString());
  console.log("status   ", JSON.stringify(mxeAcc.status), "cluster", mxeAcc.cluster);

  const existing = await connection.getAccountInfo(compDef);
  if (existing) {
    console.log("comp def already exists, skipping creation");
  } else {
    console.log("\ncreating the computation definition...");
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true),
        meta(mxe, false, true),
        meta(compDef, false, true),
        meta(lut, false, true),
        meta(LUT_PROGRAM_ID, false, false),
        meta(arcium, false, false),
        meta(SystemProgram.programId, false, false),
      ],
      data: disc("init_gate_comp_def"),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = owner.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [owner], {
      commitment: "confirmed", skipPreflight: false,
    });
    console.log("created:", sig.slice(0, 28) + "…");
  }

  console.log("\nuploading the circuit...");
  const raw = new Uint8Array(fs.readFileSync(new URL(`../build/${CIRCUIT}.arcis`, import.meta.url)));
  console.log(`circuit is ${raw.length} bytes`);
  const sigs = await uploadCircuit(provider, CIRCUIT, PROGRAM_ID, raw, true);
  console.log(`uploaded in ${sigs.length} transactions`);

  console.log("\nfinalizing...");
  const finalizeTx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
  finalizeTx.feePayer = owner.publicKey;
  finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const fsig = await sendAndConfirmTransaction(connection, finalizeTx, [owner], { commitment: "confirmed" });
  console.log("finalized:", fsig.slice(0, 28) + "…");
}

main().catch((e) => {
  console.error("\ngate setup failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-14).join("\n"));
  process.exit(1);
});
