#!/usr/bin/env node
// The upgrade authority, held by more than one person.
//
// Today the program's upgrade authority is one key on one laptop. Whoever
// holds it can replace the binary and drain every vault, and no amount of
// correct code in the deployed program changes that. It also makes the
// product's own claim untrue: you cannot tell somebody they do not have to
// trust the agent while a single key can rewrite the sentence the agent is
// bounded by.
//
// Squads v4 is the multisig, because it is the one everything else on Solana
// already uses and it is deployed on devnet as well as mainnet, so the
// procedure can be rehearsed where a mistake costs nothing.
//
// The order matters and is not obvious. Handing the authority to a vault
// that turns out to be unable to act would leave the program running its
// current binary for ever with no way to upgrade it. So `rehearse` does the
// whole round trip on a throwaway program first: hand it over, have the
// vault hand it back, and only then do the same thing to something that
// matters.
//
//   node scripts/msig.mjs create 2 <pubkey,pubkey,pubkey>
//   node scripts/msig.mjs show <multisigPda>
//   node scripts/msig.mjs vault-setauth <multisigPda> <programId> <newAuthority>
//   node scripts/msig.mjs rehearse <multisigPda> <throwawayProgramId>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

const { Permissions } = multisig.types;

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC) {
  console.error(
    "Set SOLANA_RPC_URL. Never the public endpoint: it silently truncates\n" +
    "paginated reads, which is the worst failure mode a chain read has.",
  );
  process.exit(1);
}
const connection = new Connection(RPC, "confirmed");

const walletPath = process.env.SOLANA_KEYPAIR
  ?? path.join(os.homedir(), ".config/solana/id.json");
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))),
);

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** Where the loader keeps a program's authority and its bytes. */
const programDataOf = (programId) =>
  PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER)[0];

/**
 * SetAuthority on the upgradeable loader, instruction 4.
 *
 * Not SetAuthorityChecked, which is instruction 7 and makes the incoming
 * authority sign as well. That is the safer one between two wallets and the
 * wrong one here: the incoming authority is a program derived address, which
 * cannot sign anything except from inside a CPI it is not part of yet.
 */
const setAuthorityIx = (programId, current, next) =>
  new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: programDataOf(programId), isSigner: false, isWritable: true },
      { pubkey: current, isSigner: true, isWritable: false },
      { pubkey: next, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.of(4, 0, 0, 0)),
  });

async function readAuthority(programId) {
  const info = await connection.getAccountInfo(programDataOf(programId));
  if (!info) return null;
  // ProgramData: 4 byte tag, 8 byte slot, 1 byte option, then the pubkey.
  const has = info.data[12] === 1;
  return has ? new PublicKey(info.data.subarray(13, 45)) : null;
}

async function create(threshold, memberKeys) {
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig =
    await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);

  const members = memberKeys.map((k) => ({
    key: new PublicKey(k),
    // Everyone can propose, vote and execute. Splitting those is a refinement
    // for a bigger group; with three people it only creates a way to be
    // locked out by whoever happens to be asleep.
    permissions: Permissions.all(),
  }));

  const sig = await multisig.rpc.multisigCreateV2({
    connection,
    createKey,
    creator: wallet,
    multisigPda,
    configAuthority: null, // nobody can change the members without a vote
    timeLock: 0,
    members,
    threshold,
    treasury: programConfig.treasury,
    rentCollector: null,
    sendOptions: { skipPreflight: false },
  });
  await connection.confirmTransaction(sig, "confirmed");

  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  console.log("multisig   :", multisigPda.toBase58());
  console.log("vault (0)  :", vaultPda.toBase58(), " <- this becomes the upgrade authority");
  console.log("threshold  :", `${threshold} of ${members.length}`);
  console.log("members    :", members.map((m) => m.key.toBase58()).join("\n             "));
  console.log("signature  :", sig);
  return { multisigPda, vaultPda };
}

async function show(multisigPdaStr) {
  const multisigPda = new PublicKey(multisigPdaStr);
  const acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  console.log("multisig   :", multisigPda.toBase58());
  console.log("vault (0)  :", vaultPda.toBase58());
  console.log("threshold  :", `${acct.threshold} of ${acct.members.length}`);
  console.log("members    :", acct.members.map((m) => m.key.toBase58()).join("\n             "));
  console.log("tx index   :", acct.transactionIndex.toString());
  console.log("config auth:", acct.configAuthority.toBase58(),
    acct.configAuthority.equals(PublicKey.default) ? "(none, so members can only change by vote)" : "(SET: this key can change the members alone)");
}

