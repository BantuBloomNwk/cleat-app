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
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import type { OwnerSigner } from './signer';

export const PROGRAM_ID = new PublicKey('2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL');

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
const D_OPEN_VAULT = new Uint8Array([181, 248, 228, 67, 6, 175, 37, 167]);
const D_DEPOSIT = new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]);
const D_WITHDRAW = new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34]);
const D_OPEN_LOG = new Uint8Array([31, 253, 231, 102, 57, 62, 203, 126]);
const D_UPDATE = new Uint8Array([69, 131, 248, 29, 105, 50, 139, 30]);
const VERDICT_SEED = new TextEncoder().encode('verdicts');

/* MagicBlock's side of delegation.
 *
 * Delegating hands the vault's ownership to the delegation program so an
 * ephemeral rollup can write to it at rollup speed, and the seeds below are
 * that program's, not ours. Taken from magicblock-delegation-program-api
 * rather than guessed: "buffer" off our own program, "delegation" and
 * "delegation-metadata" off theirs.
 */
export const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT = new PublicKey('MagicContext1111111111111111111111111111111');
const EPHEMERAL_VAULT = new PublicKey('MagicVau1t999999999999999999999999999999999');
const PERMISSION_PROGRAM = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');

const D_DELEGATE = new Uint8Array([166, 89, 17, 247, 90, 45, 115, 224]);
const D_SEAL = new Uint8Array([209, 155, 178, 53, 205, 199, 134, 28]);
const D_RELEASE = new Uint8Array([162, 80, 81, 254, 102, 228, 132, 87]);

const enc = (t: string) => new TextEncoder().encode(t);
const delegateBufferPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('buffer'), account.toBuffer()], PROGRAM_ID)[0];
const delegationRecordPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('delegation'), account.toBuffer()], DELEGATION_PROGRAM)[0];
const delegationMetadataPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('delegation-metadata'), account.toBuffer()], DELEGATION_PROGRAM)[0];
const permissionPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('permission'), account.toBuffer()], PERMISSION_PROGRAM)[0];

/**
 * Hand the vault to the rollup, and take it back.
 *
 * This is the badge in the header finally meaning something. Delegating moves
 * the vault's owner away from this program, which is exactly how the app knows
 * it happened: it reads the account owner rather than being told.
 */
export async function delegateVault(owner: OwnerSigner, index = 0): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58(), index });
  if (prep.error) throw new Error(prep.error);
  const vault = vaultPda(owner.publicKey, index);

  let tx = new Transaction();
  if (prep.needsTopUp) {
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet), toPubkey: owner.publicKey, lamports: prep.topUpLamports,
    }));
  }
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: delegateBufferPda(vault), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPda(vault), isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPda(vault), isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(D_DELEGATE, u16le(index)) as unknown as Buffer,
  }));

  tx.feePayer = new PublicKey(prep.feePayer);
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);
  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(readable(sent.error));
  return { signature: sent.signature, explorer: sent.explorer, sponsored: !!sent.sponsored, child: vault.toBase58() };
}

/**
 * The bytes a sleeve index contributes to an account's seeds.
 *
 * Mirrors index_seed() in the program, including the part that matters most:
 * sleeve zero contributes nothing, so it derives to the same address it
 * derived to before sleeves existed. Every account already written stays
 * exactly where it is.
 */
export const indexSeed = (index: number) =>
  index === 0 ? new Uint8Array(0) : u16le(index);

export const verdictLogPda = (owner: PublicKey, index = 0) =>
  PublicKey.findProgramAddressSync(
    [VERDICT_SEED, owner.toBuffer(), indexSeed(index)],
    PROGRAM_ID,
  )[0];

const VAULT_SEED = new TextEncoder().encode('vault');

const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

export const vaultPda = (owner: PublicKey, index = 0) =>
  PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), indexSeed(index)],
    PROGRAM_ID,
  )[0];

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

