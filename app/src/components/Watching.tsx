import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { TickerMark } from './TickerMark';
import { Spark } from './Spark';
import { PriceChart } from './PriceChart';
import { Aside } from './Aside';
import { Shelf } from './Shelf';

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
        <span className="flex items-center gap-2">
          <Aside title="What the agent is watching">
            <p>
              Six asset classes from one oracle, and none of them keeps New
              York's hours. The interesting row is oil: a crude price moving
              is a real reason to want energy, and the sentence refuses it
              regardless, which is the whole argument in one row.
            </p>
            <p>
              Scroll the shelf to see all six, and tap one to read the day it
              had. Gold, the euro and December crude are price feeds rather
              than companies, so they carry a drawn symbol instead of a logo:
              there is no company mark to find and inventing one would be
              worse than not having it.
            </p>
          </Aside>
          <DataOrigin origin={priced ? 'venue' : 'sample'} />
        </span>
      </div>

      {/* A shelf, not a column. Six asset classes side by side is one
          glance; six of them stacked was a third of a screen each and the
          reason this tab read as a list. The detail opens once, below,
          rather than pushing every row under it down the page. */}
      <Shelf label="What the agent is watching">
        {rows.map((r) => {
          const up = (r.dayBps ?? 0) >= 0;
          const isOpen = open === r.symbol;
          return (
            <button
              key={r.symbol}
              type="button"
              role="listitem"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.symbol)}
              className={`shelf-tile${isOpen ? ' is-on' : ''}${r.denied ? ' is-denied' : ''}`}
            >
              <span className="shelf-tile-head">
                <TickerMark symbol={r.symbol} size={22}
                  equity={/^Equity\./.test(r.symbol) || /^(Metal|FX|Commodities)\./.test(r.symbol)} />
                <span className="shelf-tile-name">{r.label}</span>
              </span>

              <span className="flex items-center justify-between gap-2">
                <span className="shelf-tile-class">{r.klass}</span>
                {r.denied && <span className="shelf-tile-flag">ruled out</span>}
              </span>

              {r.series && r.series.length > 1 ? (
                <Spark
                  series={r.series}
                  stroke={up ? 'var(--verdigris)' : 'var(--refused-rust)'}
                />
              ) : (
                <span className="h-[18px]" />
              )}

              {r.price !== undefined ? (
                <span className="flex flex-col">
                  <span className="shelf-tile-price">{money(r.price)}</span>
                  <span
                    className="shelf-tile-move"
                    style={{ color: up ? 'var(--verdigris)' : 'var(--refused-rust)' }}
                  >
                    {up ? '+' : '\u2212'}
                    {Math.abs((r.dayBps ?? 0) / 100).toFixed(2)}%
                  </span>
                </span>
              ) : (
                <span className="shelf-tile-move text-[var(--text-tertiary)]">
                  not entitled
                </span>
              )}
            </button>
          );
        })}
      </Shelf>

      {/* One panel for whichever tile is open. */}
      {(() => {
        const r = rows.find((x) => x.symbol === open);
        if (!r) return null;
        const up = (r.dayBps ?? 0) >= 0;
        return (
          <div className="flex flex-col gap-2 rounded-xl px-2.5 py-2.5 bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
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
        );
      })()}

    </section>
  );
};
