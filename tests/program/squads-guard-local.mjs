// The Squads guard, on a local validator running the real Squads v4 binary. No devnet, nothing deployed.
//
// Squads already caps what a spending-limit member can take. What it cannot do is keep a refusal: an
// over-limit use is an error and an error rolls back. The guard sits on the limit as its member, the
// agent pays through it, and every no is counted with a reason and no amount. Checked here:
//   the guard is useless until the multisig puts it on the limit; a payment inside the limit moves money
//   through Squads; over the limit, to an unlisted destination, or while paused, the transaction succeeds,
//   nothing moves and the refusal is counted; the refusal event carries no amount; strangers and the bare
//   agent key get nothing; the same for a USDC limit; only the authority can pause or close.
//
//   SQUADS_SO=~/session-carry/squads-v4/squads-devnet.so node tests/program/squads-guard-local.mjs
//   (SQUADS_SO=.../squads-mainnet.so for the mainnet binary; CLEAT_SO overrides the program binary;
//    SQUADS_CONFIG is the program config account dumped as JSON)

import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROGRAM = new PublicKey('2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL');
const SQUADS = multisig.PROGRAM_ID;
const SO = process.env.CLEAT_SO || new URL('../../target/deploy/cleat.so', import.meta.url).pathname;
const CARRY = path.join(os.homedir(), 'session-carry/squads-v4');
const SQUADS_SO = process.env.SQUADS_SO || path.join(CARRY, 'squads-devnet.so');
const SQUADS_CONFIG = process.env.SQUADS_CONFIG || path.join(CARRY, 'program-config.json');
const RPC_PORT = 18949;
const { Period, Permissions } = multisig.types;

const sha = (s) => createHash('sha256').update(s).digest();
const disc = (n) => sha(`global:${n}`).subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const m = (pubkey, w = false, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const ix = (name, keys, data = Buffer.alloc(0)) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), data]) });

let pass = 0, fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); ok ? pass++ : fail++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleat-squads-'));
const configPda = multisig.getProgramConfigPda({})[0];
const v = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', path.join(dir, 'ledger'), '--rpc-port', String(RPC_PORT),
  '--faucet-port', String(RPC_PORT + 2), '--bpf-program', PROGRAM.toBase58(), SO, '--bpf-program', SQUADS.toBase58(), SQUADS_SO,
  '--account', configPda.toBase58(), SQUADS_CONFIG], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-v.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
const conn = new Connection(`http://127.0.0.1:${RPC_PORT}`, 'confirmed');
for (let i = 0; ; i++) {
  try { await conn.getLatestBlockhash(); break; } catch { if (i > 120) throw new Error('validator never came up'); await new Promise((r) => setTimeout(r, 500)); }
}
console.log(`Squads binary: ${path.basename(SQUADS_SO)}`);

const owner = Keypair.generate(), agent = Keypair.generate(), stranger = Keypair.generate();
const shop = Keypair.generate().publicKey, elsewhere = Keypair.generate().publicKey;
for (const k of [owner, agent, stranger]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL), 'confirmed');

let nth = 0;
async function send(instr, signers) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 + ++nth })).add(instr);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (r.value.err) throw new Error(JSON.stringify(r.value.err));
  const got = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const rd = got?.meta?.returnData?.data?.[0];
  return { sig, returned: rd ? Buffer.from(rd, 'base64')[0] : null, logs: got?.meta?.logMessages || [] };
}
async function refused(label, instr, signers, want) {
  try { await send(instr, signers); check(label, false); }
  catch (e) { const logs = (e.logs || []).join('\n') + String(e.message); check(label, want ? logs.includes(want) : true); }
}

// A multisig the owner controls directly (a config authority), so the test can add a spending limit
// without a vote. A real multisig votes the same AddSpendingLimit through a config transaction.
const createKey = Keypair.generate();
const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, configPda);
await send(multisig.instructions.multisigCreateV2({
  treasury: programConfig.treasury, creator: owner.publicKey, multisigPda: msPda, configAuthority: owner.publicKey,
  threshold: 1, members: [{ key: owner.publicKey, permissions: Permissions.all() }], timeLock: 0,
  createKey: createKey.publicKey, rentCollector: null,
}), [owner, createKey]);
await send(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: vault, lamports: 5 * LAMPORTS_PER_SOL }), [owner]);

