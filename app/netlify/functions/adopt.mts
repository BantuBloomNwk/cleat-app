// Taking somebody else's sentence, for real.
//
// Adopt used to set a string in React state. The program has had the whole
// thing working the entire time: adopt_mandate inits a child account seeded by
// the adopter, copies the caps and the deny list across, records who it came
// from and increments the parent's count. None of it was reachable from the
// product, which made the one social claim in this app a caption.
//
// Two things had to be solved to reach it.
//
// The child account is declared `payer = adopter`, so the rent comes out of
// the person's own wallet and no amount of fee payer arrangement changes that.
// A funded wallet therefore pays for itself, which is the real behaviour and
// the one that survives contact with mainnet. Only a wallet with nothing in it
// gets a top up, and the transaction says so by carrying a visible transfer
// rather than hiding the help.
//
// And a relay that will send anything is a relay somebody else will use. This
// one reads every instruction back before it signs: a Cleat adopt and at most
// one system transfer out of the faucet, to the adopter, for no more than the
// rent. Anything else is refused unsigned.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
const MANDATE_SEED = Buffer.from("mandate");

/**
 * Off the deployed IDL. This is the entire set this relay will ever pass, and
 * every one of them is something an owner does to their own accounts.
 */
const ALLOWED: Record<string, string> = {
  '210,106,122,112,155,35,71,36': 'adopt_mandate',
  '230,170,158,68,33,169,16,158': 'create_mandate',
  '181,248,228,67,6,175,37,167': 'open_vault',
  '242,35,198,137,82,225,242,182': 'deposit',
  '183,18,70,156,148,109,161,34': 'withdraw',
};

/** Rent for a Mandate plus a little for fees, which is what a top up covers. */
const TOP_UP_LAMPORTS = 12_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const mandatePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([MANDATE_SEED, owner.toBuffer()], PROGRAM_ID)[0];

export default async (req: Request) => {
  const faucetSecret = process.env.CLEAT_SANDBOX_OWNER;
  const upstream = process.env.SOLANA_RPC_URL;
  if (!faucetSecret || !upstream) return json({ error: "adopting is not configured on this deploy" }, 503);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "not json" }, 400); }

  const connection = new Connection(upstream, "confirmed");
  const faucet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(faucetSecret)));

  /* ---- phase one: what shape should this transaction be ---- */
  if (body.phase === "prepare") {
    let owner: PublicKey;
    try { owner = new PublicKey(String(body.owner)); }
    catch { return json({ error: "bad owner" }, 400); }

    const [balance, existing, { blockhash, lastValidBlockHeight }] = await Promise.all([
      connection.getBalance(owner),
      connection.getAccountInfo(mandatePda(owner)),
      connection.getLatestBlockhash("confirmed"),
    ]);
    // Writing a first sentence needs the account free. Adopting needs the same
    // thing, because an adopted sentence lands in exactly that account.
    // Only a first sentence is blocked by one already existing. Everything
    // else an owner does to their own accounts is allowed to repeat.
    if (existing && body.intent === 'mandate') {
      return json({
        error: "This key already speaks for a sentence. One owner, one mandate, which is the point of it.",
        already: true,
      });
    }
    // Enough to cover its own rent and fee, or it needs a hand.
    const needsTopUp = balance < TOP_UP_LAMPORTS;
    return json({
      blockhash, lastValidBlockHeight,
      needsTopUp,
      topUpLamports: needsTopUp ? TOP_UP_LAMPORTS : 0,
      feePayer: (needsTopUp ? faucet.publicKey : owner).toBase58(),
      faucet: faucet.publicKey.toBase58(),
      balance,
    });
  }

  /* ---- phase two: check it, co-sign if asked, send ---- */
  if (body.phase !== "send") return json({ error: "unknown phase" }, 400);

  try {
    const tx = Transaction.from(Buffer.from(String(body.tx), "base64"));

    // Read every instruction back. This is the whole defence: the client has
    // already signed, but nothing leaves here without the server agreeing that
    // what it signed is what it said it would.
    // Whoever signed first is the person this transaction belongs to.
    const signer = tx.signatures.find((sg) => sg.signature)?.publicKey
      ?? tx.feePayer ?? PublicKey.default;
    let sawAdopt = 0, sawTransfer = 0;
    for (const ix of tx.instructions) {
      if (ix.programId.equals(PROGRAM_ID)) {
        if (!ALLOWED[Array.from(ix.data.subarray(0, 8)).join(',')]) {
          return json({ error: "that is not an instruction this relay passes" }, 400);
        }
        sawAdopt++;
        continue;
      }
      if (ix.programId.equals(SystemProgram.programId)) {
        const kind = ix.data.readUInt32LE(0);
        if (kind !== 2) {
          return json({ error: "only a transfer, and that is not one" }, 400);
        }
        const lamports = Number(ix.data.readBigUInt64LE(4));
        const from = ix.keys[0]?.pubkey;
        if (from?.equals(faucet.publicKey)) {
          // Out of the faucet is the sponsored top up, and it is capped.
          if (lamports > TOP_UP_LAMPORTS) {
            return json({ error: "a top up does not go that far" }, 400);
          }
          sawTransfer++;
          continue;
        }
        // Otherwise it has to be somebody moving their own money, which means
        // they signed for it and the faucet is not party to it at all.
        if (!from?.equals(signer)) {
          return json({ error: "that transfer is not yours to make" }, 400);
        }
        continue;
      }
      return json({ error: "unexpected program in the transaction" }, 400);
    }
    if (sawAdopt > 3 || sawTransfer > 1) {
      return json({ error: "too much is happening in one transaction" }, 400);
    }

    // Sign only if we are actually party to it.
    if (tx.feePayer?.equals(faucet.publicKey) || sawTransfer === 1) {
      tx.partialSign(faucet);
    }

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    return json({
      signature,
      sponsored: sawTransfer === 1,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return json({ error: msg.slice(0, 300) }, 200);
  }
};

export const config = { path: "/api/adopt" };
