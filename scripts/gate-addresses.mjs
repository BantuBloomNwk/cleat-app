// The Arcium addresses the gate needs, printed once so a request path does not
// have to derive them.
//
// Every one of these except the per-run computation account is a constant for
// a fixed program, cluster and circuit. The serverless function that drives
// the gate hardcodes them from this output rather than pulling the whole
// Arcium client into a request. Re-run this after any cluster move or key
// rotation and paste the result into app/netlify/functions/gate.mts.
//
// Run: node scripts/gate-addresses.mjs [cluster]   (default 456)

import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import {
  getMXEPublicKey, getMXEAccAddress, getCompDefAccAddress, getCompDefAccOffset,
  getMempoolAccAddress, getExecutingPoolAccAddress, getComputationAccAddress,
  getClusterAccAddress, getFeePoolAccAddress, getClockAccAddress,
  getArciumSignerAccAddress, ARCIUM_ADDR,
} from "@arcium-hq/client";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const CIRCUIT = "gate_breach_v7";
const CLUSTER = Number(process.argv[2] || 456);
const offset = Buffer.from(getCompDefAccOffset(CIRCUIT)).readUInt32LE(0);

const conn = new Connection(baseRpc(), "confirmed");
const provider = new anchor.AnchorProvider(
  conn, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" });
const mxePub = await getMXEPublicKey(provider, PROGRAM_ID);

console.log(JSON.stringify({
  cluster: CLUSTER,
  circuit: CIRCUIT,
  compDefOffset: offset,
  arciumProgram: new PublicKey(ARCIUM_ADDR).toBase58(),
  mxeAccount: getMXEAccAddress(PROGRAM_ID).toBase58(),
  compDefAccount: getCompDefAccAddress(PROGRAM_ID, offset).toBase58(),
  mempool: getMempoolAccAddress(CLUSTER).toBase58(),
  execPool: getExecutingPoolAccAddress(CLUSTER).toBase58(),
  clusterAccount: getClusterAccAddress(CLUSTER).toBase58(),
  feePool: getFeePoolAccAddress().toBase58(),
  clock: getClockAccAddress().toBase58(),
  signPda: getArciumSignerAccAddress(PROGRAM_ID).toBase58(),
  mxeX25519: mxePub ? Buffer.from(mxePub).toString("base64") : null,
  computationSamples: ["1", "123456789"].map((o) => ({
    offset: o, address: getComputationAccAddress(CLUSTER, new anchor.BN(o)).toBase58(),
  })),
}, null, 2));
