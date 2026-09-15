import React, { useEffect, useState } from 'react';
import { hasWallet, passkeySupported, platformAuthenticatorAvailable } from '../lib/passkey';
import { connection, mandatePda, vaultPda, verdictLogPda } from '../lib/chain';
import { DataOrigin } from './DataOrigin';
import { PublicKey } from '@solana/web3.js';

/**
 * What actually exists, on this device and on the chain.
 *
 * The You tab was the shortest screen in the app and every line of it was
 * written. That is the wrong way round: this is the one tab that is about the
 * reader rather than about the market, so it is the one where invented numbers
 * are least forgivable.
 *
 * Nothing here is a claim. Whether a passkey wallet exists is a question for
 * this browser, and whether a vault, a mandate and a log exist is a question
 * for the chain. Both get asked rather than assumed, and when the answer is
 * "you have not set anything up yet" it says that instead of showing a
 * plausible profile.
 */
interface OnChain {
  vault: boolean;
  mandate: boolean;
  log: boolean;
  lamports: number;
}

export const WalletState: React.FC<{ owner?: PublicKey }> = ({ owner }) => {
  const [wallet, setWallet] = useState<boolean | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [chain, setChain] = useState<OnChain | null>(null);

  useEffect(() => {
    setWallet(hasWallet());
    setSupported(passkeySupported());
    platformAuthenticatorAvailable().then(setPlatform).catch(() => setPlatform(false));
  }, []);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    (async () => {
      try {
        const [v, m, l] = await Promise.all([
          connection.getAccountInfo(vaultPda(owner)),
          connection.getAccountInfo(mandatePda(owner)),
          connection.getAccountInfo(verdictLogPda(owner)),
        ]);
        if (!live) return;
        setChain({
          vault: !!v,
          mandate: !!m,
          log: !!l,
          lamports: v?.lamports ?? 0,
        });
      } catch {
        if (live) setChain(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [owner]);

  const Row: React.FC<{ label: string; yes: boolean | null; detail: string }> = ({
    label,
    yes,
    detail,
  }) => (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background:
              yes === null
                ? 'var(--text-tertiary)'
                : yes
                  ? 'var(--verdigris)'
                  : 'var(--trimmed-amber)',
          }}
        />
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {label}
        </span>
      </span>
      <span className="text-[11px] leading-[1.6] text-[var(--text-secondary)] pl-3">
        {detail}
      </span>
    </div>
  );

  return (
    <article className="glass-card flex flex-col gap-2.5" id="wallet-state">
      <div className="card-topbar">
        <span className="meta-kicker">What you actually have</span>
        <DataOrigin origin="chain" />
      </div>

      <Row
        label="This device can hold a key"
        yes={supported === null ? null : supported && platform !== false}
        detail={
          supported === false
            ? 'This browser has no passkey support, so a wallet would have to live somewhere less safe. Try a current Chrome, Safari or Edge.'
            : platform === false
              ? 'No fingerprint or face unlock is available here, so a key could be made but not held by the hardware.'
              : 'A key can be created and kept by the hardware, never leaving the device and never written down as a phrase.'
        }
      />

      <Row
        label="You have a wallet on this device"
        yes={wallet}
        detail={
          wallet
            ? 'Created here and unlocked by your own fingerprint or face. Nobody at this company holds it and there is no copy on a server.'
            : 'Not yet. One is made the first time you set up, and it is the only thing that can move money out of a vault.'
        }
      />

      <Row
        label="A vault exists for the account being read"
        yes={chain === null ? null : chain.vault}
        detail={
          chain === null
            ? 'Asking the chain.'
            : chain.vault
              ? `Holding ${(chain.lamports / 1e9).toFixed(4)} SOL on devnet, which only the owner's key can withdraw. No ceiling on that and no agent in the path.`
              : 'No vault yet. It is the account that holds the money and carries the agent grant.'
        }
      />

      <Row
        label="A mandate is in force"
        yes={chain === null ? null : chain.mandate}
        detail={
          chain === null
            ? 'Asking the chain.'
            : chain.mandate
              ? 'The sentence is on chain and only the owner can edit it. Every proposal is checked against it.'
              : 'No mandate yet, so there is nothing for an agent to be bounded by.'
        }
      />

      <Row
        label="Decisions are being recorded"
        yes={chain === null ? null : chain.log}
        detail={
          chain === null
            ? 'Asking the chain.'
            : chain.log
              ? 'Every verdict lands in a ring buffer anyone can read, with no ticker and no amount in it.'
              : 'No log yet. It is opened once and then written to by the program, never by us.'
        }
      />
    </article>
  );
};
