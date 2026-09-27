import { useCallback, useEffect, useState } from 'react';
import type { PublicKey } from '@solana/web3.js';
import {
  createWallet,
  unlockWallet,
  restoreWallet,
  hasWallet,
  forgetLocal,
  passkeySupported,
  platformAuthenticatorAvailable,
  passkeyHelp,
} from '../lib/passkey';
import {
  listSleeves,
  activeSleeve,
  setActiveSleeve,
  addSleeve as addSleeveStored,
  renameSleeve as renameSleeveStored,
  forgetSleeve as forgetSleeveStored,
  type Sleeve,
} from '../lib/sleeves';
import { keypairSigner, type OwnerSigner } from '../lib/signer';
import { connectWallet, forgetWallet, rememberedWallet, walletsAvailable } from '../lib/mwa';
import { setLocalSecretSource } from '../lib/models';

export type WalletState =
  | { status: 'unsupported'; reason: string }
  | { status: 'none' }
  /** A key was used here before. `via` says which door opens it again. */
  | { status: 'locked'; via: 'passkey' | 'wallet' }
  | { status: 'unlocking' }
  | { status: 'ready'; address: PublicKey; via: 'passkey' | 'wallet' }
  | { status: 'error'; message: string };

/**
 * The owner's key, and the only thing in this app that can move money.
 *
 * The secret is not held any longer than a call needs it. The address is
 * what the interface wants; the key itself comes back from the passkey at
 * the moment something has to be signed.
 */
/** Where the app rests with no key unlocked: which door, if any, was used before. */
function resting(): WalletState {
  if (hasWallet()) return { status: 'locked', via: 'passkey' };
  if (rememberedWallet()) return { status: 'locked', via: 'wallet' };
  return { status: 'none' };
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({ status: 'none' });
  const [signer, setSigner] = useState<OwnerSigner | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  const canWallet = walletsAvailable();
  /**
   * Which sleeve is in front.
   *
   * One key, several accounts. The index goes into the seeds of the mandate,
   * the vault and the log, so switching does not change the address or ask
   * for a face, it changes which of this key's accounts the app is reading.
   */
  const [sleeves, setSleeves] = useState<Sleeve[]>(() => listSleeves());
  const [sleeve, setSleeve] = useState<number>(() => activeSleeve());

  useEffect(() => {
    let live = true;
    (async () => {
      const passkeys = passkeySupported() && (await platformAuthenticatorAvailable());
      if (live) setCanPasskey(passkeys);
      // A phone that cannot make a passkey can still have a wallet, and on a
      // Seeker the wallet is the better door anyway.
      if (!passkeys && !canWallet) {
        if (live) {
          setState({
            status: 'unsupported',
            reason: passkeyHelp('browser'),
          });
        }
        return;
      }
      if (live) setState(resting());
    })();
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<OwnerSigner>) => {
    setState({ status: 'unlocking' });
    try {
      const sg = await fn();
      setSigner(sg);
      setLocalSecretSource(sg.via === 'wallet' ? sg.localSecret : null);
      setState({ status: 'ready', address: sg.publicKey, via: sg.via });
      return sg;
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
      return null;
    }
  }, []);

  return {
    state,
    signer,
    canPasskey,
    canWallet,
    sleeve,
    sleeves,
    select: useCallback((index: number) => {
      setActiveSleeve(index);
      setSleeve(index);
    }, []),
    addSleeve: useCallback((name: string) => {
      const made = addSleeveStored(name);
      setSleeves(listSleeves());
      setActiveSleeve(made.index);
      setSleeve(made.index);
      return made;
    }, []),
    rename: useCallback((index: number, name: string) => {
      renameSleeveStored(index, name);
      setSleeves(listSleeves());
    }, []),
    removeSleeve: useCallback((index: number) => {
      forgetSleeveStored(index);
      setSleeves(listSleeves());
      setSleeve(activeSleeve());
    }, []),
    create: useCallback(() => run(async () => keypairSigner(await createWallet())), [run]),
    unlock: useCallback(
      () =>
        run(async () =>
          state.status === 'locked' && state.via === 'wallet'
            ? connectWallet()
            : keypairSigner(await unlockWallet()),
        ),
      [run, state],
    ),
    restore: useCallback(() => run(async () => keypairSigner(await restoreWallet())), [run]),
    connect: useCallback(() => run(connectWallet), [run]),
    signOut: useCallback(() => {
      setSigner(null);
      setLocalSecretSource(null);
      setState(resting());
    }, []),
    forget: useCallback(() => {
      if (signer?.via === 'wallet') forgetWallet();
      else forgetLocal();
      setSigner(null);
      setLocalSecretSource(null);
      setState(resting());
    }, [signer]),
  };
}
