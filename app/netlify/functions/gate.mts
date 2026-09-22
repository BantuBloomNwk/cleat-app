// Push on the boundary, through the circuit this time.
//
// `attack.mts` drives `propose_trade`, which is the public clamp: the caps are
// on the mandate in the open, the program reads them, and it decides in one
// slot. Real, checkable, and not the thing Cleat claims. This is the other
// path. `gate_trade` seals the position, hands the ciphertext to the Arcium
// network, and waits for a threshold of nodes that each hold a share of the
// answer and none of the number to call back with approve, clamp or refuse.
//
// The difference a judge can see: two proposals that are identical in every
// public field land differently, because the only thing separating them is a
// figure nobody in the path can read.
//
// Two keys sign one transaction here, and the split is the point rather than
// an accident of the sandbox. The owner signs `set_position_handle`, because
// only an owner may publish what their book looks like. The agent signs
// `gate_trade` and pays for it, forwarding a ciphertext it has no key for. In
// production those are two devices. Here they are two environment variables
// against a throwaway devnet vault that holds nothing.
//
// The function does not wait for the verdict. An Arcium round trip runs about
// six seconds against a serverless ceiling of ten, so waiting here is how a
// demo becomes a timeout on stage. It returns the queue signature and the
// computation address immediately, and the page watches those two accounts
// through the same fenced RPC proxy it already uses for everything else.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { RescueCipher } from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "node:crypto";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");

/**
 * The sandbox, same accounts `attack.mts` writes to.
 *
 * One owner, three fixed seeds, created by scripts/sandbox-setup.mjs. Kept
 * separate from the curated log the diary reads, so whoever is playing with
 * the app cannot overwrite the sixteen decisions that exercise every reason
 * the program has.
 */
const VAULT = new PublicKey("GWJMZJPEMgfQMv9Q2LFdEg7ApA9aAXJDLLNb5cUiDxTK");
const MANDATE = new PublicKey("7mUxHWHJp475Vquxmm7mRXZdqqkQaiSZSdfgQ7fiHoEt");
const LOG = new PublicKey("Cd4bnuBoi57pD11gfjiHjgYAnAb5G4EHZUtZkMvfQP54");

/**
 * Arcium's side, printed by scripts/gate-addresses.mjs.
 *
 * Constants for a fixed program, cluster and circuit, so they are written down
 * rather than re-derived on every request. Re-run that script after a cluster
 * move or a key rotation. The cluster is 456. We were on 4500 until it stopped
 * executing anything on 2026-09-20, with three of our computations sitting in
 * its execpool untouched while its nodes still reported active. TOOLCHAIN.md
 * has how to tell a serving cluster from a registered one.
 */
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

/** The MXE's x25519 key. Positions are sealed to a secret shared with this. */
const MXE_X25519 = Uint8Array.from(Buffer.from("tMBQW8k6o5T91XG6U3N8eeFBKXUkZsMepKYsnvnbN1Y=", "base64"));

/** Discriminators off the deployed IDL, not guessed. */
const D_SET_HANDLE = Buffer.from([135, 120, 109, 196, 53, 184, 160, 18]);
const D_GATE_TRADE = Buffer.from([160, 213, 58, 232, 203, 28, 133, 155]);

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

/**
 * Where this particular question waits, derived the way the Arcium program
 * does it. The only address here that is not a constant, because the offset is
 * random per request so two questions in flight cannot collide.
 */
const computationPda = (offset: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("ComputationAccount"), u32(CLUSTER), u64(offset)], ARCIUM)[0];

/** What the owner declared this mandate may touch. Derived, so it cannot be swapped. */
const UNIVERSE = PublicKey.findProgramAddressSync(
  [Buffer.from("universe"), MANDATE.toBuffer()], PROGRAM_ID)[0];

const pendingPda = (computation: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("pending"), computation.toBuffer()], PROGRAM_ID)[0];

/**
 * The scenarios, and the exposure each one is standing on.
 *
 * `heldBps` is the secret. It never leaves this function in the clear, it is
 * sealed to the MXE before it goes anywhere, and it is the only difference
 * between the two proposals that matter. Everything else on a pair is equal on
 * purpose, so the verdicts cannot be explained by anything a reader can see.
 */
