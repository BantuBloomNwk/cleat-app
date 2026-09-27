import React, { useCallback, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { connection, decodeMandate } from '../lib/chain';
import {
  DELEGATION_PROGRAM, closeSleeve, mandatePda, privatePda, setHalted, setPrivate, vaultPda,
} from '../lib/adopt';
import { tactile } from '../utils/haptics';
import type { useWallet } from '../hooks/useWallet';

type Wallet = ReturnType<typeof useWallet>;

/** How far to look for sleeves this key has opened. The picker allows far fewer. */
const MAX_SLEEVES = 32;

/**
 * The three things only the owner can do, in one place.
 *
 * Stop everything is the kill switch the program has always had and the app
 * never showed. Private keeps a sentence out of the room. Delete takes every
 * sleeve this key opened off the chain and clears this device. Each one is a
 * transaction the owner signs, and each one says what it did.
 */
export const OwnerControls: React.FC<{ wallet: Wallet }> = ({ wallet }) => {
  const signer = wallet.signer;
  const index = wallet.sleeve;
  const [state, setState] = useState<{ exists: boolean; halted: boolean; private: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const read = useCallback(async (): Promise<{ exists: boolean; halted: boolean; private: boolean } | undefined> => {
    if (!signer) return;
    const mandate = mandatePda(signer.publicKey, index);
    const [m, p] = await connection.getMultipleAccountsInfo([mandate, privatePda(mandate)]);
    // Through the decoder, which knows which layouts carry the flag at all.
    const halted = !!m && decodeMandate(new Uint8Array(m.data)).halted;
    const next = { exists: !!m, halted, private: !!p };
    setState(next);
    return next;
  }, [signer, index]);

  useEffect(() => { void read(); }, [read]);

  if (!signer) return null;

  // The relay answers when the transaction is sent, not when it lands, so a
  // read straight afterwards can still see the old state. Poll until the
  // chain agrees, for up to twenty seconds.
  const settle = async (landed: (s: { halted: boolean; private: boolean }) => boolean) => {
    for (let i = 0; i < 20; i++) {
      const s = await read();
      if (s && landed(s)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };

  const run = async (
    label: string,
    fn: () => Promise<unknown>,
    done: string,
    landed: (s: { halted: boolean; private: boolean }) => boolean,
  ) => {
    tactile.mandateAction();
    setBusy(label);
    setNote(null);
    try {
      if (!(await signer.confirm())) { setNote('That was not confirmed, so nothing was sent.'); return; }
      await fn();
      setNote((await settle(landed)) ? done : 'Sent, but the chain has not shown it yet. Check again in a moment.');
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const deleteEverything = async () => {
    tactile.mandateAction();
    setBusy('delete');
    setNote(null);
    try {
      if (!(await signer.confirm())) { setNote('That was not confirmed, so nothing was deleted.'); return; }
      const o = signer.publicKey;
      const ids = Array.from({ length: MAX_SLEEVES }, (_, i) => i);
      const addrs: PublicKey[] = ids.flatMap((i) => [mandatePda(o, i), vaultPda(o, i)]);
      const infos = await connection.getMultipleAccountsInfo(addrs);
      const live = ids.filter((i) => infos[2 * i] || infos[2 * i + 1]);
      const delegated = ids.filter((i) => infos[2 * i + 1]?.owner.equals(DELEGATION_PROGRAM));
      if (delegated.length) {
        setNote(`A vault is still out on the private rollup (sleeve ${delegated.join(', ')}). Release it first, then delete.`);
        return;
      }
      for (const i of live) await closeSleeve(signer, i);
      // Then this device: the passkey reference or wallet address, sealed
      // model keys, sleeve names and settings. Nothing of theirs is left here.
      wallet.forget();
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('cleat_')).forEach((k) => localStorage.removeItem(k));
      } catch { /* storage that will not clear was never written either */ }
      setNote(`Deleted. ${live.length} ${live.length === 1 ? 'sleeve' : 'sleeves'} closed on chain and everything came back to your key.`);
      setTimeout(() => location.reload(), 2500);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <div className="vault-key" id="owner-controls">
      <div className="vault-key-row">
        <span className="vault-key-label">Only you can do these</span>
      </div>

      {state?.exists && (
        <>
          <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
            {state.halted
              ? 'Stopped. Nothing proposes against this sentence until you start it again, including a check already on its way.'
              : 'Stop everything halts every proposal against this sentence at once, including a check already on its way.'}
          </p>
          <div className="vault-buttons">
            <button
              type="button"
              className="mesh-chip"
              aria-pressed={state.halted}
              disabled={!!busy}
              onClick={() => {
                const want = !state.halted;
                void run('halt', () => setHalted(signer, index, want),
                  want ? 'Stopped. Nothing proposes until you start it again.' : 'Started again.',
                  (s) => s.halted === want);
              }}
            >
              {busy === 'halt' ? 'Sending…' : state.halted ? 'Start again' : 'Stop everything'}
            </button>
            <button
              type="button"
              className="mesh-chip"
              aria-pressed={state.private}
              disabled={!!busy}
              onClick={() => {
                const want = !state.private;
                void run('private', () => setPrivate(signer, index, want),
                  want
                    ? 'Out of the room. Nobody can adopt it and Cleat lists it nowhere.'
                    : 'Back in the room. Others can adopt it again.',
                  (s) => s.private === want);
              }}
            >
              {busy === 'private' ? 'Sending…' : state.private ? 'Put it back in the room' : 'Keep it out of the room'}
            </button>
          </div>
          {state.private && (
            <p className="text-[11px] leading-[1.6] text-[var(--text-tertiary)]">
              Private means nobody can adopt it and Cleat shows it nowhere. The account is still on
              Solana, where anyone who goes looking can read it, as with every Solana account.
            </p>
          )}
        </>
      )}

      {!confirming ? (
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!!busy} onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        </div>
      ) : (
        <>
          <p className="text-[12px] leading-[1.6] text-[var(--refused-rust)]">
            This closes every sentence, vault and log this key opened, returns what they held to your
            key, and clears Cleat from this device. It cannot be undone. Transactions already on Solana
            stay in its history, because nothing can remove those.
          </p>
          <div className="vault-buttons">
            <button type="button" className="mesh-chip" disabled={!!busy} onClick={deleteEverything}>
              {busy === 'delete' ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button type="button" className="mesh-chip" disabled={!!busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </>
      )}

      {note && <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]" role="status">{note}</p>}

      <a href="/privacy.html" className="text-[10.5px] font-mono text-[var(--verdigris)] underline underline-offset-2">
        privacy policy
      </a>
    </div>
  );
};
