// Adopting a sentence, signed by the person doing it.
//
// The transaction is built here rather than handed down ready made. The server
// is asked only for a blockhash and whether this wallet can pay its own way,
// and then this side assembles the instructions itself. That ordering matters:
// a client that signs whatever it is given is trusting the server with its
// key, and the entire argument of this product is about not having to.
//
// The rent for the child account comes from the adopter, because the program
// declares it that way and no fee payer arrangement changes it. A funded
// wallet pays for itself, which is what would happen anywhere real. An empty
// one gets a visible transfer from the demo faucet in the same transaction, so
// the help is in the record rather than hidden behind it.
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL');

/**
 * Bytes without Node's Buffer, the same way chain.ts already does it.
 *
 * There is no Buffer in a browser. Reaching for it at module scope does not
 * fail at the call, it fails the moment the file is imported, which takes the
 * whole app down on load rather than breaking one button.
 */
const MANDATE_SEED = new TextEncoder().encode('mandate');
const D_ADOPT = new Uint8Array([210, 106, 122, 112, 155, 35, 71, 36]);

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

export const mandatePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([MANDATE_SEED, owner.toBuffer()], PROGRAM_ID)[0];

export interface AdoptResult {
  signature: string;
  explorer: string;
  /** True when the demo covered the rent because the wallet had nothing. */
  sponsored: boolean;
  child: string;
}

const post = async (payload: unknown) => {
  const res = await fetch('/api/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
};

/**
 * Take a published sentence as your own.
 *
 * `parent` is the mandate account being adopted from, which the exchange
 * already reads off the program, and `text` is its sentence. The program
 * copies the caps and the deny list itself; passing the text keeps the child
 * readable without another fetch.
 */
export async function adoptMandate(
  owner: Keypair,
  parent: PublicKey,
  text: string,
): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58() });
  if (prep.error) throw new Error(prep.error);

  const child = mandatePda(owner.publicKey);
  const feePayer = new PublicKey(prep.feePayer);

  const tx = new Transaction();
  if (prep.needsTopUp) {
    // Visible in the transaction, not tucked into a separate one beforehand.
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet),
      toPubkey: owner.publicKey,
      lamports: prep.topUpLamports,
    }));
  }

  // Borsh: a string is its length then its bytes.
  const body = new TextEncoder().encode(text);

  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: parent, isSigner: false, isWritable: true },
      { pubkey: child, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(D_ADOPT, u32le(body.length), body) as unknown as Buffer,
  }));

  tx.feePayer = feePayer;
  tx.recentBlockhash = prep.blockhash;
  tx.partialSign(owner);

  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(sent.error);

  return {
    signature: sent.signature,
    explorer: sent.explorer,
    sponsored: !!sent.sponsored,
    child: child.toBase58(),
  };
}

/** Whether this key already speaks for a sentence. One owner, one mandate. */
export async function hasMandate(connection: Connection, owner: PublicKey) {
  return !!(await connection.getAccountInfo(mandatePda(owner)));
}
