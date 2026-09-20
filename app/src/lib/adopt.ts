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
const D_CREATE = new Uint8Array([230, 170, 158, 68, 33, 169, 16, 158]);

const u16le = (n: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
};

/**
 * What a sentence compiles to.
 *
 * The product's claim is that plain English is resolved off chain and the
 * resolution is what the program enforces, because a program cannot read
 * English. This is that resolution, and it is deliberately small and legible
 * rather than clever: a number followed by "percent" becomes the position cap,
 * naming fossil fuels pulls in the mints that are fossil fuels, and anything
 * it cannot read falls back to a default it states out loud.
 *
 * Shown to the person before they sign, because a sentence that compiles to
 * something they did not expect is the one thing this design cannot afford.
 */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30,
};

/** Exxon on Ondo and Chevron, the two the demo deny list already names. */
const FOSSIL_MINTS = [
  'qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo',
];

export interface Compiled {
  maxPositionBps: number;
  maxTradeBps: number;
  maxSpreadBps: number;
  denied: string[];
  notes: string[];
}

export function compileSentence(text: string): Compiled {
  const t = text.toLowerCase();
  const notes: string[] = [];

  let pct: number | null = null;
  const digits = t.match(/(\d{1,2})\s*(?:%|percent)/);
  if (digits) pct = parseInt(digits[1], 10);
  if (pct === null) {
    for (const [w, n] of Object.entries(WORD_NUMBERS)) {
      if (new RegExp(`\\b${w}\\b[^.]{0,20}percent`).test(t)) { pct = n; break; }
    }
  }
  const maxPositionBps = pct ? Math.min(10000, pct * 100) : 1500;
  notes.push(pct
    ? `no more than ${pct}% of the book in one name`
    : 'no cap named, so the default of 15% in one name');

  const maxTradeBps = Math.max(100, Math.round(maxPositionBps / 3));
  notes.push(`one trade may move ${(maxTradeBps / 100).toFixed(0)}% of it`);

  const denied: string[] = [];
  if (/fossil|oil|crude|petrol|energy major/.test(t)) {
    denied.push(...FOSSIL_MINTS);
    notes.push(`${FOSSIL_MINTS.length} fossil fuel mint ruled out by name`);
  }

  return { maxPositionBps, maxTradeBps, maxSpreadBps: 20, denied, notes };
}

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

/**
 * Write your own sentence to your own account.
 *
 * Same shape as adopting: this side builds it, the person signs it, and the
 * server only relays after reading back what it is being asked to send.
 */
export async function createMandate(
  owner: Keypair,
  text: string,
  compiled: Compiled,
): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58() });
  if (prep.error) throw new Error(prep.error);

  const mandate = mandatePda(owner.publicKey);
  const tx = new Transaction();
  if (prep.needsTopUp) {
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet),
      toPubkey: owner.publicKey,
      lamports: prep.topUpLamports,
    }));
  }

  const body = new TextEncoder().encode(text);
  const denied = compiled.denied.map((m) => new PublicKey(m).toBytes());
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: mandate, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      D_CREATE,
      u32le(body.length), body,
      u16le(compiled.maxPositionBps),
      u16le(compiled.maxTradeBps),
      u16le(compiled.maxSpreadBps),
      u32le(denied.length), ...denied,
    ) as unknown as Buffer,
  }));

  tx.feePayer = new PublicKey(prep.feePayer);
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
    child: mandate.toBase58(),
  };
}

/** Whether this key already speaks for a sentence. One owner, one mandate. */
export async function hasMandate(connection: Connection, owner: PublicKey) {
  return !!(await connection.getAccountInfo(mandatePda(owner)));
}
