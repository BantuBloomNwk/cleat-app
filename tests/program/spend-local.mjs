// The agent's allowance, on a local validator. No devnet, nothing deployed.
//
// Two fixes are checked here:
//   1. A refused payment is recorded. It used to return an error, which rolled back every change,
//      so the refusal count could never rise. Now the transaction succeeds, nothing moves, the count
//      goes up, and the return data says 0 (refused) rather than 1 (paid).
//   2. The allowance works in a token (USDC is what agents pay with under x402): open, pay under the
//      ceiling, refuse over it, refuse a stranger, refuse the wrong token, let only the owner take
//      tokens back, and close with every token returned.
//
//   node tests/program/spend-local.mjs      (CLEAT_SO overrides the program binary)

import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, transfer, getAccount } from '@solana/spl-token';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROGRAM = new PublicKey('2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL');
const SO = process.env.CLEAT_SO || new URL('../../target/deploy/cleat.so', import.meta.url).pathname;
const RPC_PORT = 18939;
const HOUR = 3600;

const sha = (s) => createHash('sha256').update(s).digest();
const disc = (n) => sha(`global:${n}`).subarray(0, 8);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const indexSeed = (i) => (i === 0 ? Buffer.alloc(0) : u16(i));
const m = (pubkey, w = false, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const ix = (name, keys, data) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), data]) });

let pass = 0, fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); ok ? pass++ : fail++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleat-spend-'));
const v = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', path.join(dir, 'ledger'), '--rpc-port', String(RPC_PORT),
  '--faucet-port', String(RPC_PORT + 2), '--bpf-program', PROGRAM.toBase58(), SO], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-v.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
const conn = new Connection(`http://127.0.0.1:${RPC_PORT}`, 'confirmed');
for (let i = 0; ; i++) {
  try { await conn.getLatestBlockhash(); break; } catch { if (i > 120) throw new Error('validator never came up'); await new Promise((r) => setTimeout(r, 500)); }
}
const owner = Keypair.generate(), agent = Keypair.generate(), stranger = Keypair.generate(), payee = Keypair.generate();
for (const k of [owner, agent, stranger]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed');

// A fresh blockhash and a unique compute limit per transaction, so retries are never byte-identical.
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
  return { sig, returned: rd ? Buffer.from(rd, 'base64')[0] : null };
}
async function refused(label, instr, signers, want) {
  try { await send(instr, signers); check(label, false); }
  catch (e) { const logs = (e.logs || []).join('\n') + String(e.message); check(label, want ? logs.includes(want) : true); }
}

console.log('\nThe allowance in SOL, refusals now recorded:');
const [spend] = PublicKey.findProgramAddressSync([Buffer.from('spend'), owner.publicKey.toBuffer(), indexSeed(0)], PROGRAM);
await send(ix('open_spend_account', [m(owner.publicKey, true, true), m(spend, true), m(SystemProgram.programId)],
  Buffer.concat([u16(0), agent.publicKey.toBuffer(), u64(0.01 * LAMPORTS_PER_SOL), i64(HOUR)])), [owner]);
await send(ix('fund_spend_account', [m(owner.publicKey, true, true), m(spend, true), m(SystemProgram.programId)],
  Buffer.concat([u16(0), u64(0.1 * LAMPORTS_PER_SOL)])), [owner]);
const paySol = (lamports, who = agent) => ix('pay_agent_cost', [m(who.publicKey, false, true), m(spend, true), m(payee.publicKey, true)],
  Buffer.concat([u16(0), u64(lamports), Buffer.from([1])]));
const refusalsSol = async () => (await conn.getAccountInfo(spend)).data.readUInt32LE(8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 4);
const a = await send(paySol(0.004 * LAMPORTS_PER_SOL), [agent]);
check('a payment under the ceiling goes through and returns 1 (paid)', a.returned === 1 && (await conn.getBalance(payee.publicKey)) === 0.004 * LAMPORTS_PER_SOL);
const b = await send(paySol(0.009 * LAMPORTS_PER_SOL), [agent]);
check('one over the ceiling succeeds as a transaction but returns 0 (refused)', b.returned === 0);
check('nothing moved', (await conn.getBalance(payee.publicKey)) === 0.004 * LAMPORTS_PER_SOL);
check('and the refusal count actually rose (it was stuck at 0 before)', (await refusalsSol()) === 1);
await refused('a stranger cannot pay out of it', paySol(1000, stranger), [stranger], 'NotTheAgent');

