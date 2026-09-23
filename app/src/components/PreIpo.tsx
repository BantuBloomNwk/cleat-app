import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { TickerMark } from './TickerMark';

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
  /** PreStocks publishes a mark for every name it lists. */
  image?: string;
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
        Private companies, tokenised before any exchange lists them. With no
        book to be wide or narrow, the honest measure is the gap between what
        the token costs and what the vehicle behind it says a share is worth.
        Both are published, so it is read rather than guessed.
      </p>

      <p className="text-[11.5px] leading-[1.6] text-[var(--text-primary)]">
        <strong>
          {refused} of {rows.length}
        </strong>{' '}
        sit further than {(cap / 100).toFixed(2)}% from their mark, which is
        what the sentence allows. The agent cannot buy those, and that is the
        point rather than a limitation.
      </p>

      {/* Two across rather than eight down. These are meant to be compared
          against one another and against the cap, and a grid puts four in
          the eye at once where a column put one. */}
      <div className="tile-grid">
        {rows.map((r) => {
          const over = Math.abs(r.driftBps) > cap;
          return (
            <div key={r.symbol} className={`tile${over ? ' is-over' : ''}`}>
              <span className="tile-head">
                <TickerMark symbol={r.symbol} image={r.image} size={20} />
                <span className="flex flex-col min-w-0">
                  <span className="tile-sym">{r.symbol}</span>
                  <span className="tile-name">{r.name}</span>
                </span>
              </span>

              {/* The gap, drawn. There is no history for a pre-IPO token, so
                  there is no line to draw; what there is, is a mark and a
                  price, and the distance between them is the whole point. A
                  bar leaving centre says which side and how far at a glance,
                  which a signed percentage does not. */}
              <span
                className="relative h-[16px] w-full rounded bg-[var(--card-surface)] border border-[var(--card-border-subtle)]"
                title={`${(r.driftBps / 100).toFixed(1)}% from its mark`}
              >
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--card-border)]" />
                <span
                  className="absolute top-[3px] bottom-[3px] rounded-sm"
                  style={{
                    background: over ? 'var(--refused-rust)' : 'var(--verdigris)',
                    left: r.driftBps >= 0 ? '50%' : undefined,
                    right: r.driftBps < 0 ? '50%' : undefined,
                    width: `${Math.min(50, Math.abs(r.driftBps) / 100 / 30 * 50)}%`,
                  }}
                />
              </span>

              <span className="tile-foot">
                <span className="text-[var(--text-secondary)]">
                  {r.tokenPrice !== null ? `$${r.tokenPrice.toFixed(2)}` : ''}
                </span>
                <span
                  className="font-bold"
                  style={{ color: over ? 'var(--refused-rust)' : 'var(--verdigris)' }}
                  title={
                    over
                      ? 'Further from its mark than the sentence allows. Refused.'
                      : 'Inside what the sentence allows.'
                  }
                >
                  {r.driftBps >= 0 ? '+' : '\u2212'}
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
