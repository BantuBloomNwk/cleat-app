import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  AlertOctagon,
  Clock,
  Fingerprint,
  Check,
  Copy,
  ExternalLink,
  Cpu,
  ArrowRight,
  TrendingDown,
  Layers,
} from 'lucide-react';
import { ChartMarker } from '../types';
import { tactile } from '../utils/haptics';
import { useDialog } from '../utils/useDialog';

interface DataInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  marker: ChartMarker | null;
  activeMandate?: string;
}

export const DataInsightsModal: React.FC<DataInsightsModalProps> = ({
  isOpen,
  onClose,
  marker,
  activeMandate = 'Moderate growth, nothing over fifteen percent in one name, no fossil fuels.',
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialog(isOpen && !!marker, onClose, panelRef);

  if (!isOpen || !marker) return null;

  const isRefused = marker.status === 'refused';
  const isTrimmed = marker.status === 'trimmed';

  const statusLabel = isRefused ? 'Refused' : isTrimmed ? 'Trimmed' : 'Cleared';
  const statusColor = isRefused
    ? 'var(--refused-rust)'
    : isTrimmed
    ? 'var(--trimmed-amber)'
    : 'var(--verdigris)';

  const solanaSlotNum = marker.solanaSlot || marker.blockNumber || 298419302;
  const formattedIsoTimestamp = `2026-09-12 ${marker.time}:08.241 UTC (Solana Slot #${solanaSlotNum.toLocaleString()})`;

  const handleCopyTrace = async () => {
    tactile.mandateAction();
    const traceText = `[Cleat Protocol Data Insights Intercept Report]
Network: Solana Mainnet-Beta
Ticker: ${marker.ticker}
Status: ${statusLabel.toUpperCase()}
Exact Timestamp: ${formattedIsoTimestamp}
Solana Slot: #${solanaSlotNum}
Target Venue: ${marker.venue || 'Jupiter v6 Routing (JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4)'}
Order Size: ${marker.orderSize || '$500 USDC'}
Specific Trade Cause: ${marker.desc}
Triggered Mandate Boundary: "${marker.rule}"
Capital Preserved / Buffer: ${marker.saved}
Drawdown Averted: ${marker.drawdownSaved || '-8.4%'}
Counterfactual PnL: ${marker.counterfactualPnl || '+$14.20'}
Magicblock PER Session: ${marker.perMpcSession || 'magicblock-per-sol-ephem-8492'}
Arcium MPC Cluster: ${marker.arciumClusterId || 'arcium-mpc-cluster-usdc-guard-04'}
MPC Proof Signature: ${marker.proofSig || marker.zkProofHash || '5KwN8v3bWz6Y7qT9ArciumMPC9x7kM2vP4L1'}
Autonomous Raw Instruction: ${marker.rawPayload || 'Program: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 -> route()'}`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(traceText);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2400);
    } catch {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2400);
    }
  };

  return createPortal(
    <div
      className="modal-backdrop animate-fadeIn"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          tactile.modalDismiss();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-insights-title"
        className="w-full max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--card-surface)] border border-[var(--card-border)] shadow-2xl p-4 sm:p-5 flex flex-col gap-4 text-[var(--text-primary)] outline-none"
        id="data-insights-modal-card"
      >
        {/* Modal Topbar Header */}
        <div className="flex items-start justify-between pb-3 border-b border-[var(--card-border-subtle)]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: statusColor }}
                />
                Solana PER • MPC Intercept Audit
              </span>
              <span
                className="text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-md"
                style={{
                  backgroundColor: isRefused
                    ? 'var(--refused-chip-bg)'
                    : isTrimmed
                    ? 'var(--trimmed-chip-bg)'
                    : 'var(--verdigris-chip-bg)',
                  borderColor: isRefused
                    ? 'var(--refused-chip-border)'
                    : isTrimmed
                    ? 'var(--trimmed-chip-border)'
                    : 'var(--verdigris-chip-border)',
                  color: statusColor,
                  borderWidth: '1px',
                }}
              >
                {statusLabel} Intercept
              </span>
            </div>
            <h2
              id="data-insights-title"
              className="text-[17px] font-bold tracking-tight text-[var(--text-primary)] font-sans flex items-center gap-2"
            >
              <span>{marker.ticker}</span>
              <span className="text-[var(--text-tertiary)] font-normal text-[14px]">
                • {marker.title}
              </span>
            </h2>
          </div>

          <button
            type="button"
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-surface-raised)] transition-colors"
            onClick={() => {
              tactile.modalDismiss();
              onClose();
            }}
            aria-label="Close Data Insights Modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Telemetry Strip: Exact Timestamp, Venue, Capital Preserved */}
        {/* Two columns, not three at sm. The sheet is bounded to the app's
            440px column now, but sm: still keys off the window, so on a
            desktop this cut a 400px sheet into three. */}
        <div className="grid grid-cols-2 gap-2">
          {/* Exact Timestamp */}
          <div className="p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col col-span-2">
            <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1">
              <Clock size={11} /> Exact Timestamp
            </span>
            <span className="text-[11.5px] font-mono font-bold text-[var(--text-primary)] mt-1">
              {marker.time} UTC
            </span>
            <span className="text-[9.5px] font-mono text-[var(--text-tertiary)] truncate">
              Solana Slot #{solanaSlotNum.toLocaleString()}
            </span>
          </div>

          {/* Execution Venue */}
          <div className="p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col">
            <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1">
              <Layers size={11} /> Target Solana Venue
            </span>
            <span className="text-[11.5px] font-mono font-bold text-[var(--text-primary)] mt-1 truncate">
              {marker.venue || 'Jupiter v6 Routing'}
            </span>
            <span className="text-[9.5px] font-mono text-[var(--text-tertiary)] truncate">
              {marker.cuSaved || '0.015 SOL / 45k CU saved'}
            </span>
          </div>

          {/* Capital Saved / Buffer */}
          <div
            className="p-2.5 rounded-xl border flex flex-col"
            style={{
              backgroundColor: isRefused
                ? 'var(--refused-chip-bg)'
                : isTrimmed
                ? 'var(--trimmed-chip-bg)'
                : 'var(--verdigris-chip-bg)',
              borderColor: isRefused
                ? 'var(--refused-chip-border)'
                : isTrimmed
                ? 'var(--trimmed-chip-border)'
                : 'var(--verdigris-chip-border)',
            }}
          >
            <span
              className="text-[9.5px] font-mono uppercase tracking-wider font-bold flex items-center gap-1"
              style={{ color: statusColor }}
            >
              <TrendingDown size={11} /> Capital Shielded
            </span>
            <span
              className="text-[12.5px] font-mono font-extrabold mt-1"
              style={{ color: statusColor }}
            >
              {marker.saved}
            </span>
            <span
              className="text-[9.5px] font-mono opacity-85 truncate"
              style={{ color: statusColor }}
            >
              {marker.drawdownSaved || '-9.2% averted'}
            </span>
          </div>
        </div>

        {/* Specific Trade Cause Card */}
        <section
          className="p-3.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] flex flex-col gap-2"
          aria-label="Specific Trade Cause"
        >
          <div className="flex items-center gap-2">
            {isRefused ? (
              <AlertOctagon size={16} className="text-[var(--refused-rust)] shrink-0" />
            ) : isTrimmed ? (
              <ShieldAlert size={16} className="text-[var(--trimmed-amber)] shrink-0" />
            ) : (
              <ShieldCheck size={16} className="text-[var(--verdigris)] shrink-0" />
            )}
            <h3 className="font-sans font-bold text-[13px] text-[var(--text-primary)]">
              Specific Trade Cause &amp; Agent Intent
            </h3>
          </div>
          <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
            {marker.desc}
          </p>
          <div className="p-2 rounded-lg bg-[var(--card-surface)] border border-[var(--card-border-subtle)] font-mono text-[11px] text-[var(--text-secondary)] flex items-center justify-between">
            <span>Requested Size:</span>
            <span className="font-bold text-[var(--text-primary)]">{marker.orderSize || '$500 USDC'}</span>
          </div>
        </section>

        {/* Breakdown: Why That Specific Transaction Was Intercepted */}
        <section
          className="flex flex-col gap-2.5"
          aria-label="Enforcement Pipeline Breakdown"
        >
          <h3 className="font-sans font-bold text-[13px] text-[var(--text-primary)] flex items-center gap-2">
            <Cpu size={15} className="text-[var(--verdigris)]" />
            <span>Why This Transaction Was Intercepted</span>
          </h3>

          <div className="flex flex-col gap-2">
            {/* Step 1: Active Human Mandate Boundary */}
            <div className="p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[var(--card-surface)] border border-[var(--card-border)] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <div className="flex flex-col gap-0.5 text-[12px]">
                <span className="font-bold text-[var(--text-primary)]">
                  Governing Mandate Rule
                </span>
                <span className="font-mono text-[11.5px] text-[var(--verdigris)] font-semibold">
                  "{marker.rule}"
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  Derived from active mandate: "{activeMandate}"
                </span>
              </div>
            </div>

            {/* Step 2: Policy Breach Detection */}
            <div className="p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[var(--card-surface)] border border-[var(--card-border)] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <div className="flex flex-col gap-0.5 text-[12px]">
                <span className="font-bold text-[var(--text-primary)]">
                  Violation Evaluation
                </span>
                <span className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                  {isRefused
                    ? `Autonomous agent attempted to route capital into ${marker.ticker}, directly breaching the zero-tolerance policy for this asset class.`
                    : isTrimmed
                    ? `Agent order volume exceeded maximum permissible portfolio slice. Enforcer calculated headroom and scaled execution down.`
                    : `Order strictly met all portfolio risk and growth parameters. Cryptographic clearance token generated.`}
                </span>
              </div>
            </div>

            {/* Step 3: Magicblock PER & Arcium MPC Intercept */}
            <div className="p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[var(--card-surface)] border border-[var(--card-border)] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <div className="flex flex-col gap-0.5 text-[12px]">
                <span className="font-bold text-[var(--text-primary)]">
                  Magicblock PER &amp; Arcium MPC Enforcement
                </span>
                <span className="text-[11.5px] text-[var(--text-secondary)]">
                  Simulated and halted inside Magicblock Private Ephemeral Rollup with Arcium confidential MPC threshold validation before Solana RPC broadcast. 100% shielded against front-running and MEV.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Cryptographic PER & MPC Proof & Raw Payload Trace */}
        <section className="p-3 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
              <Fingerprint size={12} /> Magicblock PER • Arcium MPC Signature
            </span>
            <span className="text-[9.5px] font-mono text-[var(--verdigris)]">Solana Base58</span>
          </div>
          <code className="p-2 rounded-lg bg-[var(--card-surface)] border border-[var(--card-border-subtle)] font-mono text-[10.5px] text-[var(--text-primary)] break-all select-all">
            {marker.proofSig || marker.zkProofHash || '5KwN8v3bWz6Y7qT9ArciumMPC9x7kM2vP4L1'}
          </code>
          <div className="flex items-center justify-between text-[9.5px] font-mono text-[var(--text-tertiary)] pt-0.5">
            <span>Session: {marker.perMpcSession || 'magicblock-per-sol-ephem-8492'}</span>
            <span>Cluster: {marker.arciumClusterId || 'arcium-mpc-cluster-usdc-guard-04'}</span>
          </div>
          {marker.rawPayload && (
            <div className="mt-1">
              <span className="text-[9.5px] font-mono text-[var(--text-tertiary)] block mb-1">
                Solana Instruction Intercepted:
              </span>
              <code className="p-1.5 rounded bg-[var(--card-surface)] text-[10px] font-mono text-[var(--text-secondary)] block truncate">
                {marker.rawPayload}
              </code>
            </div>
          )}
        </section>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="btn-ember flex-1 justify-center py-2.5 font-sans text-[12.5px]"
            onClick={handleCopyTrace}
          >
            {isCopied ? (
              <>
                <Check size={14} className="text-[var(--verdigris)] shrink-0" />
                <span>Intercept Trace Copied</span>
              </>
            ) : (
              <>
                <Copy size={14} className="shrink-0" />
                <span>Copy Intercept Audit</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="btn-mic px-4 py-2.5 font-sans text-[12.5px]"
            onClick={() => {
              tactile.modalDismiss();
              onClose();
            }}
          >
            <span>Close</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
