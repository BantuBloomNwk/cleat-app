import { PublicKey, Transaction } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import {
  registerMwa,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-standard-mobile';
import { secretFromSignature, type OwnerSigner } from './signer';

/**
 * The second way in: a wallet the person already has.
 *
 * Two mechanisms, one registry. On a desktop, or inside a wallet's own
 * browser, Phantom, Solflare and Backpack register themselves as Wallet
 * Standard wallets and we read the list. On Android, including the Seeker,
 * registerMwa() adds a Mobile Wallet Adapter entry to the same list, and
 * connecting it opens the installed wallet app. On a Seeker that is the Seed
 * Vault Wallet, which is where the hardware custody lives. A dApp never talks
 * to Seed Vault directly; Solana Mobile's docs say to go through MWA.
 *
 * iPhones cannot do MWA, because iOS suspends the background socket it
 * needs, so nothing is registered there and the copy says so.
 */

const CHAIN = 'solana:devnet';
const LS_ADDR = 'cleat_wallet_addr';

type Account = { publicKey: Uint8Array; address: string };
type StandardWallet = {
  name: string;
  icon?: string;
  chains?: readonly string[];
  accounts?: readonly Account[];
  features: Record<string, unknown>;
};

type SignTx = {
  signTransaction: (
    ...inputs: { account: Account; transaction: Uint8Array; chain?: string }[]
  ) => Promise<{ signedTransaction: Uint8Array }[]>;
};
type SignMsg = {
  signMessage: (
    ...inputs: { account: Account; message: Uint8Array }[]
  ) => Promise<{ signature: Uint8Array }[]>;
};

export const isAndroid = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

let registered = false;
function ensureRegistered() {
  if (registered || !isAndroid()) return;
  registered = true;
  try {
    registerMwa({
      appIdentity: {
        uri: location.origin,
        icon: '/icon-192.png',
        name: 'Cleat',
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: [CHAIN],
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });
  } catch {
    registered = false;
  }
}

/**
 * Wallets that can do everything Cleat asks of one. Transaction signing is
 * for every write. Message signing is for the rollup's login and for the key
 * that seals model API keys. A wallet missing either would connect and then
 * fail at the first real step, which reads like our bug.
 */
function usable(): StandardWallet[] {
  const all = getWallets().get() as unknown as StandardWallet[];
  const seen = new Set<string>();
  return all.filter((w) => {
    const ok =
      !!w.features['standard:connect'] &&
      !!w.features['solana:signTransaction'] &&
      !!w.features['solana:signMessage'] &&
      (w.chains ?? []).some((c) => String(c).startsWith('solana:'));
    if (!ok || seen.has(w.name)) return false;
    seen.add(w.name);
    return true;
  });
}

export function walletsAvailable(): boolean {
  ensureRegistered();
  return isAndroid() || usable().length > 0;
}

/** Said instead of a button that does nothing. */
export function noWalletMessage(): string {
  if (isIOS()) {
    return "iPhones cannot open a wallet app from a browser. Open Cleat inside your wallet's own browser, or use a passkey.";
  }
  return 'No Solana wallet in this browser. Install Phantom, Solflare or Backpack and reload, or use a passkey.';
}

export function rememberedWallet(): string | null {
  try {
    return localStorage.getItem(LS_ADDR);
  } catch {
    return null;
  }
}

export async function connectWallet(): Promise<OwnerSigner> {
  ensureRegistered();
  const list = usable();
  if (!list.length) throw new Error(noWalletMessage());
  // On Android the MWA entry is the one that reaches the installed wallet.
  const wallet =
    (isAndroid() && list.find((w) => /mobile wallet adapter/i.test(w.name))) || list[0];

  const connect = wallet.features['standard:connect'] as {
    connect: () => Promise<{ accounts: readonly Account[] }>;
  };
  const { accounts } = await connect.connect();
  const account = accounts[0];
  if (!account) throw new Error(`${wallet.name} connected but gave back no account.`);
  const publicKey = new PublicKey(account.publicKey);
  try {
    localStorage.setItem(LS_ADDR, publicKey.toBase58());
  } catch {
    /* only a hint for next time */
  }

  const refused = (e: unknown) =>
    new Error(`${wallet.name} would not sign: ${(e as Error)?.message || 'no reason given'}`);

  const signMessage = async (bytes: Uint8Array) => {
    let out;
    try {
      out = await (wallet.features['solana:signMessage'] as SignMsg).signMessage({ account, message: bytes });
    } catch (e) {
      throw refused(e);
    }
    const sig = out?.[0]?.signature;
    // Some wallets resolve with nothing rather than rejecting.
    if (!sig?.length) throw new Error(`${wallet.name} gave back no signature.`);
    return new Uint8Array(sig);
  };

  let secret: Promise<CryptoKey> | null = null;

  return {
    publicKey,
    via: 'wallet',
    async signTransaction(tx: Transaction) {
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      let out;
      try {
        out = await (wallet.features['solana:signTransaction'] as SignTx).signTransaction({
          account,
          transaction: new Uint8Array(bytes),
          chain: CHAIN,
        });
      } catch (e) {
        throw refused(e);
      }
      const signed = out?.[0]?.signedTransaction;
      if (!signed?.length) throw new Error(`${wallet.name} gave back no transaction.`);
      return Transaction.from(signed);
    },
    signMessage,
    // One prompt per session, not one per stored key.
    localSecret() {
      secret ??= secretFromSignature(signMessage).catch((e) => {
        secret = null;
        throw e;
      });
      return secret;
    },
    confirm: async () => true,
  };
}

export function forgetWallet() {
  try {
    localStorage.removeItem(LS_ADDR);
  } catch {
    /* nothing stored is the outcome asked for */
  }
}

// Registered at load, so the entry exists before any button can be tapped.
ensureRegistered();
