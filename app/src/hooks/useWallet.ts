import { useCallback, useEffect, useState } from 'react';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  createWallet,
  unlockWallet,
  restoreWallet,
  hasWallet,
  forgetLocal,
  clearSessionRoot,
  passkeySupported,
  platformAuthenticatorAvailable,
  listSleeves,
  activeSleeve,
  setActiveSleeve,
  addSleeve,
  renameSleeve as renameSleeveStored,
  forgetSleeve as forgetSleeveStored,
  deriveSleeve,
  type Sleeve,
} from '../lib/passkey';

export type WalletState =
  | { status: 'unsupported'; reason: string }
  | { status: 'none' }
  | { status: 'locked' }
  | { status: 'unlocking' }
  | { status: 'ready'; address: PublicKey }
  | { status: 'error'; message: string };

/**
 * The owner's key, and the only thing in this app that can move money.
 *
 * The secret is not held any longer than a call needs it. The address is
 * what the interface wants; the key itself comes back from the passkey at
 * the moment something has to be signed.
 */
export function useWallet() {
  const [state, setState] = useState<WalletState>({ status: 'none' });
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  /**
   * Which sleeve is in front.
   *
   * Each one is a separate owner key derived from the same passkey, so
   * switching is not a filter over one account, it is a different account
   * entirely: its own mandate, its own vault, its own log.
   */
  const [sleeves, setSleeves] = useState<Sleeve[]>(() => listSleeves());
  const [sleeve, setSleeve] = useState<number>(() => activeSleeve());

  useEffect(() => {
    let live = true;
    (async () => {
      if (!passkeySupported() || !(await platformAuthenticatorAvailable())) {
        if (live) {
          setState({
            status: 'unsupported',
            reason:
              'This browser cannot do passkeys. On an iPhone, open Cleat in Safari and add it to your Home Screen.',
          });
        }
        return;
      }
      if (live) setState(hasWallet() ? { status: 'locked' } : { status: 'none' });
    })();
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<Keypair>) => {
    setState({ status: 'unlocking' });
    try {
      const kp = await fn();
      setKeypair(kp);
      setState({ status: 'ready', address: kp.publicKey });
      return kp;
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
      return null;
    }
  }, []);

  /**
   * Move to another sleeve.
   *
   * No prompt when the session already holds the root, which is the whole
   * point: looking at four sleeves should not be four requests for a face.
   * Anything that writes asks again regardless.
   */
  const select = useCallback(
    async (index: number) => {
      setActiveSleeve(index);
      setSleeve(index);
      if (state.status !== 'ready' && !keypair) return null;
      return run(() => deriveSleeve(index));
    },
    [run, state.status, keypair],
  );

  return {
    state,
    keypair,
    sleeve,
    sleeves,
    create: useCallback(() => run(createWallet), [run]),
    unlock: useCallback(() => run(() => unlockWallet(sleeve)), [run, sleeve]),
    restore: useCallback(() => run(() => restoreWallet(sleeve)), [run, sleeve]),
    select,
    addSleeve: useCallback(
      async (name: string) => {
        const made = addSleeve(name);
        setSleeves(listSleeves());
        await select(made.index);
        return made;
      },
      [select],
    ),
    rename: useCallback((index: number, name: string) => {
      renameSleeveStored(index, name);
      setSleeves(listSleeves());
    }, []),
    removeSleeve: useCallback(
      async (index: number) => {
        forgetSleeveStored(index);
        setSleeves(listSleeves());
        await select(activeSleeve());
      },
      [select],
    ),
    signOut: useCallback(() => {
      clearSessionRoot();
      setKeypair(null);
      setState(hasWallet() ? { status: 'locked' } : { status: 'none' });
    }, []),
    forget: useCallback(() => {
      forgetLocal();
      setKeypair(null);
      setSleeves(listSleeves());
      setSleeve(0);
      setState({ status: 'none' });
    }, []),
  };
}
