import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { loadGateStatus, type GateCheck } from '../lib/chain';
import { DataOrigin } from './DataOrigin';
import { tactile } from '../utils/haptics';

/**
 * What is actually protecting this book, read rather than asserted.
 *
 * The thing this replaced showed a green tick and a toast saying an Arcium
 * computation had been attested in eighteen milliseconds. Nothing ran, the
 * number was made up, and the gate it claimed to be reporting on has never
 * returned a verdict. Two of the three rows below are now read off devnet
 * every time this loads. The third says the true thing, which is that the
 * confidential gate does not work yet and where the fault is.
 */
const DOT: Record<GateCheck['state'], string> = {
  live: 'var(--verdigris)',
  blocked: 'var(--trimmed-amber)',
  unknown: 'var(--text-tertiary)',
};

export const GateStatus: React.FC = () => {
  const [checks, setChecks] = useState<GateCheck[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    loadGateStatus().then((c) => {
      if (live) setChecks(c);
    });
    return () => {
      live = false;
    };
  }, []);

  const liveCount = checks?.filter((c) => c.state === 'live').length ?? 0;
  const total = checks?.length ?? 3;
  const allLive = checks !== null && liveCount === total;

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      <button
        id="gate-status-badge"
        type="button"
        aria-expanded={open}
        title="What is actually running, read off the chain"
        onClick={() => {
          tactile.selectionTap();
          setOpen((v) => !v);
        }}
        className="metallic-plate-pill group"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{
              background: allLive ? 'var(--verdigris)' : 'var(--trimmed-amber)',
            }}
          />
        </span>

        <ShieldCheck
          size={12}
          className="shrink-0 transition-transform group-hover:scale-110"
          style={{ color: allLive ? 'var(--verdigris)' : 'var(--trimmed-amber)' }}
        />

        <span className="metallic-plate-label whitespace-nowrap">
          {checks === null ? 'Checking the chain…' : `${liveCount} of ${total} live`}
        </span>

        <span className="metallic-plate-sub whitespace-nowrap">
          {open ? '• hide' : '• what is running'}
        </span>
      </button>

      {open && checks && (
        <div className="gate-status-panel" id="gate-status-panel">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Checked just now
            </span>
            <DataOrigin origin="chain" />
          </div>
          {checks.map((c) => (
            <div key={c.label} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: DOT[c.state] }}
                />
                <span className="text-[12px] font-medium text-[var(--text-primary)]">
                  {c.label}
                </span>
              </span>
              <span className="text-[11px] leading-[1.6] text-[var(--text-secondary)] pl-3">
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
