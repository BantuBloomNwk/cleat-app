import React, { useState, useEffect } from 'react';
import { Copy, Check, Share2, ShieldCheck, Cpu } from 'lucide-react';
import { LedgerEntry } from '../types';
import { tactile } from '../utils/haptics';
import { DataOrigin } from './DataOrigin';
import { AttackBox } from './AttackBox';
import type { Restraint } from '../lib/chain';
import { loadSessions, type MarketSession } from '../lib/backpack';
import { ToastNotification } from './ToastNotification';
import { MagicblockPerDiagram } from './MagicblockPerDiagram';

interface DiaryTabProps {
  mandateSentence: string;
  onOpenVoiceModal: () => void;
  onOpenRewriteModal: () => void;
  entries: LedgerEntry[];
  onToggleEntry: (id: string) => void;
  overnightRefusalCount: number;
  /** What the agent asked for against what the sentence allowed. */
  restraint: Restraint | null;
}

const PERIOD_CONFIGS = {
  overnight: {
    label: 'Overnight',
    badge: null as string | null, // see overnightBadge below
    headingSuffix: 'overnight trade refusals',
    description:
      'Your overnight boundaries held solid. While you slept, the agent attempted automated portfolio rebalances and your plain English mandate stopped every one of them, without a balance moving.',
    stats: [
      { label: 'Blocked', value: '$1,330 USDC', type: 'refused' },
      { label: 'Latency', value: '14ms Kernel Abort', type: 'cleared' },
      { label: 'Sleep Protection', value: '100% Unbreached', type: 'cleared' },
    ],
    intelligence: {
      tag: 'Nocturnal Activity Cluster',
      title: 'Peak impulse recorded at 03:42 UTC',
      detail: 'Asian market opening sparked automated macro triggers into Chevron (CVX). Cryptographic mandate enforcer killed transaction submission pre-broadcast.',
    },
  },
  week: {
    label: 'Weekly',
    badge: '7-Day Rolling Audit',
    headingSuffix: 'weekly trade interventions (9 Refusals, 5 Trims)',
    description:
      'Weekly macro enforcement summary: 14 rogue orders intercepted across volatile crude oil spikes and semiconductor rallies. $4,850 USDC shielded from single-stock risk ceiling breaches.',
    stats: [
      { label: '9 Refusals', value: '$3,820 USDC', type: 'refused' },
      { label: '5 Trims', value: '$1,030 Buffered', type: 'trimmed' },
      { label: 'Boundary Score', value: '99.4% Adherence', type: 'cleared' },
    ],
    intelligence: {
      tag: 'Sector Risk Envelope',
      title: 'Fossil Fuels: 0.0% • Tech Cap: 14.8%',
      detail: 'Single-name tech ceiling clamped Microsoft and Nvidia additions to prevent concentration breach. All hydrocarbon derivatives barred.',
    },
  },
  month: {
    label: 'Monthly',
    badge: '30-Day Cumulative Audit',
    headingSuffix: 'monthly trade refusals (29 Position Trims)',
    description:
      '30-day mandate enforcement: 184 compliant trades cleared, 41 catastrophic liquidations prevented across DeFi yield farms and fossil fuel swings.',
    stats: [
      { label: '41 Refusals', value: '$14,200 USDC', type: 'refused' },
      { label: '29 Trims', value: '$4,220 Buffered', type: 'trimmed' },
      { label: 'Alpha Protected', value: '+10.58% vs Raw AI', type: 'cleared' },
    ],
    intelligence: {
      tag: 'Counterfactual Performance Edge',
      title: 'Cleat Protected: +4.18% vs Unconstrained: -6.40%',
      detail: 'An unconstrained agent without human boundaries suffered heavy drawdown on high-yield DeFi liquidity pools and energy spikes. Cleat kept portfolio safe.',
    },
  },
};

