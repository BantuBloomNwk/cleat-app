import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { Spark } from './Spark';
import { PriceChart } from './PriceChart';

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
  monthBps?: number;
  series?: number[];
  at?: number[];
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
        Six asset classes from one oracle, none of which keep New York's
        hours. Thirty days of closes on every row. The interesting one is the
        oil: the sentence rules out fossil fuels by name, so a crude price
        moving is a real reason to want energy exposure and the mandate
        refuses it regardless. Tap a row to read a price on any day.
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
                <span className="flex items-center gap-2.5 shrink-0">
                  {r.series && r.series.length > 1 && (
                    <Spark
                      series={r.series}
                      stroke={up ? 'var(--verdigris)' : 'var(--refused-rust)'}
                    />
                  )}
                  <span className="flex flex-col items-end font-mono text-[11.5px] tabular-nums">
                    {r.price !== undefined ? (
                      <>
                        <span className="text-[var(--text-primary)] font-bold">
                          {money(r.price)}
                        </span>
                        <span
                          className="text-[10.5px]"
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
                </span>
              </button>
              {isOpen && (
                <div className="px-2.5 pb-2.5 pt-2.5 border-t border-[var(--card-border-subtle)] flex flex-col gap-2">
                  {r.series && r.series.length > 1 && (
                    <PriceChart
                      series={r.series}
                      at={r.at}
                      label={r.label}
                      stroke={up ? 'var(--verdigris)' : 'var(--refused-rust)'}
                    />
                  )}
                  <p className="text-[11px] leading-[1.6] text-[var(--text-secondary)]">
                    {r.note}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
