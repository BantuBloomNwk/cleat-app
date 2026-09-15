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
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = "gate_breach_v7";
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


async function main() {
  const owner = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  // Throttled. uploadCircuit fires its chunks as fast as the event loop
  // allows and the endpoint answers 429 until it gives up, which is what
  // stalled this for an hour the first time.
  let chain = Promise.resolve();
  const throttledFetch = (url, init) => {
    const turn = chain.then(
      () => new Promise((r) => setTimeout(r, Number(process.env.RPC_GAP_MS || 260))),
    );
    chain = turn.catch(() => {});
    return turn.then(() => fetch(url, init));
  };
  const connection = new Connection(baseRpc(), {
    commitment: "confirmed",
    fetch: throttledFetch,
  });
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

  // Upload and finalize moved to circuit-repair.mjs, which writes every
  // window with a fresh blockhash, reads the bytes back off chain, and
  // refuses to finalize until they match the artifact.
  //
  // What used to be here called uploadCircuit, which has three faults that
  // compound into a circuit nobody can run. It takes one blockhash before its
  // upload loop and reuses it for every chunk, so a long upload loses whatever
  // is still in flight when that expires. It finalizes the comp def at the end
  // regardless of whether the chunks landed. And running it again repairs
  // nothing, because it returns early when the account merely exists at the
  // right size, checking the length and never the contents.
  //
  // Six circuits were finalized over uploads with holes in them before anyone
  // read the bytes back. The node had been saying so the whole time:
  // CircuitFailure(CircuitSerialization).
  console.log("\nnow run:");
  console.log(`  node scripts/circuit-repair.mjs ${CIRCUIT} --finalize`);
}

main().catch((e) => {
  console.error("\ngate setup failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-14).join("\n"));
  process.exit(1);
});