export const mandatePda = (owner: PublicKey, index = 0) =>
  PublicKey.findProgramAddressSync(
    [MANDATE_SEED, owner.toBuffer(), indexSeed(index)],
    PROGRAM_ID,
  )[0];

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
  owner: OwnerSigner,
  parent: PublicKey,
  text: string,
  index = 0,
): Promise<AdoptResult> {
  const prep = await post({
    phase: 'prepare', owner: owner.publicKey.toBase58(), intent: 'mandate', index,
  });
  if (prep.error) throw new Error(prep.error);

  const child = mandatePda(owner.publicKey, index);
  const feePayer = new PublicKey(prep.feePayer);

  let tx = new Transaction();
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
      // Whether the parent is private. The program refuses a private parent;
      // an older program ignores the extra account, so this ships first.
      { pubkey: privatePda(parent), isSigner: false, isWritable: false },
    ],
    data: concat(D_ADOPT, u16le(index), u32le(body.length), body) as unknown as Buffer,
  }));

  tx.feePayer = feePayer;
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);

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
  owner: OwnerSigner,
  text: string,
  compiled: Compiled,
  _opts: { replace?: boolean } = {},
  index = 0,
): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58(), index });
  if (prep.error) throw new Error(prep.error);

  const mandate = mandatePda(owner.publicKey, index);
  const vault = vaultPda(owner.publicKey, index);
  const log = verdictLogPda(owner.publicKey, index);
  const has = prep.has ?? { mandate: false, vault: false, log: false };

  let tx = new Transaction();
  if (prep.needsTopUp) {
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet),
      toPubkey: owner.publicKey,
      lamports: prep.topUpLamports,
    }));
  }

  const body = new TextEncoder().encode(text);
  const denied = compiled.denied.map((m) => new PublicKey(m).toBytes());
  const args = concat(
    u32le(body.length), body,
    u16le(compiled.maxPositionBps),
    u16le(compiled.maxTradeBps),
    u16le(compiled.maxSpreadBps),
    u32le(denied.length), ...denied,
  );

  /* Setting up is a repair, not a first run.
   *
   * Three accounts have to exist for any of this to mean anything: the rule,
   * the thing the rule governs, and the place decisions about it get written.
   * People end up holding one or two of them, because the app used to write
   * only the first, and because rewriting a sentence touches none of the
   * others. So build whatever is missing and rewrite the sentence if it is
   * already there. Running this twice is harmless, which is the point.
   */
  tx.add(has.mandate
    ? new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          { pubkey: mandate, isSigner: false, isWritable: true },
        ],
        data: concat(D_UPDATE, u16le(index), args) as unknown as Buffer,
      })
    : new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: mandate, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: concat(D_CREATE, u16le(index), args) as unknown as Buffer,
      }));

  if (!has.vault) {
    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: mandate, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concat(D_OPEN_VAULT, u16le(index)) as unknown as Buffer,
    }));
  }
  if (!has.log) {
    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: false },
        { pubkey: log, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concat(D_OPEN_LOG, u16le(index)) as unknown as Buffer,
    }));
  }

  tx.feePayer = new PublicKey(prep.feePayer);
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);

  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(readable(sent.error));
  return {
    signature: sent.signature,
    explorer: sent.explorer,
    sponsored: !!sent.sponsored,
    child: mandate.toBase58(),
  };
}

/**
 * Moving value, which the program has always been able to do and the app never
 * offered.
 *
 * A vault that can be paid into and never out of is not a vault, and the
 * reason to have one at all is that an agent trading inside your sentence
 * eventually makes something you want to take home. `withdraw` is owner only
 * in the program, which is the guarantee: the agent has no path to this at
 * any point, expired grant or not.
 *
 * Opening happens on the first deposit rather than as a separate chore, since
 * a vault with nothing in it is not a thing anybody wanted for its own sake.
 */
export type VaultAction = 'deposit' | 'withdraw';