/** Propose, approve and run one instruction as the vault. */
async function runAsVault(multisigPda, ix, memo) {
  const acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(Number(acct.transactionIndex) + 1);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const { blockhash } = await connection.getLatestBlockhash();
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [ix],
  });

  let sig = await multisig.rpc.vaultTransactionCreate({
    connection, feePayer: wallet, multisigPda, transactionIndex,
    creator: wallet.publicKey, vaultIndex: 0, ephemeralSigners: 0,
    transactionMessage, memo,
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  proposed  ", sig);

  sig = await multisig.rpc.proposalCreate({
    connection, feePayer: wallet, multisigPda, transactionIndex, creator: wallet,
  });
  await connection.confirmTransaction(sig, "confirmed");

  sig = await multisig.rpc.proposalApprove({
    connection, feePayer: wallet, multisigPda, transactionIndex, member: wallet,
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  approved  ", sig);

  const proposalPda = multisig.getProposalPda({ multisigPda, transactionIndex })[0];
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  const status = proposal.status.__kind;
  if (status !== "Approved") {
    console.log(`  not executing: proposal is ${status}, it needs more approvals`);
    console.log(`  transaction index ${transactionIndex}, waiting for the other members`);
    return { executed: false, transactionIndex };
  }

  sig = await multisig.rpc.vaultTransactionExecute({
    connection, feePayer: wallet, multisigPda, transactionIndex,
    member: wallet.publicKey, signers: [wallet],
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  executed  ", sig);
  return { executed: true, transactionIndex };
}

async function vaultSetAuth(multisigPdaStr, programIdStr, nextStr) {
  const multisigPda = new PublicKey(multisigPdaStr);
  const programId = new PublicKey(programIdStr);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const current = await readAuthority(programId);
  if (!current) throw new Error("that program has no upgrade authority, it is frozen");
  if (!current.equals(vaultPda)) {
    throw new Error(
      `the vault does not hold this program's authority.\n` +
      `  authority is ${current.toBase58()}\n  vault is     ${vaultPda.toBase58()}`,
    );
  }
  const ix = setAuthorityIx(programId, vaultPda, new PublicKey(nextStr));
  await runAsVault(multisigPda, ix, `set upgrade authority of ${programId.toBase58()}`);
  console.log("authority now:", (await readAuthority(programId))?.toBase58());
}

/**
 * The dress rehearsal.
 *
 * Hand a program nobody cares about to the vault, have the vault hand it
 * straight back, and read the authority at every step. If the second half
 * fails, it fails on a throwaway rather than on the thing holding money.
 */
async function rehearse(multisigPdaStr, programIdStr) {
  const multisigPda = new PublicKey(multisigPdaStr);
  const programId = new PublicKey(programIdStr);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const before = await readAuthority(programId);
  console.log("start      :", before?.toBase58());
  if (!before?.equals(wallet.publicKey)) {
    throw new Error("this wallet does not hold that program's authority, nothing to rehearse");
  }

  console.log("\nhanding it to the vault");
  const { sendAndConfirmTransaction, Transaction } = await import("@solana/web3.js");
  const give = new Transaction().add(setAuthorityIx(programId, wallet.publicKey, vaultPda));
  const s1 = await sendAndConfirmTransaction(connection, give, [wallet], { commitment: "confirmed" });
  console.log("  ", s1);
  console.log("authority  :", (await readAuthority(programId))?.toBase58());

  console.log("\nasking the vault to hand it back");
  await runAsVault(multisigPda, setAuthorityIx(programId, vaultPda, wallet.publicKey),
    "rehearsal: hand it back");

  const after = await readAuthority(programId);
  console.log("\nend        :", after?.toBase58());
  console.log(after?.equals(wallet.publicKey)
    ? "ROUND TRIP OK. The vault can act on the loader, so the real handover is safe."
    : "ROUND TRIP FAILED. Do not hand over the real program.");
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "create") await create(Number(rest[0]), rest[1].split(","));
  else if (cmd === "show") await show(rest[0]);
  else if (cmd === "vault-setauth") await vaultSetAuth(rest[0], rest[1], rest[2]);
  else if (cmd === "rehearse") await rehearse(rest[0], rest[1]);
  else {
    console.log("commands: create <threshold> <pubkeys,comma,separated>");
    console.log("          show <multisigPda>");
    console.log("          vault-setauth <multisigPda> <programId> <newAuthority>");
    console.log("          rehearse <multisigPda> <throwawayProgramId>");
    process.exit(1);
  }
} catch (e) {
  console.error("failed:", e.message);
  process.exit(1);
}