const SCENARIOS: Record<string, {
  label: string; headline: string; heldBps: number; category: number;
  bps: number; side: number; mint: string; tests: string;
}> = {
  room: {
    label: "Three percent of tech, with one percent already held",
    headline: "Routine addition. Room under the ceiling.",
    heldBps: 100, category: 1, bps: 300, side: 0,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "the same ask, against a book with room in it",
  },
  nearcap: {
    label: "Three percent of tech, with fourteen percent already held",
    headline: "Routine addition. Room under the ceiling.",
    heldBps: 1400, category: 1, bps: 300, side: 0,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    tests: "the identical ask, against a book that is nearly full",
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req: Request) => {
  if (req.method === "GET") {
    return json({
      scenarios: Object.entries(SCENARIOS).map(([key, s]) => ({
        key, label: s.label, headline: s.headline, tests: s.tests,
      })),
      note: "The pair is deliberately identical in public. Only the sealed exposure differs.",
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const ownerSecret = process.env.CLEAT_SANDBOX_OWNER;
  const agentSecret = process.env.CLEAT_SANDBOX_AGENT;
  const upstream = process.env.SOLANA_RPC_URL;
  if (!ownerSecret || !agentSecret || !upstream) {
    return json({ error: "the confidential gate is not configured on this deploy" }, 503);
  }

  let key: string;
  try { key = String(((await req.json()) as any)?.scenario ?? ""); }
  catch { return json({ error: "not json" }, 400); }
  const s = SCENARIOS[key];
  if (!s) return json({ error: "unknown scenario" }, 400);

  try {
    const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(ownerSecret)));
    const agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(agentSecret)));
    const connection = new Connection(upstream, "confirmed");

    // Fresh keypair and nonce every request. The exposure is sealed to a
    // secret shared with the MXE, so the program that forwards it never holds
    // a key that would open it, and two runs of the same scenario do not
    // produce the same bytes on chain.
    const priv = x25519.utils.randomPrivateKey();
    const pub = x25519.getPublicKey(priv);
    const cipher = new RescueCipher(x25519.getSharedSecret(priv, MXE_X25519));
    const nonce = randomBytes(16);
    const ct = cipher.encrypt([BigInt(s.heldBps)], nonce);

    const offset = randomBytes(8).readBigUInt64LE(0) >> 1n;
    const computation = computationPda(offset);
    const pending = pendingPda(computation);

    const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) =>
      ({ pubkey, isSigner, isWritable });

    // One transaction, both instructions. If the gate call fails the handle
    // does not move either, which keeps the vault from being left describing a
    // book that was never asked about.
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [meta(owner.publicKey, true, false), meta(VAULT, false, true)],
        // Sleeve zero. The sandbox accounts were written before sleeves and
        // sit at the index that adds no seed bytes, so their addresses did
        // not move and only the argument list grew.
        data: Buffer.concat([D_SET_HANDLE, u16(0), Buffer.from(ct[0])]),
      }),
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          meta(agent.publicKey, true, true),
          meta(VAULT, false, false),
          meta(MANDATE, false, false),
          meta(LOG, false, true),
          meta(UNIVERSE, false, false),
          meta(SIGN_PDA, false, true),
          meta(MXE, false, false),
          meta(MEMPOOL, false, true),
          meta(EXEC_POOL, false, true),
          meta(computation, false, true),
          meta(COMP_DEF, false, false),
          meta(pending, false, true),
          meta(CLUSTER_ACC, false, true),
          meta(FEE_POOL, false, true),
          meta(ARCIUM_CLOCK, false, true),
          meta(SystemProgram.programId, false, false),
          meta(ARCIUM, false, false),
        ],
        data: Buffer.concat([
          D_GATE_TRADE, u64(offset), u16(0), Buffer.from(ct[0]),
          Buffer.from(pub), Buffer.from(nonce),
          Buffer.from([s.category]), u16(s.bps), Buffer.from([s.side]),
          new PublicKey(s.mint).toBuffer(),
        ]),
      }),
    );
    tx.feePayer = agent.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(agent, owner);

    const t0 = Date.now();
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true, preflightCommitment: "confirmed",
    });

    return json({
      signature,
      queuedMs: Date.now() - t0,
      // What the page watches. The computation account exists while the
      // network is working and is closed when it answers, so its disappearance
      // is the signal that a verdict is either written or was refused outright.
      computation: computation.toBase58(),
      log: LOG.toBase58(),
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      scenario: key,
      asked: s.bps,
      path: "gate_trade",
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return json({ error: msg.slice(0, 400) }, 200);
  }
};

export const config = { path: "/api/gate" };
