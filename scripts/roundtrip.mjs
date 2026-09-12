// Full PER round trip against devnet, with timings from this machine.
//
// Opens a mandate and a vault on base, grants an agent, hands the vault to
// MagicBlock's TDX validator, seals it inside the enclave, reads it back from
// the rollup, then commits and undelegates. Every step is timed, because the
// claim being tested is not only that it works but that it is fast enough that
// a person would not notice it happening.
//
// Run: node scripts/roundtrip.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  permissionPdaFromAccount,
  verifyTeeRpcIntegrity,
  getAuthToken,
  escrowPdaFromEscrowAuthority,
  createTopUpEscrowInstruction,
  createDelegateInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const ER_URL = "https://devnet-tee.magicblock.app";

// Discriminators read straight out of the generated IDL rather than recomputed,
// so a rename in the program shows up here as a failure instead of a mystery.
const IDL = JSON.parse(
  fs.readFileSync(new URL("../target/idl/cleat.json", import.meta.url), "utf8"),
);
const disc = (name) => {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no instruction ${name} in the IDL`);
  return Buffer.from(ix.discriminator);
};

// ── borsh, only the four shapes this script needs ──
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

function loadWallet() {
  const p = path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function baseRpc() {
  // Never the public endpoint. It drops the delegation transactions.
  const env = fs.readFileSync("~/Ilowa/Ilowa/server/.env", "utf8");
  const line = env.split("\n").find((l) => l.startsWith("SOLANA_RPC_URL="));
  if (!line) throw new Error("no SOLANA_RPC_URL to read");
  return line.slice("SOLANA_RPC_URL=".length).trim();
}

// The rollup will only let a DELEGATED account pay its fees, because an
// undelegated base account is not reachable from inside the ER. Delegating the
// founder's main wallet for that would be heavy handed, so a dedicated session
// payer does the job, which also happens to be the shape the product wants
// anyway: short lived keys with a small balance and no authority over anything.
function loadSessionPayer() {
  const p = new URL("./.session-payer.json", import.meta.url);
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  } catch {
    const kp = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
}

const times = [];
async function step(label, fn) {
  const t0 = performance.now();
  let out, err;
  try { out = await fn(); } catch (e) { err = e; }
  const ms = Math.round(performance.now() - t0);
  times.push({ label, ms, ok: !err });
  if (err) {
    console.log(`  ${label.padEnd(34)} FAILED after ${ms}ms`);
    throw err;
  }
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)}ms`);
  return out;
}

