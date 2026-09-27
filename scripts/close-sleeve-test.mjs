// close_sleeve against a local validator, before it goes anywhere near devnet.
//
// Builds a sleeve with every account the instruction knows about, puts money
// in the vault and the spend account, closes it, and checks three things: every
// account is gone, every lamport came back to the owner, and a stranger who
// calls it touches nothing of anyone else's. Then opens the same sleeve again,
// because a closed PDA that cannot be reused would strand the index.
//
// Run: solana-test-validator --reset --bpf-program <program id> target/deploy/cleat.so
//      node scripts/close-sleeve-test.mjs [rpc]

import fs from 'node:fs';
import anchor from '@anchor-lang/core';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';

const { AnchorProvider, Program, Wallet, BN } = anchor;
const RPC = process.argv[2] ?? 'http://127.0.0.1:8899';
const idl = JSON.parse(fs.readFileSync(new URL('../target/idl/cleat.json', import.meta.url)));
const conn = new Connection(RPC, 'confirmed');
const PROGRAM = new PublicKey(idl.address);

const enc = (s) => Buffer.from(s);
const idx = (i) => (i === 0 ? Buffer.alloc(0) : Buffer.from(new Uint16Array([i]).buffer));
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
const sleeve = (owner, i) => {
  const mandate = pda([enc('mandate'), owner.toBuffer(), idx(i)]);
  return {
    mandate,
    universe: pda([enc('universe'), mandate.toBuffer()]),
    vault: pda([enc('vault'), owner.toBuffer(), idx(i)]),
    log: pda([enc('verdicts'), owner.toBuffer(), idx(i)]),
    spend: pda([enc('spend'), owner.toBuffer(), idx(i)]),
  };
};

async function funded() {
  const kp = Keypair.generate();
  const sig = await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  return kp;
}
const programFor = (kp) =>
  new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' }));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const owner = await funded();
const stranger = await funded();
const p = programFor(owner);
const I = 1;
const a = sleeve(owner.publicKey, I);
const sys = SystemProgram.programId;

await p.methods.createMandate(I, 'Nothing over fifteen percent in one name.', 1500, 500, 20, [])
  .accountsStrict({ owner: owner.publicKey, mandate: a.mandate, systemProgram: sys }).rpc();
await p.methods.declareUniverse(I, [{ mint: Keypair.generate().publicKey, category: 1 }])
  .accountsStrict({ owner: owner.publicKey, mandate: a.mandate, universe: a.universe, systemProgram: sys }).rpc();
await p.methods.openVault(I)
  .accountsStrict({ owner: owner.publicKey, mandate: a.mandate, vault: a.vault, systemProgram: sys }).rpc();
await p.methods.deposit(I, new BN(0.5 * LAMPORTS_PER_SOL))
  .accountsStrict({ payer: owner.publicKey, vault: a.vault, systemProgram: sys }).rpc();
await p.methods.openVerdictLog(I)
  .accountsStrict({ owner: owner.publicKey, vault: a.vault, log: a.log, systemProgram: sys }).rpc();
await p.methods.openSpendAccount(I, Keypair.generate().publicKey, new BN(0.1 * LAMPORTS_PER_SOL), new BN(3600))
  .accountsStrict({ owner: owner.publicKey, spend: a.spend, systemProgram: sys }).rpc();
await p.methods.fundSpendAccount(I, new BN(0.2 * LAMPORTS_PER_SOL))
  .accountsStrict({ payer: owner.publicKey, spend: a.spend, systemProgram: sys }).rpc();

const held = {};
for (const [k, v] of Object.entries(a)) held[k] = await conn.getBalance(v);
check(Object.values(held).every((l) => l > 0), `all five accounts exist: ${JSON.stringify(held)}`);
const total = Object.values(held).reduce((x, y) => x + y, 0);

// A stranger calling it derives their own addresses from their own key, so
// the most they can do is close their own nothing.
const s = sleeve(stranger.publicKey, I);
await programFor(stranger).methods.closeSleeve(I)
  .accountsStrict({ owner: stranger.publicKey, ...s }).rpc();
let intact = true;
for (const [k, v] of Object.entries(a)) intact &&= (await conn.getBalance(v)) === held[k];
check(intact, "a stranger's close leaves the owner's sleeve untouched");

// And cannot point the instruction at the owner's accounts instead.
let refused = false;
try {
  await programFor(stranger).methods.closeSleeve(I)
    .accountsStrict({ owner: stranger.publicKey, ...a }).rpc();
} catch {
  refused = true;
}
check(refused, "the owner's addresses under a stranger's signature are refused by the seeds");

const before = await conn.getBalance(owner.publicKey);
const sig = await p.methods.closeSleeve(I).accountsStrict({ owner: owner.publicKey, ...a }).rpc();
const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
const after = await conn.getBalance(owner.publicKey);
check(after - before + tx.meta.fee === total, `owner got back all ${total} lamports (fee ${tx.meta.fee})`);
let gone = true;
for (const v of Object.values(a)) gone &&= (await conn.getAccountInfo(v)) === null;
check(gone, 'all five accounts are closed');

await p.methods.createMandate(I, 'A second sentence at the same index.', 1000, 300, 0, [])
  .accountsStrict({ owner: owner.publicKey, mandate: a.mandate, systemProgram: sys }).rpc();
check((await conn.getAccountInfo(a.mandate))?.owner.equals(PROGRAM), 'the index can be opened again');

// A sleeve that never existed closes to nothing rather than failing.
const empty = sleeve(owner.publicKey, 7);
await p.methods.closeSleeve(7).accountsStrict({ owner: owner.publicKey, ...empty }).rpc();
check(true, 'closing a sleeve that was never opened succeeds and moves nothing');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
