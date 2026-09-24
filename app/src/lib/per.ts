import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { DELEGATION_PROGRAM, PROGRAM_ID, vaultPda } from './adopt';

/**
 * The private half of the rollup, from the browser.
 *
 * Delegation alone is not the claim. Handing the vault to MagicBlock's
 * rollup makes decisions settle in milliseconds and tells nobody anything;
 * sealing is what the program's own comment calls "the instruction the whole
 * confidentiality claim rests on", because it sets the per member flags that
 * let the owner see balances and leave the agent with only the log. An app
 * that delegates and cannot seal has shipped ER and called it PER.
 *
 * It was a script for a while and the button was taken off the screen, which
 * was the wrong answer twice: the interesting half of the product cannot
 * live in a terminal, and a control removed because its return trip is hard
 * is a control that was never finished.
 *
 * The reason it is hard is worth stating, because it shapes this file. Seal
 * and release are signed against the rollup rather than against base, so
 * none of this can go through the relay that handles every other instruction
 * in the app: the relay talks to base, pays fees there, and the rollup has
 * never heard of it. Here the owner is the fee payer and the owner's own key
 * signs, which is also the honest arrangement, since these are the two
 * instructions that decide who may see the account.
 *
 * Hand rolled rather than imported. The SDK's own client would bring a WASM
 * quote verifier for the attestation check, and adding a WASM module and the
 * content policy to allow it is not a change to make the night before
 * something is due. So this app proves the vault goes into the enclave,
 * seals, and comes back out; scripts/roundtrip.mjs proves the enclave is a
 * real TDX enclave. That division is said on screen rather than glossed.
 */

const ER_URL = 'https://devnet-tee.magicblock.app';

const MAGIC_PROGRAM = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT = new PublicKey('MagicContext1111111111111111111111111111111');
const EPHEMERAL_VAULT = new PublicKey('MagicVau1t999999999999999999999999999999999');
const PERMISSION_PROGRAM = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
// The delegation program's address is imported from adopt rather than
// written out again here. Retyping it produced ...teoAMARRSaeSh instead of
// ...teaAMARRSaeSh, which base58 will happily accept: the vault would have
// read as never delegated and this screen would have offered to delegate an
// already delegated vault for ever. The chain caught it during a test. A
// second copy of a constant is a second chance to get it wrong.

/** Mirrors permissionPdaFromAccount in the rollup SDK. */
const permissionPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('permission:'), account.toBuffer()],
    PERMISSION_PROGRAM,
  )[0];

/** Anchor discriminators, off the deployed IDL. */
const D_SEAL = Uint8Array.of(209, 155, 178, 53, 205, 199, 134, 28);
const D_RELEASE = Uint8Array.of(162, 80, 81, 254, 102, 228, 132, 87);

const u16le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) =>
  ({ pubkey, isSigner, isWritable });

/**
 * A session on the rollup.
 *
 * The enclave will not take a transaction from somebody who has not proved
 * they hold the key: ask for a challenge, sign it, exchange it for a token.
 * Hand rolled from the SDK's own thirty lines rather than imported, so that
 * the browser does not also have to carry everything else in that package.
 */