async function main() {
  const owner = loadWallet();
  const base = new Connection(baseRpc(), "confirmed");
  let er = null; // opened after session auth, below

  const [mandate] = PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()], PROGRAM_ID);
  const permission = permissionPdaFromAccount(vault);

  console.log("owner     ", owner.publicKey.toBase58());
  console.log("mandate   ", mandate.toBase58());
  console.log("vault     ", vault.toBase58());
  console.log("permission", permission.toBase58());
  console.log("validator ", TEE_VALIDATOR.toBase58());
  console.log("");

  const send = (conn, ixs, signers = [owner]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(conn, tx, signers, {
      commitment: "confirmed", skipPreflight: false,
    });
  };

  // 0. The attestation. Without this the rest is just a fast rollup.
  await step("verify TDX attestation", () => verifyTeeRpcIntegrity(ER_URL));

  // 0b. Session auth. A private rollup will not take traffic from an unproven
  // identity, so every request carries a token signed by the owner's key. This
  // is also the first half of why the operator cannot simply read the account:
  // it has to be somebody, and being somebody is what the member flags gate.
  const signCb = async (msg) => nacl.sign.detached(msg, owner.secretKey);
  const freshEr = async () => {
    const { token } = await getAuthToken(ER_URL, owner.publicKey, signCb);
    return new Connection(`${ER_URL}?token=${token}`, "confirmed");
  };
  await step("session auth", async () => { er = await freshEr(); });

  // 1. The mandate, in the founder's own words.
  const text = "Moderate growth, nothing over fifteen percent in one name, and no fossil fuels.";
  if (!(await base.getAccountInfo(mandate))) {
    await step("create_mandate", () => send(base, [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true),
        meta(mandate, false, true),
        meta(SystemProgram.programId, false, false),
      ],
      data: Buffer.concat([disc("create_mandate"), str(text), u16(1500), u16(500), vecPubkey([])]),
    })]));
  } else {
    console.log("  create_mandate                     exists, skipped");
  }

  // 2. The vault.
  if (!(await base.getAccountInfo(vault))) {
    await step("open_vault", () => send(base, [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(owner.publicKey, true, true),
        meta(mandate, false, false),
        meta(vault, false, true),
        meta(SystemProgram.programId, false, false),
      ],
      data: disc("open_vault"),
    })]));
  } else {
    console.log("  open_vault                         exists, skipped");
  }

  const preDelegated = (await base.getAccountInfo(vault))?.owner.equals(DELEGATION_PROGRAM_ID);
  if (preDelegated) {
    console.log("  set_agent                          vault already delegated, skipped");
    console.log("  delegate_vault                     already delegated, skipped");
  }

  // 3. Grant an agent. Throwaway key: the point is that the flags differ, not who it is.
  const agent = Keypair.generate();
  if (!preDelegated) await step("set_agent", () => send(base, [new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, false),
      meta(vault, false, true),
      meta(mandate, false, false),
    ],
    data: Buffer.concat([disc("set_agent"), agent.publicKey.toBuffer(), i64(3600), u64(250_000_000)]),
  })]));

  // 3b. Fees on the rollup come out of an escrow held by the fee payer. Index
  // 255 is pinned rather than defaulted, because the PDA helper and the
  // instruction default it separately and a mismatch funds the wrong account.
  const escrow = escrowPdaFromEscrowAuthority(owner.publicKey, 255);
  const escrowInfo = await base.getAccountInfo(escrow);
  if (!escrowInfo || escrowInfo.lamports < 20_000_000) {
    await step("top up fee escrow", () => send(base, [
      createTopUpEscrowInstruction(escrow, owner.publicKey, owner.publicKey, 50_000_000, 255),
    ]));
  } else {
    console.log(`  fee escrow                         ${escrowInfo.lamports / 1e9} SOL`);
  }

  // 4. Hand it to the enclave.
  const bufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(vault, PROGRAM_ID);
  const record = delegationRecordPdaFromDelegatedAccount(vault);
  const metadata = delegationMetadataPdaFromDelegatedAccount(vault);
  if (!preDelegated) await step("delegate_vault to the TDX node", () => send(base, [new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(bufferPda, false, true),
      meta(record, false, true),
      meta(metadata, false, true),
      meta(vault, false, true),
      meta(PROGRAM_ID, false, false),
      meta(DELEGATION_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: disc("delegate_vault"),
  })]));

  // 5. Seal it. This runs on the rollup, not on base.
  er = await freshEr();
  await step("seal_vault (inside the enclave)", () => send(er, [new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(vault, false, true),
      meta(permission, false, true),
      meta(EPHEMERAL_VAULT_ID, false, true),
      meta(MAGIC_PROGRAM_ID, false, false),
      meta(PERMISSION_PROGRAM_ID, false, false),
    ],
    data: disc("seal_vault"),
  })]));

  // 6. Read it back from the rollup.
  const inEr = await step("read vault from the rollup", () => er.getAccountInfo(vault));
  console.log(`     rollup sees ${inEr ? inEr.data.length + " bytes" : "nothing"}`);

  // 7. Settle back to base.
  er = await freshEr();
  await step("release_vault (commit+undelegate)", () => send(er, [new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(vault, false, true),
      meta(MAGIC_CONTEXT_ID, false, true),
      meta(MAGIC_PROGRAM_ID, false, false),
    ],
    data: disc("release_vault"),
  })]));

  const onBase = await step("read vault from base", () => base.getAccountInfo(vault));
  console.log(`     base owner is ${onBase ? onBase.owner.toBase58() : "gone"}`);

  console.log("\n  timings");
  for (const t of times) console.log(`  ${t.label.padEnd(34)} ${String(t.ms).padStart(6)}ms`);
}

main().catch((e) => {
  console.error("\nround trip failed:", e.message);
  if (e.logs) console.error(e.logs.slice(-12).join("\n"));
  process.exit(1);
});
