import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';

/**
 * What the agent is looking at, and what the sentence makes of it.
 *
 * Six asset classes from one oracle. The one that matters is oil: the demo
 * mandate rules out fossil fuels by name, so a crude price moving is a real
 * reason for an agent to want energy exposure and a real refusal comes back.
 * Nothing in that chain is staged. Pyth publishes the price, the rule is on
 * chain, and the refusal sits in a ring buffer anyone can read.
 */
interface Row {
  symbol: string;
  label: string;
  klass: string;
  note: string;
  denied?: boolean;
  price?: number;
  dayBps?: number;
  error?: string;
}

export const Watching: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [priced, setPriced] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/pyth')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setRows(j.rows ?? []);
        setPriced(!!j.priced);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  const money = (n: number) =>
    n >= 1000 ? `$${n.toFixed(0)}` : n >= 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

  return (
    <section className="glass-card flex flex-col gap-2.5" id="watching">
      <div className="card-topbar">
        <span className="meta-kicker">What the agent is watching</span>
        <DataOrigin origin={priced ? 'venue' : 'sample'} />
      </div>

      <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
        Six asset classes from one oracle, none of which keep New York's hours.
        The interesting row is the oil: the sentence rules out fossil fuels by
        name, so a crude price moving is a real reason to want energy exposure
        and the mandate refuses it regardless. Tap any row.
      </p>

      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const up = (r.dayBps ?? 0) >= 0;
          const isOpen = open === r.symbol;
          return (
            <div
              key={r.symbol}
              className="rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] overflow-hidden"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : r.symbol)}
                className="w-full flex items-baseline justify-between gap-3 px-2.5 py-2 text-left"
              >
                <span className="flex flex-col min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] font-bold text-[var(--text-primary)]">
                      {r.label}
                    </span>
                    {r.denied && (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--refused-rust)] font-bold shrink-0">
                        ruled out
                      </span>
                    )}
                  </span>
                  <span className="text-[10.5px] text-[var(--text-tertiary)]">
                    {r.klass}
                  </span>
                </span>
                <span className="flex items-baseline gap-2.5 shrink-0 font-mono text-[11.5px] tabular-nums">
                  {r.price !== undefined ? (
                    <>
                      <span className="text-[var(--text-primary)] font-bold">
                        {money(r.price)}
                      </span>
                      <span
                        style={{
                          color: up ? 'var(--verdigris)' : 'var(--refused-rust)',
                        }}
                      >
                        {up ? '+' : '−'}
                        {Math.abs((r.dayBps ?? 0) / 100).toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)] text-[10.5px]">
                      not entitled
                    </span>
                  )}
                </span>
              </button>
              {isOpen && (
                <p className="px-2.5 pb-2.5 text-[11px] leading-[1.6] text-[var(--text-secondary)] border-t border-[var(--card-border-subtle)] pt-2">
                  {r.note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
