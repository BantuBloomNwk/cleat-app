// The same transaction app/netlify/functions/gate.mts builds, run from here.
//
// The function cannot be exercised locally without a Netlify runtime, and the
// interesting failure modes are all on chain rather than in the HTTP shell. So
// this mirrors it exactly: same constants, same two instructions, same signer
// split, and then it waits for the callback the function deliberately does not
// wait for. If this closes, the function closes.
//
// Run: node scripts/gate-sandbox.mjs [room|nearcap]

import fs from "node:fs";
import crypto from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { RescueCipher } from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import { baseRpc } from "./rpc.mjs";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const VAULT = new PublicKey("GWJMZJPEMgfQMv9Q2LFdEg7ApA9aAXJDLLNb5cUiDxTK");
const MANDATE = new PublicKey("7mUxHWHJp475Vquxmm7mRXZdqqkQaiSZSdfgQ7fiHoEt");
const LOG = new PublicKey("Cd4bnuBoi57pD11gfjiHjgYAnAb5G4EHZUtZkMvfQP54");
const CLUSTER = 456;
const ARCIUM = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const MXE = new PublicKey("DMNi8mRDCMDnnQv4q9WBsZPDxKN1dk26kDWWYw2nwLow");
const COMP_DEF = new PublicKey("4ZheLnQbwLQFBdS39MaBhYVNgusjt8chnJrJqcYoU8kq");
const MEMPOOL = new PublicKey("Ex7BD8o8PK1y2eXDd38Jgujj93uHygrZeWXDeGAHmHtN");
const EXEC_POOL = new PublicKey("4mcrgNZzJwwKrE3wXMHfepT8htSBmGqBzDYPJijWooog");
const CLUSTER_ACC = new PublicKey("DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95");
const FEE_POOL = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const ARCIUM_CLOCK = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");
const SIGN_PDA = new PublicKey("9kCciv9qCd4VnP3rTSQwzqjkPv9pMVxbAHV7VQhYftGw");
const MXE_X25519 = Uint8Array.from(Buffer.from("tMBQW8k6o5T91XG6U3N8eeFBKXUkZsMepKYsnvnbN1Y=", "base64"));
const UNIVERSE = PublicKey.findProgramAddressSync(
  [Buffer.from("universe"), MANDATE.toBuffer()], PROGRAM_ID)[0];
const D_SET_HANDLE = Buffer.from([135, 120, 109, 196, 53, 184, 160, 18]);
const D_GATE_TRADE = Buffer.from([160, 213, 58, 232, 203, 28, 133, 155]);

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kp = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(new URL(`./.${n}.json`, import.meta.url), "utf8"))));