const guardOf = (limit, who) => PublicKey.findProgramAddressSync([Buffer.from('squads_guard'), limit.toBuffer(), who.toBuffer()], PROGRAM)[0];
const limitKey = Keypair.generate().publicKey;
const [limit] = multisig.getSpendingLimitPda({ multisigPda: msPda, createKey: limitKey });
const guard = guardOf(limit, agent.publicKey);

const addLimit = (lim, createKey, mint, amount, members, destinations) => send(multisig.instructions.multisigAddSpendingLimit({
  multisigPda: msPda, configAuthority: owner.publicKey, spendingLimit: lim, rentPayer: owner.publicKey, createKey,
  vaultIndex: 0, mint, amount: BigInt(amount), period: Period.Day, members, destinations,
}), [owner]);

const open = (lim, g, who = agent.publicKey) => ix('open_squads_guard',
  [m(owner.publicKey, true, true), m(owner.publicKey, false, true), m(lim), m(g, true), m(who), m(SystemProgram.programId)]);
const paySol = (lamports, to = shop, signer = agent, g = guard) => ix('squads_guard_pay', [
  m(signer.publicKey, false, true), m(g, true), m(msPda), m(limit, true), m(vault, true), m(to, true),
  m(SystemProgram.programId), m(SQUADS), m(SQUADS, true), m(SQUADS, true), m(SQUADS), m(SQUADS),
], Buffer.concat([u64(lamports), Buffer.from([9])]));
const readGuard = async (g = guard) => {
  const d = (await conn.getAccountInfo(g)).data; const o = 8 + 32 * 4;
  return { paused: d[o] === 1, payments: d.readUInt32LE(o + 1), refusals: d.readUInt32LE(o + 5) };
};
const refusalEvent = (logs) => {
  const want = sha('event:SquadsGuardRefused').subarray(0, 8);
  for (const l of logs) {
    if (!l.startsWith('Program data: ')) continue;
    const b = Buffer.from(l.slice(14), 'base64');
    if (b.subarray(0, 8).equals(want)) return b.subarray(8);
  }
  return null;
};

console.log('\nA SOL limit, 1 SOL a day, only to the shop:');
// The limit is created first here so the guard can read which multisig it belongs to. The guard's
// address is known in advance, so it goes on the limit as its member from the start.
await addLimit(limit, limitKey, PublicKey.default, LAMPORTS_PER_SOL, [guard], [shop]);
await send(open(limit, guard), [owner]);
check('the guard opens against the limit and points at its multisig', (await readGuard()).refusals === 0);

const lonelyKey = Keypair.generate().publicKey;
const [lonely] = multisig.getSpendingLimitPda({ multisigPda: msPda, createKey: lonelyKey });
await addLimit(lonely, lonelyKey, PublicKey.default, LAMPORTS_PER_SOL, [owner.publicKey], []);
const lonelyGuard = guardOf(lonely, agent.publicKey);
await send(open(lonely, lonelyGuard), [owner]);
await refused('a guard the multisig never put on the limit can do nothing (GuardNotOnLimit)', ix('squads_guard_pay', [
  m(agent.publicKey, false, true), m(lonelyGuard, true), m(msPda), m(lonely, true), m(vault, true), m(shop, true),
  m(SystemProgram.programId), m(SQUADS), m(SQUADS, true), m(SQUADS, true), m(SQUADS), m(SQUADS),
], Buffer.concat([u64(1000), Buffer.from([9])])), [agent], 'GuardNotOnLimit');

let r = await send(paySol(0.4 * LAMPORTS_PER_SOL), [agent]);
check('0.4 SOL to the shop goes through Squads and returns 1 (paid)', r.returned === 1 && (await conn.getBalance(shop)) === 0.4 * LAMPORTS_PER_SOL);

const vaultBefore = await conn.getBalance(vault);
r = await send(paySol(0.7 * LAMPORTS_PER_SOL), [agent]);
const ev = refusalEvent(r.logs);
check('0.7 SOL more would pass the day\'s 1 SOL: succeeds as a transaction, returns 0 (refused)', r.returned === 0);
check('nothing moved', (await conn.getBalance(vault)) === vaultBefore && (await conn.getBalance(shop)) === 0.4 * LAMPORTS_PER_SOL);
check('the refusal is counted', (await readGuard()).refusals === 1);
check('the refusal event says "over the limit" and carries no amount (32 + 1 + 4 bytes)', ev && ev.length === 37 && ev[32] === 3);