console.log('\nThe allowance in USDC:');
const usdc = await createMint(conn, owner, owner.publicKey, null, 6);
const ownerTok = await getOrCreateAssociatedTokenAccount(conn, owner, usdc, owner.publicKey);
await mintTo(conn, owner, usdc, ownerTok.address, owner, 100_000_000);
const payeeTok = await getOrCreateAssociatedTokenAccount(conn, owner, usdc, payee.publicKey);
const other = await createMint(conn, owner, owner.publicKey, null, 6);
const payeeOther = await getOrCreateAssociatedTokenAccount(conn, owner, other, payee.publicKey);
const [tspend] = PublicKey.findProgramAddressSync([Buffer.from('spend_token'), owner.publicKey.toBuffer(), usdc.toBuffer(), indexSeed(0)], PROGRAM);
const vault = getAssociatedTokenAddressSync(usdc, tspend, true);
await send(ix('open_token_spend', [m(owner.publicKey, true, true), m(usdc), m(tspend, true), m(vault, true), m(TOKEN_PROGRAM_ID), m(ASSOCIATED_TOKEN_PROGRAM_ID), m(SystemProgram.programId)],
  Buffer.concat([u16(0), agent.publicKey.toBuffer(), u64(5_000_000), i64(HOUR)])), [owner]);
check('the owner opens a $5-an-hour USDC allowance with its own vault', !!(await conn.getAccountInfo(tspend)) && (await getAccount(conn, vault)).owner.equals(tspend));
await transfer(conn, owner, ownerTok.address, vault, owner, 20_000_000);
check('anyone can fund it by sending USDC to the vault', (await getAccount(conn, vault)).amount === 20_000_000n);
const payTok = (amount, who = agent, to = payeeTok.address) => ix('pay_agent_token',
  [m(who.publicKey, false, true), m(tspend, true), m(usdc), m(vault, true), m(to, true), m(TOKEN_PROGRAM_ID)], Buffer.concat([u16(0), u64(amount), Buffer.from([2])]));
const refusalsTok = async () => (await conn.getAccountInfo(tspend)).data.readUInt32LE(8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 4);
const c = await send(payTok(3_000_000), [agent]);
check('the agent pays $3 for a call, returns 1 (paid)', c.returned === 1 && (await getAccount(conn, payeeTok.address)).amount === 3_000_000n);
const d = await send(payTok(2_500_000), [agent]);
check('$2.50 more would pass the $5 ceiling: refused, returns 0', d.returned === 0 && (await getAccount(conn, payeeTok.address)).amount === 3_000_000n);
check('the refusal is on record', (await refusalsTok()) === 1);
await refused('a stranger cannot pay out of it', payTok(1, stranger), [stranger], 'NotTheAgent');
await refused('it cannot pay into an account for a different token', payTok(1, agent, payeeOther.address), [agent]);
const withdraw = (amount, who = owner, to = ownerTok.address) => ix('withdraw_token_spend',
  [m(who.publicKey, false, true), m(tspend), m(usdc), m(vault, true), m(to, true), m(TOKEN_PROGRAM_ID)], Buffer.concat([u16(0), u64(amount)]));
await refused('only the owner can take tokens back', withdraw(1, stranger), [stranger]);
const before = (await getAccount(conn, ownerTok.address)).amount;
await send(withdraw(4_000_000), [owner]);
check('the owner takes $4 back to her own account', (await getAccount(conn, ownerTok.address)).amount - before === 4_000_000n);
await send(ix('close_token_spend', [m(owner.publicKey, true, true), m(tspend, true), m(usdc), m(vault, true), m(ownerTok.address, true), m(TOKEN_PROGRAM_ID)], u16(0)), [owner]);
check('closing returns every token and removes the vault and the allowance',
  (await getAccount(conn, ownerTok.address)).amount === 100_000_000n - 3_000_000n && !(await conn.getAccountInfo(vault)) && !(await conn.getAccountInfo(tspend)));

console.log(`\n${pass} passed, ${fail} failed`);
stop();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