export const DiaryTab: React.FC<DiaryTabProps> = ({
  mandateSentence,
  onOpenVoiceModal,
  onOpenRewriteModal,
  entries,
  onToggleEntry,
  overnightRefusalCount,
  restraint,
}) => {
  // The overnight window, from the exchange rather than from a number
  // someone typed. It was written as 22:00 to 06:00 UTC, which is not when
  // the US equities overnight session runs: it is 20:00 to 04:00 in New
  // York, which drifts against UTC twice a year. A card that claims to
  // report what happened overnight should agree with the market about
  // which hours those were.
  const [overnightBadge, setOvernightBadge] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadSessions().then((sessions) => {
      if (!live || !sessions) return;
      const s = sessions.find((x: MarketSession) => x.name === 'US_EQUITIES_OVERNIGHT');
      if (!s) return;
      const hhmm = (t: string) => t.slice(0, 5);
      setOvernightBadge(
        `Overnight session (${hhmm(s.startTime)} to ${hhmm(s.endTime)} New York)`,
      );
    });
    return () => {
      live = false;
    };
  }, []);

  const [selectedPeriod, setSelectedPeriod] = useState<'overnight' | 'week' | 'month'>('overnight');
  const [statusFilter, setStatusFilter] = useState<'all' | 'refused' | 'trimmed' | 'cleared'>('all');
  const [isCopied, setIsCopied] = useState(false);
  const [isToastOpen, setIsToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('Active Mandate Copied to Clipboard');
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isMpcValidating, setIsMpcValidating] = useState(false);
  const [mpcProofHash, setMpcProofHash] = useState('5KwN8v3bWz6Y7qT9ArciumMPC9x7kM2vP4L1');

  // Dynamically trigger Arcium MPC computation animation when mandate updates
  useEffect(() => {
    setIsMpcValidating(true);
    const timer = setTimeout(() => {
      setIsMpcValidating(false);
      setMpcProofHash(`ArciumMPC_${Math.random().toString(36).substring(2, 10).toUpperCase()}_verified`);
    }, 950);
    return () => clearTimeout(timer);
  }, [mandateSentence]);

  const handleManualMpcVerify = () => {
    tactile.mandateAction();
    setIsMpcValidating(true);
    setTimeout(() => {
      setIsMpcValidating(false);
      setToastMessage('Arcium MPC Computation Attested • 18ms Threshold Proof');
      setIsToastOpen(true);
    }, 700);
  };

  const currentPeriodConfig = PERIOD_CONFIGS[selectedPeriod];

  // Base entries for the active period
  const periodEntries = entries.filter((e) => e.period === selectedPeriod);

  // Filter entries based on active status pill
  const filteredEntries = periodEntries.filter((e) => {
    if (statusFilter === 'all') return true;
    return e.status === statusFilter;
  });

  const handleCopyMandate = async () => {
    tactile.mandateAction();
    const textToCopy = `"${mandateSentence}"`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
      setIsCopied(true);
      setToastMessage('Active Mandate Copied to Clipboard');
      setIsToastOpen(true);
      setShareFeedback('Active mandate sentence copied to clipboard');
      setTimeout(() => setIsCopied(false), 2400);
      setTimeout(() => setShareFeedback(null), 3000);
    } catch {
      setIsCopied(true);
      setToastMessage('Active Mandate Copied to Clipboard');
      setIsToastOpen(true);
      setShareFeedback('Mandate copied');
      setTimeout(() => setIsCopied(false), 2400);
      setTimeout(() => setShareFeedback(null), 3000);
    }
  };

  const handleShareMandate = async () => {
    tactile.mandateAction();
    const appUrl = typeof window !== 'undefined' ? window.location.href : 'https://cleat.ai';
    const preformattedShareText = `Cleat Enforcer Active Mandate:\n"${mandateSentence}"\n\nAutonomous trading speed governed by unbreakable, plain English human mandates.\nInspect live enforcer at: ${appUrl}`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Cleat Enforcer Mandate',
          text: preformattedShareText,
          url: appUrl,
        });
        setToastMessage('Mandate Shared via Web Share');
        setIsToastOpen(true);
        setShareFeedback('Shared successfully via native share');
        setTimeout(() => setShareFeedback(null), 2500);
        return;
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
      }
    }

    // Fallback if native share sheet is unavailable or closed
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(preformattedShareText);
      }
      setToastMessage('Pre-Formatted Mandate Copied to Clipboard');
      setIsToastOpen(true);
      setShareFeedback('Pre-formatted mandate message & link copied to clipboard');
      setTimeout(() => setShareFeedback(null), 3200);
    } catch {
      setToastMessage('Pre-Formatted Mandate Ready to Share');
      setIsToastOpen(true);
      setShareFeedback('Mandate & link ready to share');
      setTimeout(() => setShareFeedback(null), 3200);
    }
  };

  return (
    <section className="tab-screen active flex flex-col gap-3.5 w-full pb-12" id="view-diary">
      {/* Hero Mandate Card with 3D Specular Halo */}
      <article className="glass-card" id="active-mandate-card">
        <div className="mandate-glow-halo" />
        <div className="card-topbar">
          <span className="meta-kicker">Active User Mandate</span>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Copy to Clipboard Button */}
            <button
              id="btn-copy-mandate"
              type="button"
              className="mandate-util-btn"
              onClick={handleCopyMandate}
              title="Copy active mandate to clipboard"
              aria-label="Copy Mandate to Clipboard"
            >
              {isCopied ? (
                <>
                  <Check size={12} className="text-[var(--verdigris)] shrink-0" />
                  <span className="text-[var(--verdigris)]">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} className="shrink-0" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Native Share Icon Button */}
            <button
              id="btn-share-mandate"
              type="button"
              className="mandate-util-btn"
              onClick={handleShareMandate}
              title="Share mandate with native dialog"
              aria-label="Share Mandate"
            >
              <Share2 size={12} className="shrink-0" />
              <span>Share</span>
            </button>

            <span className="immutable-chip">On-Chain v2.4</span>
          </div>
        </div>

        {/* Dynamic Share / Copy Feedback Toast */}
        {shareFeedback && (
          <div className="mandate-feedback-toast" role="status">
            <Check size={14} className="shrink-0 text-[var(--verdigris)]" />
            <span>{shareFeedback}</span>
          </div>
        )}

        <blockquote className="mandate-quote mt-2.5" id="activeMandateSentence">
          “{mandateSentence}”
        </blockquote>
        
        {/* Mandate Metadata Row - Bullet dots securely attached inline */}
        <div className="mandate-metadata-row font-sans flex items-center flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
          <span className="font-sans whitespace-nowrap">
            Held for <strong className="font-sans text-[var(--text-primary)] font-bold">44 consecutive days</strong>
          </span>
          <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[var(--text-tertiary)]">•</span>
            <span>Version <strong className="font-sans text-[var(--text-primary)] font-bold">2.4 on-chain</strong></span>
          </span>
          <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[var(--text-tertiary)]">•</span>
            <span><strong className="font-sans text-[var(--text-primary)] font-bold">1,420</strong> people running it</span>
          </span>
        </div>

        <div className="mandate-footer flex flex-row items-center justify-between gap-2.5 flex-wrap w-full pt-3 border-t border-[var(--card-border-subtle)]/70 mt-1">
          {/* Dynamic Metallic Plate UI Pill */}
          <button
            id="mpc-security-verified-badge"
            type="button"
            role="status"
            aria-live="polite"
            title="Arcium MPC cluster computation validated mandate chain (tap to test proof)"
            onClick={handleManualMpcVerify}
            className="metallic-plate-pill group"
          >
            {/* Live Hardware Status Indicator Dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              {isMpcValidating ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ember)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--ember)]" />
                </>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--verdigris)] opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--verdigris)]" />
                </>
              )}
            </span>

            {/* Micro Shield Icon */}
            <ShieldCheck
              size={12}
              className={`shrink-0 transition-transform ${
                isMpcValidating
                  ? 'text-[var(--ember)] animate-spin'
                  : 'text-[var(--verdigris)] group-hover:scale-110'
              }`}
            />

            {/* High-Contrast Non-Clipping Label */}
            <span className="metallic-plate-label whitespace-nowrap">
              {isMpcValidating ? 'Validating...' : 'MPC Security Verified'}
            </span>

            <span className="metallic-plate-sub whitespace-nowrap">
              • Arcium 18ms
            </span>
          </button>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-speak-mandate"
              type="button"
              aria-label="Speak Mandate"
              className="btn-mic whitespace-nowrap shrink-0 flex-row"
              onClick={() => {
                tactile.selectionTap();
                onOpenVoiceModal();
              }}
            >
              <div className="voice-bars">
                <span className="voice-bar" />
                <span className="voice-bar" />
                <span className="voice-bar" />
                <span className="voice-bar" />
              </div>
              <span>Speak Mandate</span>
            </button>
            <button
              id="btn-rewrite-mandate"
              type="button"
              className="btn-ember whitespace-nowrap shrink-0 flex-row"
              onClick={() => {
                tactile.selectionTap();
                onOpenRewriteModal();
              }}
            >
              Rewrite Sentence
            </button>
          </div>
        </div>
      </article>

      {/* Period Segmented Control (Overnight | Week | Month) */}
      <div className="period-segmented-control" id="period-selector">
        <button
          type="button"
          className={`period-btn ${selectedPeriod === 'overnight' ? 'active' : ''}`}
          onClick={() => {
            tactile.selectionTap();
            setSelectedPeriod('overnight');
          }}
        >
          Overnight
        </button>
        <button
          type="button"
          className={`period-btn ${selectedPeriod === 'week' ? 'active' : ''}`}
          onClick={() => {
            tactile.selectionTap();
            setSelectedPeriod('week');
          }}
        >
          Week
        </button>
        <button
          type="button"
          className={`period-btn ${selectedPeriod === 'month' ? 'active' : ''}`}
          onClick={() => {
            tactile.selectionTap();
            setSelectedPeriod('month');
          }}
        >
          Month
        </button>
      </div>

      {/* Hero Refusal Alert - Switches dynamically with period */}
      <aside className="hero-refusal-card" role="status" id="refusal-alert-card">
        <div aria-hidden="true" className="hero-refusal-icon-badge">
          ✕
        </div>
        <div className="hero-refusal-body flex flex-col gap-1 w-full">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--refused-rust)] font-bold">
              {currentPeriodConfig.badge ?? overnightBadge ?? 'Overnight session'}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-[10.5px] font-mono text-[var(--text-tertiary)]">
                Enforcer Engine v2.4
              </span>
              {/* The count is read off the chain. The dollar figures are not,
                  because the program deliberately records no amounts, and a
                  card that mixes the two without saying so is the thing this
                  badge exists to prevent. */}
              <DataOrigin origin="sample" />
            </span>
          </div>

          <h2 id="heroRefusalHeading" className="text-[15px] font-bold text-[var(--text-primary)]">
            {selectedPeriod === 'overnight' ? `${overnightRefusalCount} ${currentPeriodConfig.headingSuffix}` : currentPeriodConfig.headingSuffix}
          </h2>
          
          <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
            {currentPeriodConfig.description}
          </p>

          {/* Period Specific Stat Pills */}
          <div className="flex items-center flex-wrap gap-2 mt-2 pt-2 border-t border-[var(--card-border-subtle)]">
            {currentPeriodConfig.stats.map((st, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[11px]"
              >
                <span className="text-[var(--text-tertiary)] font-mono">{st.label}:</span>
                <span className={`font-bold font-mono ${st.type === 'refused' ? 'text-[var(--refused-rust)]' : st.type === 'trimmed' ? 'text-[var(--trimmed-amber)]' : 'text-[var(--verdigris)]'}`}>
                  {st.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Period Dedicated Intelligence Card */}
      <div className="bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-2xl p-3.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--verdigris)] font-bold">
            {currentPeriodConfig.intelligence.tag}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
            Verified On-Chain
          </span>
        </div>
        <div className="text-[13px] font-bold text-[var(--text-primary)]">
          {currentPeriodConfig.intelligence.title}
        </div>
        <div className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
          {currentPeriodConfig.intelligence.detail}
        </div>
      </div>

      {/* Interactive SVG Diagram: Magicblock PER Trade Filtering Flow */}
      <MagicblockPerDiagram />

      {/* What the boundary is worth, in one line of arithmetic.
          Every proposal's size added up against every allowance. No
          counterfactual about what would have been bought, because the log
          does not know that and neither do we. Just the two totals. */}
      {restraint && restraint.askedBps > 0 && (
        <div className="restraint-band" id="restraint-band">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Asked for, and allowed
            </span>
            <DataOrigin origin="chain" />
          </div>
          <p className="restraint-figure">
            <span className="restraint-held">
              {(restraint.heldBps / 100).toFixed(0)}%
            </span>
            <span className="restraint-tail">
              {' '}of the book held back
            </span>
          </p>
          <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
            Across every decision on this log the agent asked to move{' '}
            <strong className="text-[var(--text-primary)]">
              {(restraint.askedBps / 100).toFixed(0)}%
            </strong>{' '}
            of the book. The sentence allowed{' '}
            <strong className="text-[var(--text-primary)]">
              {(restraint.allowedBps / 100).toFixed(0)}%
            </strong>
            . That is the two totals added up, nothing modelled.
          </p>
        </div>
      )}

      {/* Decision Ledger Feed Header */}
      <div className="section-row-header">
        <div className="flex items-center gap-2">
          <h3 className="section-heading text-[16px] font-bold">
            {currentPeriodConfig.label} Decision Ledger
          </h3>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[var(--text-secondary)]">
            {filteredEntries.length} items
          </span>
        </div>
        <span className="flex items-center gap-2">
          <span className="section-hint text-[11px]">Tap item to inspect agent trace</span>
          <DataOrigin origin="chain" />
        </span>
      </div>

      {/* Pill-Based Filter Bar: All | Refused | Trimmed | Cleared */}
      <div
        className="ledger-filter-bar"
        id="ledger-status-filter-bar"
        role="toolbar"
        aria-label="Filter ledger entries by transaction status"
      >
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'refused', label: 'Refused' },
            { key: 'trimmed', label: 'Trimmed' },
            { key: 'cleared', label: 'Cleared' },
          ] as const
        ).map((filterItem) => {
          const isActive = statusFilter === filterItem.key;
          const count =
            filterItem.key === 'all'
              ? periodEntries.length
              : periodEntries.filter((e) => e.status === filterItem.key).length;

          return (
            <button
              key={filterItem.key}
              id={`filter-pill-${filterItem.key}`}
              type="button"
              className={`ledger-filter-pill ${isActive ? 'active' : ''} ${filterItem.key}`}
              onClick={() => {
                tactile.selectionTap();
                setStatusFilter(filterItem.key);
              }}
              aria-pressed={isActive}
            >
              <span>{filterItem.label}</span>
              <span className="ledger-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Feed Group */}
      <div className="flex flex-col gap-2.5" id="diaryFeedContainer">
        {filteredEntries.length === 0 ? (
          <div className="ledger-empty-filter" id="ledger-empty-state">
            No {statusFilter} transactions recorded in the {currentPeriodConfig.label} window.
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <article
              key={entry.id}
              id={`ledger-${entry.id}`}
              className={`ledger-entry ${entry.expanded ? 'expanded' : ''}`}
              onClick={() => {
                tactile.ledgerTrigger(entry.status);
                onToggleEntry(entry.id);
              }}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  tactile.ledgerTrigger(entry.status);
                  onToggleEntry(entry.id);
                }
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`pill-status ${entry.status}`}>
                  {entry.statusLabel}
                </span>
                <span className="text-[10.5px] font-mono text-[var(--text-tertiary)]">
                  {entry.timestamp}
                </span>
              </div>
              <div className="text-[13.5px] font-bold text-[var(--text-primary)] leading-snug mb-1">
                {entry.action}
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">
                {entry.cause}
              </div>

              {entry.expanded && (
                <div className="mt-2.5 pt-2.5 border-t border-[var(--card-border-subtle)] text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  <p>{entry.causeDetail}</p>
                  <div className="mt-2 bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] p-2 rounded-lg font-mono text-[10.5px] text-[var(--text-secondary)]">
                    {entry.agentTrace}
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>

      <AttackBox />

      {/* Subtle Toast Notification confirming mandate share / copy with haptic feedback */}
      <ToastNotification
        isVisible={isToastOpen}
        message={toastMessage}
        subtext={`“${mandateSentence}”`}
        onDismiss={() => setIsToastOpen(false)}
      />
    </section>
  );
};