export async function moveVault(
  owner: OwnerSigner,
  action: VaultAction,
  lamports: bigint,
  opts: { needsOpen: boolean },
  index = 0,
): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58(), index });
  if (prep.error) throw new Error(prep.error);

  const vault = vaultPda(owner.publicKey, index);
  const mandate = mandatePda(owner.publicKey, index);
  let tx = new Transaction();
  if (prep.needsTopUp) {
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet),
      toPubkey: owner.publicKey,
      lamports: prep.topUpLamports,
    }));
  }

  if (action === 'deposit' && opts.needsOpen) {
    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: mandate, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concat(D_OPEN_VAULT, u16le(index)) as unknown as Buffer,
    }));
  }

  tx.add(action === 'deposit'
    ? new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: concat(D_DEPOSIT, u16le(index), u64le(lamports)) as unknown as Buffer,
      })
    : new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
        ],
        data: concat(D_WITHDRAW, u16le(index), u64le(lamports)) as unknown as Buffer,
      }));

  tx.feePayer = new PublicKey(prep.feePayer);
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);

  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(readable(sent.error));
  return { signature: sent.signature, explorer: sent.explorer, sponsored: !!sent.sponsored, child: vault.toBase58() };
}

/**
 * Send from the key itself, which is the other half of getting value out.
 *
 * This is a plain system transfer signed by the person whose money it is. The
 * relay will pass it precisely because they signed it and the demo faucet is
 * not party to it.
 */
export async function sendFromKey(
  owner: OwnerSigner,
  to: PublicKey,
  lamports: bigint,
): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58() });
  if (prep.error) throw new Error(prep.error);

  let tx = new Transaction();
  tx.add(SystemProgram.transfer({
    fromPubkey: owner.publicKey, toPubkey: to, lamports: Number(lamports),
  }));
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);

  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(readable(sent.error));
  return { signature: sent.signature, explorer: sent.explorer, sponsored: false, child: to.toBase58() };
}

/**
 * Chain errors, said in words.
 *
 * The one that will actually happen: Solana will not let an account exist
 * holding less than it costs to store, so a small first payment to a fresh
 * address fails with a sentence about rent that means nothing to the person
 * who typed the amount.
 */
function readable(msg: string): string {
  if (/insufficient funds for rent/i.test(msg)) {
    return 'Too small for a new address. Solana will not keep an account holding less than about 0.0009 SOL, so send at least that, or send to an address that already exists.';
  }
  if (/insufficient lamports|debit an account but found no record/i.test(msg)) {
    return 'Not enough in the key to cover that and the fee.';
  }
  if (/blockhash not found/i.test(msg)) {
    return 'That took too long to sign and the network moved on. Try it again.';
  }
  return msg;
}

/** Whether this sleeve already speaks for a sentence. */
export async function hasMandate(connection: Connection, owner: PublicKey, index = 0) {
  return !!(await connection.getAccountInfo(mandatePda(owner, index)));
}

/**
 * The first sleeve with nothing in it.
 *
 * Taking somebody else's sentence used to write it into whichever sleeve
 * happened to be in front, which works exactly once. The second time, and
 * for anybody who had already written a sentence of their own, the account
 * already existed and the whole transaction came back as a System program
 * error zero against an instruction index, which tells a person nothing at
 * all about what went wrong.
 *
 * Adopting should widen the book rather than overwrite it. That is the point
 * of sleeves: one key, several accounts, each with its own sentence and its
 * own record, so a person is not made to choose one rule for everything they
 * own. So this finds the first free one and the caller writes there.
 *
 * Sixteen is a limit rather than a belief about how many anybody wants. It
 * bounds the scan, and a person who has filled sixteen has a different
 * problem than this function can solve.
 */
export async function firstFreeSleeve(
  connection: Connection, owner: PublicKey, max = 16,
): Promise<number | null> {
  for (let i = 0; i < max; i++) {
    if (!(await hasMandate(connection, owner, i))) return i;
  }
  return null;
}


/* ---- deleting, keeping private, and stopping everything ----
 *
 * Three owner-only instructions, sent the same way as everything else here:
 * built on this side, signed by the owner, relayed only after the server has
 * read each instruction back.
 */
