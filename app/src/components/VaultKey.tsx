import React, { useEffect, useState } from 'react';
import type { PublicKey } from '@solana/web3.js';
import { connection } from '../lib/chain';
import { tactile } from '../utils/haptics';

/**
 * The key, its balance, and how to put something in it.
 *
 * There was no way to find out what address this app had made for you, which
 * meant there was no way to fund it either. A wallet you cannot see the
 * address of is not a wallet, it is a secret the app is keeping from the
 * person it belongs to.
 *
 * Receive only. Sending from here is not offered because nothing in this
 * product moves value out of a vault toward anybody, and a send box would
 * suggest otherwise.
 */
export const VaultKey: React.FC<{ address: PublicKey | null }> = ({ address }) => {
  const [lamports, setLamports] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) { setLamports(null); return; }
    let live = true;
    const read = () =>
      connection.getBalance(address)
        .then((b) => { if (live) setLamports(b); })
        .catch(() => {});
    read();
    // Slow on purpose. A balance that updates every second is a balance being
    // watched, and the proxy behind it is not a subscription.
    const t = setInterval(read, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [address]);

  if (!address) {
    return (
      <div className="vault-key">
        <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
          No key on this device yet. Set one up and it is made by the hardware,
          never written down as a phrase and never sent anywhere.
        </p>
      </div>
    );
  }

  const b58 = address.toBase58();
  const sol = lamports === null ? null : lamports / 1e9;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b58);
      tactile.selectionTap();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* a browser that will not copy is not worth an error message */ }
  };

  return (
    <div className="vault-key">
      <div className="vault-key-row">
        <span className="vault-key-label">Your key</span>
        <span className="vault-key-balance">
          {sol === null ? 'reading…' : `${sol.toFixed(4)} SOL`}
        </span>
      </div>

      <button type="button" className="vault-key-address" onClick={copy} title="Copy the address">
        <span>{b58}</span>
        <span className="vault-key-copy">{copied ? 'copied' : 'copy'}</span>
      </button>

      {sol !== null && sol < 0.01 && (
        <p className="text-[11px] leading-[1.6] text-[var(--text-secondary)]">
          Nothing in it yet. Writing a sentence costs rent, and on devnet that
          is free to get: paste the address into{' '}
          <a
            href="https://faucet.solana.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--verdigris)] underline underline-offset-2"
          >
            faucet.solana.com
          </a>
          . If you would rather not, the demo covers it and says so when it does.
        </p>
      )}

      <p className="text-[10.5px] leading-[1.6] text-[var(--text-tertiary)]">
        Receive only. Nothing in this product moves value out of a vault toward
        an agent, an owner or us, so there is no send here to imply otherwise.
      </p>
    </div>
  );
};
