import React, { useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { WalletState } from './WalletState';
import { VaultKey } from './VaultKey';
import type { Keypair } from '@solana/web3.js';
import { AgentSpend } from './AgentSpend';
import type { WalletState as WalletStatus } from '../hooks/useWallet';
import { DEMO_OWNER } from '../lib/chain';
import { Vibrate, VibrateOff, ShieldCheck, Sparkles } from 'lucide-react';
import { EnforcerStats } from '../types';
import { tactile } from '../utils/haptics';

interface YouTabProps {
  stats: EnforcerStats;
  onOpenOnboarding: () => void;
  activeMandate: string;
  /** Live wallet state, so these rows follow a passkey being made. */
  wallet: WalletStatus;
  /** The key itself, so the vault can actually move value. */
  keypair: Keypair | null;
}

export const YouTab: React.FC<YouTabProps> = ({
  stats,
  onOpenOnboarding,
  activeMandate,
  wallet,
  keypair,
}) => {
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(() => tactile.isVibrationEnabled());
  const [testPulseNotice, setTestPulseNotice] = useState<string | null>(null);

  const handleToggleVibration = () => {
    const nextVal = !vibrationEnabled;
    tactile.setVibrationEnabled(nextVal);
    setVibrationEnabled(nextVal);
    if (nextVal) {
      tactile.ledgerTrigger('refused');
      setTestPulseNotice('Haptic pulse verified');
    } else {
      tactile.selectionTap();
      setTestPulseNotice('Vibrations disabled');
    }
    setTimeout(() => {
      setTestPulseNotice(null);
    }, 2200);
  };
  return (
    <section className="tab-screen active flex flex-col gap-3.5 w-full pb-12" id="view-you">
      <div className="section-row-header">
        <h2 className="section-heading text-[16px] font-bold">Your Enforcer Profile</h2>
        <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
          <span className="section-hint text-[11px]">Cryptographic Identity</span>
        </span>
      </div>

      {/* Three counters, and they are the log's own totals rather than a
          decoration. They come off the chain snapshot the diary reads. */}
      <div className="flex items-center justify-end">
        <DataOrigin origin="chain" />
      </div>

      {/* 3 Metric Summary Boxes */}
      <div className="grid grid-cols-3 gap-2" id="enforcer-stats-grid">
        <div className="bg-[var(--card-surface)] border border-[var(--card-border)] rounded-2xl p-3 text-center shadow-[var(--card-inner-shadow)] backdrop-blur-md">
          <div id="statClearedCount" className="font-mono text-[22px] font-extrabold text-[var(--verdigris)]">
            {stats.cleared}
          </div>
          <div className="font-mono text-[9.5px] text-[var(--text-tertiary)] uppercase tracking-wider mt-0.5">
            Cleared
          </div>
        </div>

        <div className="bg-[var(--card-surface)] border border-[var(--card-border)] rounded-2xl p-3 text-center shadow-[var(--card-inner-shadow)] backdrop-blur-md">
          <div id="statTrimmedCount" className="font-mono text-[22px] font-extrabold text-[var(--trimmed-amber)]">
            {stats.trimmed}
          </div>
          <div className="font-mono text-[9.5px] text-[var(--text-tertiary)] uppercase tracking-wider mt-0.5">
            Trimmed
          </div>
        </div>

        <div className="bg-[var(--card-surface)] border border-[var(--card-border)] rounded-2xl p-3 text-center shadow-[var(--card-inner-shadow)] backdrop-blur-md">
          <div id="statRefusedCount" className="font-mono text-[22px] font-extrabold text-[var(--refused-rust)]">
            {stats.refused}
          </div>
          <div className="font-mono text-[9.5px] text-[var(--text-tertiary)] uppercase tracking-wider mt-0.5">
            Refused
          </div>
        </div>
      </div>

      {/* Security & Enclave Card */}
      <VaultKey
        address={wallet.status === 'ready' ? wallet.address : null}
        keypair={keypair}
      />

      <WalletState wallet={wallet} fallbackOwner={DEMO_OWNER} />

      <AgentSpend owner={wallet.status === 'ready' ? wallet.address : DEMO_OWNER} />

      <div className="flex items-center justify-end -mb-1">
        <DataOrigin origin="sample" />
      </div>

      <article className="glass-card flex flex-col gap-3" id="security-enclave-card">
        <div className="card-topbar">
          <span className="meta-kicker">Settings &amp; Privacy</span>
          <span className="immutable-chip">Zero Visibility Proof</span>
        </div>

        <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
          What we can and cannot see: Your private balances, keys, and specific order books remain mathematically blinded. Only compliance predicates are verified.
        </p>

        {/* Settings: Haptic Enforcer Vibration Toggle */}
        <div className="p-3 rounded-2xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg border ${vibrationEnabled ? 'bg-[var(--verdigris-chip-bg)] border-[var(--verdigris-chip-border)] text-[var(--verdigris)]' : 'bg-[var(--card-surface)] border-[var(--card-border)] text-[var(--text-tertiary)]'}`}>
                {vibrationEnabled ? <Vibrate size={15} /> : <VibrateOff size={15} />}
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-[var(--text-primary)]">
                  Enforcer Haptic Vibrations
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Tactile feedback on order refusals, slider ticks, and boundary triggers
                </span>
              </div>
            </div>

            {/* Toggle Switch */}
            <button
              id="toggle-haptic-enforcer"
              type="button"
              role="switch"
              aria-checked={vibrationEnabled}
              aria-label="Toggle enforcer vibration haptics"
              onClick={handleToggleVibration}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--verdigris)] focus:ring-offset-2 focus:ring-offset-[var(--card-surface)] ${
                vibrationEnabled ? 'bg-[var(--verdigris)]' : 'bg-[var(--card-border)]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  vibrationEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 text-[10.5px] font-mono text-[var(--text-tertiary)] border-t border-[var(--card-border-subtle)]/60">
            <span>Hardware Vibration Status:</span>
            <span className={vibrationEnabled ? 'text-[var(--verdigris)] font-bold' : 'text-[var(--text-tertiary)]'}>
              {testPulseNotice || (vibrationEnabled ? 'Active (Saved in LocalStorage)' : 'Muted')}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 font-mono text-[11px]">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
            <span className="text-[var(--text-secondary)]">Hardware Enclave:</span>
            {/* This browser is not an enclave and cannot attest that it is one.
                The attested hardware is the rollup a sealed vault delegates to,
                which is checkable on chain, unlike anything this tab could
                claim about the machine it is running on. */}
            <span className="text-[var(--text-tertiary)] font-bold">
              Not this device
            </span>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
            <span className="text-[var(--text-secondary)]">Passkey Credential:</span>
            <span className="text-[var(--text-primary)] font-bold">WebAuthn Bound</span>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
            <span className="text-[var(--text-secondary)]">On-Chain State:</span>
            <span className="text-[var(--verdigris)] font-bold">Synchronized (v2.4)</span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--card-border-subtle)]">
          <div className="text-[11px] font-mono text-[var(--text-tertiary)] mb-1">
            Current Bound Sentence:
          </div>
          <div className="font-mandate italic text-[14px] text-[var(--text-primary)] bg-[var(--card-surface-raised)] p-2.5 rounded-xl border border-[var(--card-border-subtle)]">
            “{activeMandate}”
          </div>
        </div>

        <button
          id="btn-replay-walkthrough"
          type="button"
          className="btn-ember w-full mt-2 justify-center"
          onClick={onOpenOnboarding}
        >
          Replay 3-Step Onboarding Walkthrough
        </button>
      </article>
    </section>
  );
};