r = await send(paySol(1000, elsewhere), [agent]);
check('paying anyone but the shop is refused and counted, reason "destination"', r.returned === 0 && refusalEvent(r.logs)?.[32] === 2 && (await readGuard()).refusals === 2);

await refused('a stranger cannot pay through the guard', paySol(1000, shop, stranger), [stranger]);
await refused('the agent\'s own key is not on the limit, so it gets nothing from Squads directly', multisig.instructions.spendingLimitUse({
  multisigPda: msPda, member: agent.publicKey, spendingLimit: limit, mint: undefined, vaultIndex: 0, amount: 1000, decimals: 9,
  destination: shop, tokenProgram: undefined,
}), [agent]);

await refused('only the authority can pause the guard', ix('set_squads_guard_paused', [m(stranger.publicKey, false, true), m(guard, true)], Buffer.from([1])), [stranger]);
await send(ix('set_squads_guard_paused', [m(owner.publicKey, false, true), m(guard, true)], Buffer.from([1])), [owner]);
r = await send(paySol(1000), [agent]);
check('while paused, even a small payment is refused and counted, reason "paused"', r.returned === 0 && refusalEvent(r.logs)?.[32] === 1 && (await readGuard()).refusals === 3);
await send(ix('set_squads_guard_paused', [m(owner.publicKey, false, true), m(guard, true)], Buffer.from([0])), [owner]);
r = await send(paySol(0.1 * LAMPORTS_PER_SOL), [agent]);
check('resumed, 0.1 SOL goes through', r.returned === 1 && (await conn.getBalance(shop)) === 0.5 * LAMPORTS_PER_SOL && (await readGuard()).payments === 2);

console.log('\nA USDC limit, $5 a day, to anyone:');
const usdc = await createMint(conn, owner, owner.publicKey, null, 6);
const vaultTok = await getOrCreateAssociatedTokenAccount(conn, owner, usdc, vault, true);
await mintTo(conn, owner, usdc, vaultTok.address, owner, 100_000_000);
const seller = Keypair.generate().publicKey;
const sellerTok = await getOrCreateAssociatedTokenAccount(conn, owner, usdc, seller);
const tKey = Keypair.generate().publicKey;
const [tLimit] = multisig.getSpendingLimitPda({ multisigPda: msPda, createKey: tKey });
const tGuard = guardOf(tLimit, agent.publicKey);
await addLimit(tLimit, tKey, usdc, 5_000_000, [tGuard], []);
await send(open(tLimit, tGuard), [owner]);
const payTok = (amount) => ix('squads_guard_pay', [
  m(agent.publicKey, false, true), m(tGuard, true), m(msPda), m(tLimit, true), m(vault, true), m(seller, true),
  m(SystemProgram.programId), m(usdc), m(vaultTok.address, true), m(sellerTok.address, true), m(TOKEN_PROGRAM_ID), m(SQUADS),
], Buffer.concat([u64(amount), Buffer.from([6])]));
r = await send(payTok(3_000_000), [agent]);
check('the agent pays $3, returns 1 (paid)', r.returned === 1 && (await getAccount(conn, sellerTok.address)).amount === 3_000_000n);
r = await send(payTok(2_500_000), [agent]);
check('$2.50 more is refused and counted, nothing moved', r.returned === 0 && (await getAccount(conn, sellerTok.address)).amount === 3_000_000n && (await readGuard(tGuard)).refusals === 1);

console.log('\nClosing:');
await refused('only the authority can close the guard', ix('close_squads_guard', [m(stranger.publicKey, true, true), m(guard, true)]), [stranger]);
await send(ix('close_squads_guard', [m(owner.publicKey, true, true), m(guard, true)]), [owner]);
check('the authority closes it and the agent\'s route is gone', !(await conn.getAccountInfo(guard)));
await refused('a closed guard pays nothing', paySol(1000), [agent]);

console.log(`\n${pass} passed, ${fail} failed`);
stop();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
