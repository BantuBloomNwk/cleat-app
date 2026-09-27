import type { PublicKey, Transaction } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { confirmPresence, deriveLocalSecretKey } from './passkey';

/**
 * Whoever owns the mandate, however they hold the key.
 *
 * There are two ways in. A passkey derives a keypair on this device and the
 * app signs with it directly. A wallet, which on a Seeker means the Seed
 * Vault Wallet over Mobile Wallet Adapter, holds the key itself and is asked
 * for each signature. Everything that writes to chain takes one of these and
 * cannot tell which door the person came through.
 */
export interface OwnerSigner {
  publicKey: PublicKey;
  via: 'passkey' | 'wallet';
  /** Adds the owner's signature and leaves any others in place. */
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** Raw bytes in, a 64 byte ed25519 signature out. */
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
  /** The AES key that seals model API keys in this browser. */
  localSecret(): Promise<CryptoKey>;
  /**
   * The person is here, before anything is built. A passkey asks for a face
   * or a finger. A wallet asks in its own prompt when it signs, so for a
   * wallet this is already true.
   */
  confirm(): Promise<boolean>;
}

export function keypairSigner(kp: Keypair): OwnerSigner {
  return {
    publicKey: kp.publicKey,
    via: 'passkey',
    async signTransaction(tx) {
      tx.partialSign(kp);
      return tx;
    },
    async signMessage(bytes) {
      return ed25519.sign(bytes, kp.secretKey.slice(0, 32));
    },
    localSecret: deriveLocalSecretKey,
    confirm: confirmPresence,
  };
}

/**
 * A wallet will not hand over a secret, but ed25519 signing is deterministic:
 * the same key signing the same bytes gives the same signature every time.
 * So a key derived from a signature over one fixed message is stable for
 * that wallet and never leaves it in a form that could sign anything else.
 */
const LOCAL_SECRET_MESSAGE = new TextEncoder().encode(
  'Cleat: unlock the model keys stored in this browser. This signature moves nothing.',
);

export async function secretFromSignature(
  sign: (b: Uint8Array) => Promise<Uint8Array>,
): Promise<CryptoKey> {
  const sig = await sign(LOCAL_SECRET_MESSAGE);
  const base = await crypto.subtle.importKey('raw', sig as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('cleat-local-secret') as BufferSource,
      info: new TextEncoder().encode('model-keys-v1') as BufferSource,
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
