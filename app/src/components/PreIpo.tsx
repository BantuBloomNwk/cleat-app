import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';

/**
 * The hardest case the mandate has to handle.
 *
 * Every other instrument in this app has a book, however thin. A pre-IPO
 * token has an SPV mark and whatever somebody will pay for it, and the
 * distance between those two is the price of there being no market at all.
 * PreStocks publishes both numbers, so the distance is read rather than
 * guessed.
 *
 * Which makes it the clearest test of the argument the product rests on. A
 * sentence that says "nothing wider than twenty basis points" refuses most of
 * these outright, and it should: an agent buying an illiquid private company
 * while its owner is asleep in another timezone is the exact thing the cap
 * was written for. The refusals here are the feature.
 */
interface Row {
  symbol: string;
  name: string;
  mint: string;
  markPrice: number | null;
  tokenPrice: number | null;
  driftBps: number;
  url: string | null;
}

export const PreIpo: React.FC<{ maxSpreadBps: number }> = ({ maxSpreadBps }) => {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/prestocks')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => {
        if (live) setRows(j.rows ?? []);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  const cap = maxSpreadBps > 0 ? maxSpreadBps : 20;
  const refused = rows.filter((r) => Math.abs(r.driftBps) > cap).length;

  return (
    <section className="glass-card flex flex-col gap-2.5" id="pre-ipo">
      <div className="card-topbar">
        <span className="meta-kicker">Before the listing</span>
        <DataOrigin origin="venue" />
      </div>

      <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
        These are private companies, tokenised before any exchange lists them.
        There is no book to be wide or narrow, so the honest measure is the
        distance between what the token costs and what the vehicle behind it
        says a share is worth. Both are published, so it is read rather than
        guessed.
      </p>

      <p className="text-[11.5px] leading-[1.6] text-[var(--text-primary)]">
        <strong>
          {refused} of {rows.length}
        </strong>{' '}
        sit further than {(cap / 100).toFixed(2)}% from their mark, which is
        what the sentence allows. The agent cannot buy those, and that is the
        point rather than a limitation.
      </p>

      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const over = Math.abs(r.driftBps) > cap;
          return (
            <div
              key={r.symbol}
              className="flex items-baseline justify-between gap-3 px-2.5 py-2 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]"
            >
              <span className="flex flex-col min-w-0">
                <span className="font-mono text-[11.5px] font-bold text-[var(--text-primary)]">
                  {r.symbol}
                </span>
                <span className="text-[10.5px] text-[var(--text-tertiary)] truncate">
                  {r.name}
                </span>
              </span>
              <span className="flex items-baseline gap-2.5 shrink-0 font-mono text-[11px] tabular-nums">
                {r.tokenPrice !== null && (
                  <span className="text-[var(--text-secondary)]">
                    ${r.tokenPrice.toFixed(2)}
                  </span>
                )}
                <span
                  className="font-bold"
                  style={{
                    color: over ? 'var(--refused-rust)' : 'var(--verdigris)',
                  }}
                  title={
                    over
                      ? 'Further from its mark than the sentence allows. Refused.'
                      : 'Inside what the sentence allows.'
                  }
                >
                  {r.driftBps >= 0 ? '+' : '−'}
                  {Math.abs(r.driftBps / 100).toFixed(1)}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};