async function authToken(owner: Keypair): Promise<string> {
  const res = await fetch(
    `${ER_URL}/auth/challenge?pubkey=${encodeURIComponent(owner.publicKey.toBase58())}`,
  );
  const { challenge, error } = (await res.json()) as { challenge?: string; error?: string };
  if (error) throw new Error(`the rollup refused a challenge: ${error}`);
  if (!challenge) throw new Error('the rollup sent no challenge');

  const sig = ed25519.sign(new TextEncoder().encode(challenge), owner.secretKey.slice(0, 32));
  const login = await fetch(`${ER_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pubkey: owner.publicKey.toBase58(),
      challenge,
      signature: bs58.encode(sig),
    }),
  });
  const body = (await login.json()) as { token?: string; error?: string };
  if (login.status !== 200 || !body.token) {
    throw new Error(`the rollup would not start a session: ${body.error ?? login.status}`);
  }
  return body.token;
}

const rollup = async (owner: Keypair) =>
  new Connection(`${ER_URL}?token=${await authToken(owner)}`, 'confirmed');

async function sendToRollup(
  conn: Connection, owner: Keypair, ix: TransactionInstruction,
): Promise<string> {
  const tx = new Transaction().add(ix);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(owner);
  // Preflight is skipped the way the script skips it: the rollup simulates
  // against its own state, and a vault that base still shows as delegated
  // trips simulation while the real send succeeds.
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } catch (e) {
    // The rollup pulls a copy of the program into its own environment before
    // it will run anything against it, and when that copy fails the error
    // names an instruction index inside a transaction the caller never sent.
    // It is not this app, it is not the key, and there is nothing to retry:
    // the rollup cannot read the program as it currently stands on base.
    // Saying that is more use than the raw string.
    const text = String((e as Error)?.message ?? e);
    if (text.includes('Cloner error') || text.includes('Failed to clone program')) {
      throw new Error(
        'The rollup cannot load a copy of the program right now, so nothing ' +
        'was sent. This is on the rollup rather than on your key or this ' +
        'vault, and it started after the program was last redeployed.',
      );
    }
    throw e;
  }
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

export interface PerState {
  /** Base no longer owns the vault, so the rollup has it. */
  delegated: boolean;
  /** What the rollup says the vault holds, which after delegation is the
   *  authoritative number rather than the one on base. */
  rollupLamports: number | null;
  /** The permission account exists, so the flags have been set. */
  sealed: boolean;
}

/** Where the vault actually is, asked of both chains rather than assumed. */
export async function readPer(base: Connection, owner: PublicKey, index = 0): Promise<PerState> {
  const vault = vaultPda(owner, index);
  const onBase = await base.getAccountInfo(vault).catch(() => null);
  const delegated = !!onBase && onBase.owner.equals(DELEGATION_PROGRAM);
  if (!delegated) return { delegated: false, rollupLamports: null, sealed: false };

  // Read only, so no session is needed for this part.
  const peek = new Connection(ER_URL, 'confirmed');
  const [inRollup, perm] = await Promise.all([
    peek.getAccountInfo(vault).catch(() => null),
    peek.getAccountInfo(permissionPda(vault)).catch(() => null),
  ]);
  return {
    delegated: true,
    rollupLamports: inRollup?.lamports ?? null,
    sealed: !!perm,
  };
}

/**
 * Wait for the rollup to admit it has the vault.
 *
 * Delegation is not instant from the rollup's point of view. The account has
 * to be picked up before anything can be written to it there, and a
 * transaction sent into that window comes back as a cloner error naming an
 * instruction index and nothing useful. So ask until it appears rather than
 * guessing at a delay, refreshing the session each time because the wait can
 * outlast a short lived token.
 */
async function waitForPickup(owner: Keypair, vault: PublicKey): Promise<Connection> {
  let conn = await rollup(owner);
  for (let i = 0; i < 20; i++) {
    const seen = await conn.getAccountInfo(vault).catch(() => null);
    if (seen && seen.lamports > 0) return conn;
    await new Promise((r) => setTimeout(r, 1000));
    conn = await rollup(owner);
  }
  throw new Error('The rollup has not picked the vault up yet. Give it a moment and try again.');
}

/**
 * Set the flags. The owner sees balances, the agent sees the log, nobody
 * else is on the list.
 */
export async function sealVault(owner: Keypair, index = 0): Promise<string> {
  const vault = vaultPda(owner.publicKey, index);
  const conn = await waitForPickup(owner, vault);
  return sendToRollup(conn, owner, new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(vault, false, true),
      meta(permissionPda(vault), false, true),
      meta(EPHEMERAL_VAULT, false, true),
      meta(MAGIC_PROGRAM, false, false),
      meta(PERMISSION_PROGRAM, false, false),
    ],
    data: concat(D_SEAL, u16le(index)) as unknown as Buffer,
  }));
}

/** Commit whatever happened inside and hand the vault back to base. */
export async function releaseVault(owner: Keypair, index = 0): Promise<string> {
  const vault = vaultPda(owner.publicKey, index);
  const conn = await rollup(owner);
  return sendToRollup(conn, owner, new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner.publicKey, true, true),
      meta(vault, false, true),
      meta(MAGIC_CONTEXT, false, true),
      meta(MAGIC_PROGRAM, false, false),
    ],
    data: concat(D_RELEASE, u16le(index)) as unknown as Buffer,
  }));
}

/**
 * What a vault needs inside the rollup before it can seal.
 *
 * It sponsors its own permission account, and a vault that is short fails
 * much later with InsufficientFundsForRent against an account index rather
 * than anything naming the vault. Worth checking up front and saying so in
 * words instead.
 */
export const SEAL_FLOOR_LAMPORTS = 5_000_000;