const D_CLOSE_SLEEVE = new Uint8Array([211, 223, 241, 155, 247, 14, 26, 104]);
const D_MAKE_PRIVATE = new Uint8Array([24, 194, 92, 182, 123, 211, 83, 22]);
const D_MAKE_PUBLIC = new Uint8Array([41, 76, 102, 98, 184, 102, 132, 29]);
const D_SET_HALTED = new Uint8Array([153, 114, 136, 116, 7, 134, 47, 12]);

export const privatePda = (mandate: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('private'), mandate.toBuffer()], PROGRAM_ID)[0];
const universePda = (mandate: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('universe'), mandate.toBuffer()], PROGRAM_ID)[0];
const spendPda = (owner: PublicKey, index = 0) =>
  PublicKey.findProgramAddressSync([enc('spend'), owner.toBuffer(), indexSeed(index)], PROGRAM_ID)[0];

async function relayOwned(owner: OwnerSigner, ix: TransactionInstruction, index = 0): Promise<AdoptResult> {
  const prep = await post({ phase: 'prepare', owner: owner.publicKey.toBase58(), index });
  if (prep.error) throw new Error(prep.error);
  let tx = new Transaction();
  if (prep.needsTopUp) {
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(prep.faucet), toPubkey: owner.publicKey, lamports: prep.topUpLamports,
    }));
  }
  tx.add(ix);
  tx.feePayer = new PublicKey(prep.feePayer);
  tx.recentBlockhash = prep.blockhash;
  tx = await owner.signTransaction(tx);
  const sent = await post({
    phase: 'send',
    tx: toBase64(new Uint8Array(tx.serialize({ requireAllSignatures: false }))),
  });
  if (sent.error) throw new Error(readable(sent.error));
  return { signature: sent.signature, explorer: sent.explorer, sponsored: !!sent.sponsored, child: '' };
}

/**
 * Delete one sleeve: sentence, vault, log, universe, spend account and the
 * private marker, with every lamport back to the owner's key. The program
 * refuses while the vault is out on the rollup, and says so.
 */
export function closeSleeve(owner: OwnerSigner, index = 0) {
  const o = owner.publicKey;
  const mandate = mandatePda(o, index);
  const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  return relayOwned(owner, new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: o, isSigner: true, isWritable: true },
      w(mandate), w(universePda(mandate)), w(vaultPda(o, index)),
      w(verdictLogPda(o, index)), w(spendPda(o, index)), w(privatePda(mandate)),
    ],
    data: concat(D_CLOSE_SLEEVE, u16le(index)) as unknown as Buffer,
  }), index);
}

/** Keep a sentence out of the room, or offer it again. */
export function setPrivate(owner: OwnerSigner, index: number, isPrivate: boolean) {
  const o = owner.publicKey;
  const mandate = mandatePda(o, index);
  const keys = [
    { pubkey: o, isSigner: true, isWritable: true },
    { pubkey: mandate, isSigner: false, isWritable: false },
    { pubkey: privatePda(mandate), isSigner: false, isWritable: true },
  ];
  if (isPrivate) keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
  return relayOwned(owner, new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: concat(isPrivate ? D_MAKE_PRIVATE : D_MAKE_PUBLIC, u16le(index)) as unknown as Buffer,
  }), index);
}

/**
 * The kill switch. Every path that proposes reads this flag, including a
 * confidential check already in flight, which comes back refused.
 */
export function setHalted(owner: OwnerSigner, index: number, halted: boolean) {
  const o = owner.publicKey;
  return relayOwned(owner, new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: o, isSigner: true, isWritable: false },
      { pubkey: mandatePda(o, index), isSigner: false, isWritable: true },
    ],
    data: concat(D_SET_HALTED, u16le(index), new Uint8Array([halted ? 1 : 0])) as unknown as Buffer,
  }), index);
}

export async function isPrivate(connection: Connection, owner: PublicKey, index = 0) {
  return (await connection.getAccountInfo(privatePda(mandatePda(owner, index)))) !== null;
}
