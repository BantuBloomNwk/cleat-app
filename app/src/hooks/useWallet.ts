import { useCallback, useEffect, useState } from 'react';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  createWallet,
  unlockWallet,
  restoreWallet,
  hasWallet,
  forgetLocal,
  passkeySupported,
  platformAuthenticatorAvailable,
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

  return {
    state,
    keypair,
    create: useCallback(() => run(createWallet), [run]),
    unlock: useCallback(() => run(unlockWallet), [run]),
    restore: useCallback(() => run(restoreWallet), [run]),
    signOut: useCallback(() => {
      setKeypair(null);
      setState(hasWallet() ? { status: 'locked' } : { status: 'none' });
    }, []),
    forget: useCallback(() => {
      forgetLocal();
      setKeypair(null);
      setState({ status: 'none' });
    }, []),
  };
}
