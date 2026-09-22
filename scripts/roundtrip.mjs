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
  ConnectionMagicRouter,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const ER_URL = "https://devnet-tee.magicblock.app";
const ROUTER_URL = "https://devnet-router.magicblock.app";

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

// FRESH=1 runs the whole sequence against a brand new owner, which is the only
// way to exercise the ordering: a vault has to be funded before it is delegated,
// because once delegated its balance lives in the rollup and stops tracking base.
function ownerKeypair() {
  const funder = loadWallet();
  if (!process.env.FRESH) return { owner: funder, funder: null };
  const p = new URL("./.fresh-owner.json", import.meta.url);
  let owner;
  try {
    owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  } catch {
    owner = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(owner.secretKey)));
  }
  return { owner, funder };
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

/**
 * Retry a network step.
 *
 * The attestation check is a fetch to someone else's host, and a fetch to
 * someone else's host fails sometimes. This machine resolves IPv6 first
 * and stalls for about six seconds before falling back, so the first
 * attempt times out while the second one succeeds. Failing the whole round
 * trip because of that would be reporting the network rather than the
 * system under test.
 */
async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw last;
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
    console.log(`    ${err.message}${err.cause ? '  cause: ' + (err.cause.code || err.cause.message) : ''}`);
    throw err;
  }
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)}ms`);
  return out;
}

async function main() {
  const { owner, funder } = ownerKeypair();
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

  // Preflight on the rollup reports a rent shortfall inside a CPI as "this
  // account may not be used to pay transaction fees", which sent me a long way
  // in the wrong direction. Skip it there and read the real error from the logs.
  const send = (conn, ixs, signers = [owner], skipPreflight = false) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    return sendAndConfirmTransaction(conn, tx, signers, {
      commitment: "confirmed", skipPreflight,
    });
  };

  if (funder) {
    const bal = await base.getBalance(owner.publicKey);
    if (bal < 200_000_000) {
      await step("fund the fresh owner", () => {
        const tx = new Transaction().add(SystemProgram.transfer({
          fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 400_000_000,
        }));
        tx.feePayer = funder.publicKey;
        return sendAndConfirmTransaction(base, tx, [funder], { commitment: "confirmed" });
      });
    } else {
      console.log(`  fresh owner balance                ${bal / 1e9} SOL`);
    }
  }

  // 0. The attestation. Without this the rest is just a fast rollup.
  await step("verify TDX attestation", () => withRetry(() => verifyTeeRpcIntegrity(ER_URL)));

  // 0b. Session auth. A private rollup will not take traffic from an unproven
  // identity, so every request carries a token signed by the owner's key. This
  // is also the first half of why the operator cannot simply read the account:
  // it has to be somebody, and being somebody is what the member flags gate.
  const signCb = async (msg) => nacl.sign.detached(msg, owner.secretKey);
  const freshEr = async () => {
    const { token } = await getAuthToken(ER_URL, owner.publicKey, signCb);
    return new Connection(`${ER_URL}?token=${token}`, "confirmed");
  };
  const router = new ConnectionMagicRouter(ROUTER_URL, "confirmed");
  const viaRouter = async (ixs, signers = [owner]) => {
    let tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    tx = await router.prepareTransaction(tx);
    return router.sendAndConfirmTransaction(tx, signers, { commitment: "confirmed" });
  };
  await step("session auth", () => withRetry(async () => { er = await freshEr(); }));

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
      data: Buffer.concat([disc("create_mandate"), u16(0), str(text), u16(1500), u16(500), vecPubkey([])]),
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
      data: Buffer.concat([disc("open_vault"), u16(0)]),
    })]));
  } else {
    console.log("  open_vault                         exists, skipped");
  }

  // The vault sponsors its own ephemeral permission inside the rollup, so it
  // needs headroom above its rent exempt minimum. This has to happen before
  // delegation: afterwards the rollup holds the balance and base transfers no
  // longer reach it.
  const vaultBase = await base.getAccountInfo(vault);
  if (vaultBase && !vaultBase.owner.equals(DELEGATION_PROGRAM_ID) && vaultBase.lamports < 5_000_000) {
    await step("fund the vault (before delegating)", () => send(base, [
      SystemProgram.transfer({
        fromPubkey: owner.publicKey, toPubkey: vault, lamports: 10_000_000,
      }),
    ]));
  }

  // A vault left delegated by an earlier run can be short inside the rollup
  // even while base still shows a healthy number, because after delegation
  // the rollup balance is the authoritative one and base transfers stop
  // reaching it. That state cannot fund its own permission account, and the
  // failure arrives much later as InsufficientFundsForRent on an account
  // index rather than as anything that names the vault.
  //
  // So check the balance that actually matters and undo the delegation if it
  // is short. Releasing brings the balance home, and the funding step above
  // then applies on the next pass.
  {
    const delegatedNow = (await base.getAccountInfo(vault))?.owner.equals(DELEGATION_PROGRAM_ID);
    if (delegatedNow) {
      const peek = new Connection(ER_URL, "confirmed");
      const inRollup = await peek.getAccountInfo(vault).catch(() => null);
      if (inRollup && inRollup.lamports < 5_000_000) {
        console.log(
          `  vault holds ${inRollup.lamports} in the rollup, too little to sponsor its permission`,
        );
        const tok = await withRetry(() =>
          getAuthToken(ER_URL, owner.publicKey, signCb),
        );
        const tmpEr = new Connection(`${ER_URL}?token=${tok.token}`, "confirmed");
        await step("release the underfunded vault first", () =>
          send(tmpEr, [new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
              meta(owner.publicKey, true, true),
              meta(vault, false, true),
              meta(MAGIC_CONTEXT_ID, false, true),
              meta(MAGIC_PROGRAM_ID, false, false),
            ],
            data: Buffer.concat([disc("release_vault"), u16(0)]),
          })], [owner], true),
        );
        await new Promise((r) => setTimeout(r, 4000));
        await step("fund it now that base owns it again", () => send(base, [
          SystemProgram.transfer({
            fromPubkey: owner.publicKey, toPubkey: vault, lamports: 12_000_000,
          }),
        ]));
      }
    }
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
    data: Buffer.concat([disc("set_agent"), u16(0), agent.publicKey.toBuffer(), i64(3600), u64(250_000_000)]),
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
    data: Buffer.concat([disc("delegate_vault"), u16(0)]),
  })]));

  // 5. Seal it. This runs on the rollup, not on base.
  //
  // Delegation is not instant from the rollup's point of view. The account
  // has to be picked up before it can be written there, and a transaction
  // sent into that window comes back InvalidWritableAccount, which names
  // nothing useful. Wait for the rollup to admit it owns the vault rather
  // than guessing at a delay.
  er = await freshEr();
  await step("wait for the rollup to take the vault", async () => {
    for (let i = 0; i < 20; i++) {
      const seen = await er.getAccountInfo(vault).catch(() => null);
      if (seen && seen.lamports > 0) return `visible with ${seen.lamports} lamports`;
      await new Promise((r) => setTimeout(r, 1000));
      er = await freshEr();
    }
    throw new Error("the rollup never picked the vault up");
  });

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
    data: Buffer.concat([disc("seal_vault"), u16(0)]),
  })], [owner], true));

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
    data: Buffer.concat([disc("release_vault"), u16(0)]),
  })], [owner], true));

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
