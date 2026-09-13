import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Activity, Clock, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import { tactile } from '../utils/haptics';

interface TickDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TickEvent {
  timestamp: string;
  ticker: string;
  event: string;
  impact: string;
  status: 'refused' | 'trimmed' | 'cleared';
  slot: string;
}

const TICKS: TickEvent[] = [
  {
    timestamp: '03:42:19.420 UTC',
    ticker: 'CVX',
    event: 'Peak Impulse Buy',
    impact: '400 USDC Aborted',
    status: 'refused',
    slot: '#298,419,302',
  },
  {
    timestamp: '02:18:04.112 UTC',
    ticker: 'NVDA',
    event: 'Concentration Breached 15%',
    impact: '550 USDC Aborted',
    status: 'refused',
    slot: '#298,416,819',
  },
  {
    timestamp: '01:05:48.890 UTC',
    ticker: 'MSFT',
    event: 'Buffer Limit Clamped',
    impact: '380 USDC Trimmed',
    status: 'trimmed',
    slot: '#298,414,104',
  },
  {
    timestamp: '23:14:02.045 UTC',
    ticker: 'ICLN',
    event: 'Compliant Accumulation',
    impact: '250 USDC Cleared',
    status: 'cleared',
    slot: '#298,409,551',
  },
  {
    timestamp: 'Yesterday 18:30:11.892 UTC',
    ticker: 'BRENT-OIL',
    event: 'Crude Swap Intercepted',
    impact: '950 USDC Aborted',
    status: 'refused',
    slot: '#298,398,204',
  },
];

export const TickDrawer: React.FC<TickDrawerProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tactile.selectionTap();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleClose = () => {
    tactile.selectionTap();
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop chart-drawer-modal"
      id="chartTickDrawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tickDrawerTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="chart-drawer-card relative w-full max-w-[500px] p-5 rounded-2xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] shadow-2xl flex flex-col gap-3.5 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--card-border-subtle)] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--card-surface)] border border-[var(--card-border-subtle)] text-[var(--verdigris)]">
              <Activity size={16} />
            </div>
            <div>
              <h3 id="tickDrawerTitle" className="font-sans text-[15px] font-bold text-[var(--text-primary)]">
                Granular Tick Analysis
              </h3>
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                Sub-millisecond order-book intercepts
              </span>
            </div>
          </div>

          <button
            type="button"
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-surface)] transition-all cursor-pointer"
            onClick={handleClose}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Descriptive Kicker */}
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
          High-frequency order-book events intercepted by your on-chain mandate kernel. Evaluated confidential inside Magicblock PER before Solana slot commitment. Zero latency leakage.
        </p>

        {/* Ticks List */}
        <div className="flex flex-col gap-2 font-mono text-[11px]">
          {TICKS.map((tick, idx) => {
            const isRefused = tick.status === 'refused';
            const isTrimmed = tick.status === 'trimmed';

            return (
              <div
                key={idx}
                className="flex flex-col gap-1 p-2.5 bg-[var(--card-surface)] rounded-xl border border-[var(--card-border-subtle)] hover:border-[var(--card-border)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isRefused
                          ? 'bg-[var(--refused-rust)]'
                          : isTrimmed
                          ? 'bg-[var(--trimmed-amber)]'
                          : 'bg-[var(--verdigris)]'
                      }`}
                    />
                    <span className="font-bold text-[var(--text-primary)] text-[12px]">
                      {tick.ticker}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {tick.event}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                      isRefused
                        ? 'bg-[var(--refused-chip-bg)] border-[var(--refused-chip-border)] text-[var(--refused-rust)]'
                        : isTrimmed
                        ? 'bg-[var(--trimmed-chip-bg)] border-[var(--trimmed-chip-border)] text-[var(--trimmed-amber)]'
                        : 'bg-[var(--verdigris-chip-bg)] border-[var(--verdigris-chip-border)] text-[var(--verdigris)]'
                    }`}
                  >
                    {tick.impact}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--card-border-subtle)]/60">
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    <span>{tick.timestamp}</span>
                  </span>
                  <span>Solana Slot {tick.slot}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-[var(--card-border-subtle)] flex items-center justify-between">
          <span className="text-[10.5px] font-mono text-[var(--text-tertiary)]">
            5 order-book events captured
          </span>
          <button
            id="btn-tick-done"
            type="button"
            className="btn-ember px-5 py-2 text-[12px] font-sans font-semibold justify-center"
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
