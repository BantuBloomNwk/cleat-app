import React, { useEffect, useMemo, useState } from 'react';
import {
  loadTickers,
  loadDepth,
  bookQuality,
  isThin,
  symbolTicker,
  isPerp,
  isEntitlement,
  loadSessions,
  currentSession,
  sessionLabel,
  type Ticker,
  type MarketSession, loadTokenized, marketsFor, type TokenizedAsset } from '../lib/backpack';
import { tactile } from '../utils/haptics';
import { FlipDigits } from './FlipDigits';

/**
 * The instrument the agent is actually working against, priced live.
 *
 * This replaced a made up "Synthetic Bound Token" with the real thing:
 * nineteen tokenized equity markets on Backpack, quoted by the venue, and
 * quoted on a Sunday because these markets do not keep New York's hours.
 *
 * The book quality line is the part that earns its place. When the legacy
 * exchanges are shut the same venue will quote one name at half a basis
 * point and another at thirty five, and an agent that treats those as the
 * same market is exactly what a mandate exists to stop. So the spread is
 * on screen next to the price rather than buried.
 */
interface LiveInstrumentProps {
  symbol: string;
  onSelect: (symbol: string) => void;
}

export const LiveInstrument: React.FC<LiveInstrumentProps> = ({ symbol, onSelect }) => {
  const [tickers, setTickers] = useState<Ticker[] | null>(null);
  const [book, setBook] = useState<ReturnType<typeof bookQuality>>(null);
  const [picking, setPicking] = useState(false);
  const [sessions, setSessions] = useState<MarketSession[] | null>(null);
  // The board runs itself until someone takes it over, then it stays where
  // they put it. Cycling under a person who has just chosen something is
  // the behaviour that makes an auto advancing display infuriating.
  const [autoRunning, setAutoRunning] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = () => loadTickers().then((t) => live && setTickers(t));
    pull();
    const id = window.setInterval(pull, 30_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  // The whole tokenized universe, not just the part with an order book.
  // Fifty eight names are live on Solana; twenty one have a market. The
  // other thirty seven were invisible here, which is how two new listings
  // went missing without anything looking broken.
  const [assets, setAssets] = useState<TokenizedAsset[] | null>(null);
  useEffect(() => {
    let live = true;
    loadTokenized().then((a) => live && setAssets(a));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    loadSessions().then((x) => live && setSessions(x));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const pull = () => loadDepth(symbol).then((d) => live && setBook(bookQuality(d)));
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [symbol]);

  const DWELL = 4200;

  // Busiest first. Someone opening this should land on a market that is
  // actually trading rather than the one that sorts first alphabetically.
  const ranked = useMemo(
    () =>
      (tickers ?? [])
        .slice()
        .sort((a, b) => Number(b.quoteVolume || 0) - Number(a.quoteVolume || 0)),
    [tickers],
  );

  // Advance through the board while nobody has taken it over. Only the
  // busiest dozen, because the tail is names nobody is trading and a board
  // that shows them is padding itself.
  useEffect(() => {
    if (!autoRunning || paused || picking || ranked.length < 2) return;
    const board = ranked.slice(0, 12);
    const id = window.setInterval(() => {
      const at = board.findIndex((t) => t.symbol === symbol);
      const next = board[(at + 1) % board.length];
      if (next) onSelect(next.symbol);
    }, DWELL);
    return () => window.clearInterval(id);
  }, [autoRunning, paused, picking, ranked, symbol, onSelect]);

  /** Tokenized and withdrawable, but nobody has stood a book against it. */
  const bookless = useMemo(() => {
    if (!assets) return [];
    return assets.filter((a) => {
      const m = marketsFor(a, tickers);
      return !m.spot && !m.perp;
    });
  }, [assets, tickers]);

  const takeOver = () => {
    setAutoRunning(false);
  };

  const active = ranked.find((t) => t.symbol === symbol) ?? ranked[0];
  const change = active ? Number(active.priceChangePercent) * 100 : 0;
  const up = change >= 0;
  const thin = isThin(book);

  if (!active) {
    return (
      <div className="flex flex-col gap-1">
        <div className="font-bold text-[15px] text-[var(--text-primary)]">
          Loading the market
        </div>
        <div className="font-mono text-[11.5px] text-[var(--text-tertiary)]">
          Reading live quotes
        </div>
      </div>
    );
  }

  const session = currentSession(sessions);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Say what this number is. It was a ticker and a price with nothing
          around them, which reads as decoration rather than as the thing
          the agent is working against. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] font-mono uppercase tracking-[0.09em] text-[var(--text-tertiary)] min-w-0">
        <span className="whitespace-nowrap">Agent is working against</span>
        <span className="text-[var(--verdigris)] whitespace-nowrap">
          {autoRunning ? 'cycling · tap to hold' : 'tap to change'}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          tactile.selectionTap();
          takeOver();
          setPicking((p) => !p);
        }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        aria-expanded={picking}
        style={{ ['--ticker-dwell' as string]: `${DWELL}ms` }}
        className={`flex items-baseline gap-2 min-w-0 text-left ${
          autoRunning && !paused && !picking ? 'ticker-auto' : ''
        }`}
      >
        <span className="font-bold text-[16px] text-[var(--text-primary)] whitespace-nowrap">
          <FlipDigits value={symbolTicker(active.symbol)} />
        </span>
        {/* A perpetual is not a share. No entitlement behind it, cash
            settled on a single name, which is a different legal object
            from the token next to it in this list. Saying so costs one
            word. */}
        <span
          className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap ${
            isEntitlement(active.symbol)
              ? 'bg-[var(--verdigris-chip-bg)] border-[var(--verdigris-chip-border)] text-[var(--verdigris)]'
              : 'bg-[var(--card-surface-raised)] border-[var(--card-border-subtle)] text-[var(--text-tertiary)]'
          }`}
          title={
            isEntitlement(active.symbol)
              ? 'A tokenized share. There is an entitlement behind this one.'
              : 'A perpetual. Cash settled, no share behind it, and a different legal object from a tokenized share.'
          }
        >
          {isEntitlement(active.symbol) ? 'share' : 'perp'}
        </span>
        <span className="font-mono text-[15px] font-extrabold text-[var(--text-primary)]">
          <FlipDigits
            value={`$${Number(active.lastPrice).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
          />
        </span>
        <span
          className={`font-mono text-[12px] font-bold whitespace-nowrap ${
            up ? 'text-[var(--verdigris)]' : 'text-[var(--refused-rust)]'
          }`}
        >
          <FlipDigits value={`${up ? '+' : ''}${change.toFixed(2)}%`} />
        </span>
        <span className="text-[var(--text-tertiary)] text-[11px]" aria-hidden="true">
          {picking ? '▴' : '▾'}
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-[var(--text-tertiary)]">
        <span className="whitespace-nowrap">
          {Number(active.trades).toLocaleString()} trades today
        </span>
        <span
          className="whitespace-nowrap"
          title="The venue's own book. It never closes, which is not the same thing as permissionless."
        >
          venue book
        </span>
        {/* New York's session belongs here, next to the instrument it
            applies to, rather than in a global header. It is context for
            this one name, and for most of our users it is the least
            relevant clock on the page. */}
        {sessions && (
          <span
            className="whitespace-nowrap"
            title={
              session
                ? `The listing exchange is in its ${sessionLabel(session).toLowerCase()} session.`
                : 'The listing exchange is shut. This market is not, which is the point.'
            }
          >
            listing exchange {session ? sessionLabel(session).toLowerCase() : 'shut'}
          </span>
        )}
        {book && (
          <span
            className={`whitespace-nowrap ${thin ? 'text-[var(--ember)] font-bold' : ''}`}
            title={
              thin
                ? 'A wide book. Size is the thing that will hurt you here, which is what the mandate caps.'
                : 'A tight book across many levels.'
            }
          >
            {book.spreadBps.toFixed(1)} bps across {book.levels} levels
            {thin ? ' · thin' : ''}
          </span>
        )}
      </div>

      {picking && (
        <div
          className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-[var(--card-border)] bg-[var(--card-surface-raised)] divide-y divide-[var(--card-border-subtle)]"
          role="listbox"
          aria-label="Tokenized markets"
        >
          {ranked.map((t) => {
            const c = Number(t.priceChangePercent) * 100;
            return (
              <button
                key={t.symbol}
                type="button"
                role="option"
                aria-selected={t.symbol === symbol}
                onClick={() => {
                  tactile.selectionTap();
                  takeOver();
                  onSelect(t.symbol);
                  setPicking(false);
                }}
                className={`w-full flex items-baseline justify-between gap-2 px-2.5 py-2 text-left hover:bg-[var(--card-surface)] ${
                  t.symbol === symbol ? 'bg-[var(--card-surface)]' : ''
                }`}
              >
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-bold text-[12px] text-[var(--text-primary)] whitespace-nowrap">
                    {symbolTicker(t.symbol)}
                  </span>
                  {isPerp(t.symbol) && (
                    <span className="text-[8.5px] font-mono uppercase text-[var(--text-tertiary)]">
                      perp
                    </span>
                  )}
                </span>
                <span className="flex items-baseline gap-2 shrink-0 font-mono text-[11px] tabular-nums">
                  <span className="text-[var(--text-secondary)]">
                    ${Number(t.lastPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span
                    className={`w-[52px] text-right ${
                      c >= 0 ? 'text-[var(--verdigris)]' : 'text-[var(--refused-rust)]'
                    }`}
                  >
                    {c >= 0 ? '+' : ''}{c.toFixed(2)}%
                  </span>
                </span>
              </button>
            );
          })}

          {/* Held, not traded.
              These are real tokens you can withdraw to a wallet, they just
              have no market here yet. Leaving them out made the app look
              like it had missed a listing. Showing them greyed says the
              true thing: the name exists, the book does not. */}
          {bookless.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--card-surface)]">
                tokenized, no book yet
              </div>
              {bookless.map((a) => (
                <div
                  key={a.asset}
                  className="w-full flex items-baseline justify-between gap-2 px-2.5 py-2 opacity-60"
                  title={`${a.name} · ${a.mint}`}
                >
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-bold text-[12px] text-[var(--text-primary)] whitespace-nowrap">
                      {a.ticker}
                    </span>
                    <span className="truncate text-[10px] text-[var(--text-tertiary)]">
                      {a.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase text-[var(--text-tertiary)]">
                    holdable
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