const SCENARIOS = {
  room:    { heldBps: 100,  category: 1, bps: 300, side: 0, mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  nearcap: { heldBps: 1400, category: 1, bps: 300, side: 0, mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
};

function readLog(data) {
  let o = 8 + 32 + 32;
  const head = data.readUInt8(o); o += 1;
  const cleared = data.readUInt32LE(o); o += 4;
  const clamped = data.readUInt32LE(o); o += 4;
  const refused = data.readUInt32LE(o); o += 4;
  const count = data.readUInt32LE(o); o += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({ proposed: data.readUInt16LE(o + 11), allowed: data.readUInt16LE(o + 13),
                   outcome: data.readUInt8(o + 15), reason: data.readUInt8(o + 16) });
    o += 17;
  }
  return { head, cleared, clamped, refused, entries };
}

const key = process.argv[2] || "room";
const s = SCENARIOS[key];
if (!s) throw new Error(`unknown scenario ${key}`);

const connection = new Connection(baseRpc(), "confirmed");
const owner = kp("sandbox-owner");
const agent = kp("sandbox-agent");
console.log(`scenario ${key}: sealed exposure ${s.heldBps}bps, asking ${s.bps}bps`);
console.log(`owner ${owner.publicKey.toBase58()}  agent ${agent.publicKey.toBase58()}`);
for (const [who, k] of [["owner", owner], ["agent", agent]]) {
  console.log(`  ${who} balance ${(await connection.getBalance(k.publicKey)) / 1e9} SOL`);
}

const priv = x25519.utils.randomPrivateKey();
const pub = x25519.getPublicKey(priv);
const cipher = new RescueCipher(x25519.getSharedSecret(priv, MXE_X25519));
const nonce = crypto.randomBytes(16);
const ct = cipher.encrypt([BigInt(s.heldBps)], nonce);

const offset = crypto.randomBytes(8).readBigUInt64LE(0) >> 1n;
const computation = PublicKey.findProgramAddressSync(
  [Buffer.from("ComputationAccount"), u32(CLUSTER), u64(offset)], ARCIUM)[0];
const pending = PublicKey.findProgramAddressSync(
  [Buffer.from("pending"), computation.toBuffer()], PROGRAM_ID)[0];

const before = readLog((await connection.getAccountInfo(LOG)).data);
console.log(`log before: cleared ${before.cleared} clamped ${before.clamped} refused ${before.refused}`);

const tx = new Transaction().add(
  new TransactionInstruction({ programId: PROGRAM_ID,
    keys: [meta(owner.publicKey, true, false), meta(VAULT, false, true)],
    data: Buffer.concat([D_SET_HANDLE, Buffer.from(ct[0])]) }),
  new TransactionInstruction({ programId: PROGRAM_ID,
    keys: [
      meta(agent.publicKey, true, true), meta(VAULT, false, false), meta(MANDATE, false, false),
      meta(LOG, false, true), meta(UNIVERSE, false, false),
      meta(SIGN_PDA, false, true), meta(MXE, false, false),
      meta(MEMPOOL, false, true), meta(EXEC_POOL, false, true), meta(computation, false, true),
      meta(COMP_DEF, false, false), meta(pending, false, true), meta(CLUSTER_ACC, false, true),
      meta(FEE_POOL, false, true), meta(ARCIUM_CLOCK, false, true),
      meta(SystemProgram.programId, false, false), meta(ARCIUM, false, false),
    ],
    data: Buffer.concat([D_GATE_TRADE, u64(offset), Buffer.from(ct[0]), Buffer.from(pub),
                         Buffer.from(nonce), Buffer.from([s.category]), u16(s.bps),
                         Buffer.from([s.side]), new PublicKey(s.mint).toBuffer()]) }),
);
tx.feePayer = agent.publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
tx.sign(agent, owner);

const t0 = Date.now();
const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
console.log(`queued in ${Date.now() - t0}ms  ${sig}`);
console.log(`computation ${computation.toBase58()}`);

let waited = 0, compSeen = true, goneAt = null, after = before;
while (waited < 180000) {
  await sleep(2000); waited += 2000;
  const [li, ci] = await Promise.all([
    connection.getAccountInfo(LOG), connection.getAccountInfo(computation)]);
  if (compSeen && !ci) { compSeen = false; goneAt = waited; }
  after = readLog(li.data);
  if (after.cleared + after.clamped + after.refused > before.cleared + before.clamped + before.refused) break;
  if (!compSeen && waited > goneAt + 8000) break;
}
const words = ["cleared", "clamped", "refused"];
const v = after.entries.length ? after.entries[(after.head + 15) % 16] : null;
console.log(`after ${Math.round((Date.now() - t0) / 1000)}s: cleared ${after.cleared} clamped ${after.clamped} refused ${after.refused}`);
if (after.cleared + after.clamped + after.refused > before.cleared + before.clamped + before.refused && v) {
  console.log(`VERDICT ${words[v.outcome]}  asked ${v.proposed}bps  allowed ${v.allowed}bps  reason ${v.reason}`);
} else {
  console.log(compSeen ? "still queued, no verdict" : "computation closed with no verdict written");
}
