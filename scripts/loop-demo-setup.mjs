// Give the loop a public account to trade for, so anybody can watch it work.
//
// Writes a sentence for the demo owner, opens its vault and decision log, and
// grants the loop agent authority to propose for thirty days, the most the
// program allows. Run it again when the grant runs out. Idempotent: it skips
// whatever already exists.
//
// Run: node scripts/loop-demo-setup.mjs

import fs from 'node:fs';
import anchor from '@anchor-lang/core';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

const { AnchorProvider, Program, Wallet, BN } = anchor;
const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const RPC = env.match(/^[A-Z_]*RPC[A-Z_]*=(.*)$/m)[1].trim();
const idl = JSON.parse(fs.readFileSync(new URL('../target/idl/cleat.json', import.meta.url)));
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('./.loop-demo-owner.json', import.meta.url)))));
const LOOP_AGENT = new PublicKey('H6J8BYK6nRgopKjU5dHjnra7C8MXMCR4PD3zydm9fnrE');
const conn = new Connection(RPC, 'confirmed');
const p = new Program(idl, new AnchorProvider(conn, new Wallet(owner), { commitment: 'confirmed' }));
const PROGRAM = new PublicKey(idl.address);
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const o = owner.publicKey;
const mandate = pda([Buffer.from('mandate'), o.toBuffer()]);
const vault = pda([Buffer.from('vault'), o.toBuffer()]);
const log = pda([Buffer.from('verdicts'), o.toBuffer()]);
const sys = SystemProgram.programId;

if (!(await conn.getAccountInfo(mandate))) {
  await p.methods.createMandate(0, 'Moderate growth, nothing over fifteen percent in one sector, and no fossil fuels.', 1500, 500, 20, [])
    .accountsStrict({ owner: o, mandate, systemProgram: sys }).rpc();
  console.log('sentence written');
}
if (!(await conn.getAccountInfo(vault))) {
  await p.methods.openVault(0).accountsStrict({ owner: o, mandate, vault, systemProgram: sys }).rpc();
  console.log('vault opened');
}
if (!(await conn.getAccountInfo(log))) {
  await p.methods.openVerdictLog(0).accountsStrict({ owner: o, vault, log, systemProgram: sys }).rpc();
  console.log('log opened');
}
const sig = await p.methods.setAgent(0, LOOP_AGENT, new BN(30 * 86400), new BN(0))
  .accountsStrict({ owner: o, vault, mandate }).rpc();
console.log('granted the loop agent for 30 days', sig);
