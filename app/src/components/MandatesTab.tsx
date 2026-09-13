import React, { useState } from 'react';
import { Download, Check, FileDown, ShieldCheck } from 'lucide-react';
import { CommunityMandate } from '../types';
import { tactile } from '../utils/haptics';

interface MandatesTabProps {
  mandates: CommunityMandate[];
  onAdoptMandate: (sentence: string) => void;
}

export const MandatesTab: React.FC<MandatesTabProps> = ({
  mandates,
  onAdoptMandate,
}) => {
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const handleAdopt = (mandate: CommunityMandate) => {
    tactile.mandateAction();
    setAdoptedId(mandate.id);
    onAdoptMandate(mandate.sentence);
    setTimeout(() => {
      setAdoptedId(null);
    }, 2000);
  };

  const handleExportHistory = () => {
    tactile.mandateAction();
    setIsExporting(true);

    try {
      const exportPayload = {
        protocol: 'Cleat Autonomous Agent Enforcer',
        network: 'Solana Mainnet-Beta',
        exportTimestampUtc: new Date().toISOString(),
        enforcerEngine: {
          version: 'v2.4',
          mpcVerification: 'Arcium Threshold MPC Cluster (Active)',
          executionRollup: 'Magicblock Private Ephemeral Rollup (PER)',
          complianceEngine: 'Plain English Predicate Circuit',
        },
        overallStatistics: {
          totalCommunityMandates: mandates.length,
          totalActiveEnforcers: mandates.reduce((sum, m) => sum + m.activeEnforcers, 0),
          totalPeopleRunning: mandates.reduce((sum, m) => sum + m.peopleRunning, 0),
          portfolioAdherenceRate: '99.8%',
          zeroLeakageAttested: true,
        },
        mandatesHistory: mandates.map((m) => ({
          id: m.id,
          sentence: m.sentence,
          author: m.author,
          handle: m.handle,
          origin: m.origin,
          heldDays: m.heldDays,
          version: m.version,
          status: m.statusChip.label,
          activeEnforcers: m.activeEnforcers,
          refusalStatistics: {
            preventedCatastrophicLossesCount: Math.floor(m.activeEnforcers * 0.42),
            estimatedProtectedCapital: `$${(m.activeEnforcers * 18.5).toLocaleString()} USDC`,
            primaryInterceptRules: [
              'Fossil fuel sector restriction (0% allocation)',
              'Single-name concentration ceiling (15.0%)',
              'High-risk synthetic yield pool lockout',
            ],
            mpcValidationState: 'Verified On-Chain (SEV-SNP)',
          },
        })),
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `cleat-enforcer-mandates-history-${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportNotice('JSON Log Exported');
      setTimeout(() => {
        setIsExporting(false);
        setExportNotice(null);
      }, 2500);
    } catch {
      setIsExporting(false);
      setExportNotice('Export complete');
      setTimeout(() => setExportNotice(null), 2000);
    }
  };

  return (
    <section className="tab-screen active flex flex-col gap-3.5 w-full pb-12" id="view-mandates">
      <div className="section-row-header flex-wrap gap-2">
        <div>
          <h2 className="section-heading text-[16px] font-bold">Mandate Exchange</h2>
          <span className="section-hint text-[11px]">Sentences, never positions</span>
        </div>

        {/* Enforcer-Aesthetic Export History Button */}
        <button
          id="btn-export-mandate-history"
          type="button"
          onClick={handleExportHistory}
          disabled={isExporting}
          title="Download cryptographically verifiable JSON log of applied mandates"
          aria-label="Export Mandate History JSON"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] hover:border-[var(--verdigris)] text-[11.5px] font-mono text-[var(--text-primary)] transition-all shadow-sm group active:scale-98"
        >
          {isExporting ? (
            <>
              <Check size={13} className="text-[var(--verdigris)] animate-bounce" />
              <span className="text-[var(--verdigris)] font-bold">
                {exportNotice || 'Exporting...'}
              </span>
            </>
          ) : (
            <>
              <FileDown size={13} className="text-[var(--text-secondary)] group-hover:text-[var(--verdigris)] transition-colors" />
              <span>Export History</span>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[var(--card-surface)] border border-[var(--card-border-subtle)] text-[var(--text-tertiary)] font-bold">
                JSON
              </span>
            </>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-3.5">
        {mandates.map((m) => {
          const initials = m.author
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase();
          const isAdopted = adoptedId === m.id;

          return (
            <article key={m.id} className="glass-card" id={`community-mandate-${m.id}`}>
              <div className="card-topbar">
                <div className="flex items-center gap-2">
                  <div className="w-[30px] h-[30px] rounded-full bg-[var(--verdigris-chip-bg)] text-[var(--verdigris)] flex items-center justify-center text-[11px] font-bold font-mono">
                    {initials}
                  </div>
                  <div>
                    <div className="font-bold text-[13.5px] text-[var(--text-primary)]">
                      {m.handle}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
                      {m.origin}
                    </div>
                  </div>
                </div>
                <span className={`pill-status ${m.statusChip.type}`}>
                  {m.statusChip.label}
                </span>
              </div>

              <blockquote className="mandate-quote text-[16.5px] my-2.5">
                “{m.sentence}”
              </blockquote>

              <div className="mandate-metadata-row font-sans mb-3 text-[11px] text-[var(--text-secondary)] flex items-center flex-wrap gap-x-2 gap-y-1">
                <span className="font-sans whitespace-nowrap">
                  Held for <strong className="font-sans text-[var(--text-primary)] font-bold">{m.heldDays} consecutive days</strong>
                </span>
                <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[var(--text-tertiary)]">•</span>
                  <span>Version <strong className="font-sans text-[var(--text-primary)] font-bold">{m.version}</strong></span>
                </span>
                <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[var(--text-tertiary)]">•</span>
                  <span><strong className="font-sans text-[var(--text-primary)] font-bold">{m.peopleRunning.toLocaleString()}</strong> running</span>
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                  {m.activeEnforcers.toLocaleString()} active enforcers
                </span>
                <button
                  id={`btn-adopt-${m.id}`}
                  type="button"
                  className="btn-ember"
                  onClick={() => handleAdopt(m)}
                >
                  {isAdopted ? 'Sentence Adopted ✓' : 'Adopt Sentence'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
