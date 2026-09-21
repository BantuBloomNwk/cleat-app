import React, { useEffect, useState } from 'react';
import {
  ISSUERS,
  loadIssuerQuotes,
  driftBps,
  isDeep,
  type IssuerQuote,
} from '../lib/issuers';
import {
  loadRouteCost,
  resolveMint,
  type RouteCost,
  type SunriseStock,
} from '../lib/sunrise';
import { tactile } from '../utils/haptics';
import { DataOrigin } from './DataOrigin';

/**
 * The same company, from everyone who has tokenized it.
 *
 * A price chart cannot tell these apart and that is the problem. Under one
 * ticker sit a claim on a share held by a broker dealer, a Jersey note
 * under a prospectus, and a token minted only against a signed
 * attestation, with depth that differs by three orders of magnitude
 * between them. Which one a trade goes to is a decision, and until now it
 * was one nobody was shown they were making.
 *
 * This is also the aggregation that is actually available. Every tokenized
 * equity on Solana is an American name, so there is no second exchange to
 * add. There are three issuers, and they disagree.
 */
interface CrossIssuerProps {
  /** The plain ticker, so "MU.US_USDC" arrives here as "MU". */
  ticker: string;
  /** What the venue's own book says, for the row we already have. */
  venuePrice: number | null;
  venueDepthUsd: number | null;
  /** The widest book the mandate will trade into. Zero means unset. */
  maxSpreadBps: number;
}

/** Sizes worth asking about. A cap that never binds is not a cap. */
const SIZES = [2_000, 20_000, 100_000];

const money = (n: number | null) =>
  n === null
    ? '—'
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}k`
        : `$${Math.round(n)}`;

export const CrossIssuer: React.FC<CrossIssuerProps> = ({
  ticker,
  venuePrice,
  venueDepthUsd,
  maxSpreadBps,
}) => {
  const [quotes, setQuotes] = useState<IssuerQuote[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listed, setListed] = useState<SunriseStock | null>(null);
  const [size, setSize] = useState(SIZES[0]);
  const [cost, setCost] = useState<RouteCost | null>(null);
  const [costing, setCosting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    // Clear on the way in, not only on the way out. The ticker cycles on its
    // own, and holding the previous name's rows while the new one loads put
    // Micron's two wrappers under a heading that said SPY. Nothing about that
    // reads as loading; it reads as an answer, and it is the wrong one.
    setQuotes(null);
    loadIssuerQuotes(ticker).then((q) => {
      if (!live) return;
      setQuotes(q);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [ticker]);

  // The issuer's own answer to which address is the real one. Resolved at
  // the moment of the trade rather than pinned to a constant, because
  // around a listing the imitations arrive within minutes.
  useEffect(() => {
    let live = true;
    setListed(null);
    setCost(null);
    resolveMint(ticker).then((m) => {
      if (live) setListed(m);
    });
    return () => {
      live = false;
    };
  }, [ticker]);

  // Two quotes to somebody else's API per answer, and the ticker changes on
  // its own every few seconds, so this waits for it to settle first. Cycling
  // past a name is not a request to price it.
  useEffect(() => {
    if (!listed) return;
    let live = true;
    const t = setTimeout(() => {
      setCosting(true);
      loadRouteCost(listed.mint, size).then((c) => {
        if (!live) return;
        setCost(c);
        setCosting(false);
      });
    }, 1200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [listed, size]);

  const rows = quotes ?? [];
  const real = rows.find((r) => r.realPrice)?.realPrice ?? null;

  return (
    <section
      className="glass-card flex flex-col gap-2.5"
      aria-label={`Every tokenized version of ${ticker}`}
    >
      <div className="section-row-header">
        <h3 className="section-heading text-[16px] font-bold">
          {ticker}, three ways
        </h3>
        <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
          <span className="section-hint text-[11px]">Same ticker, different instrument</span>
          <DataOrigin origin="venue" />
        </span>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
        A price chart cannot tell these apart. One is a claim on a share a broker
        dealer holds, one is a note issued in Jersey, one is minted only against a
        signed attestation. Which one a trade lands on is a decision.
      </p>

      {real !== null && (
        <div className="flex items-baseline justify-between gap-3 px-2.5 py-2 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">
            The actual share
          </span>
          <span className="font-mono text-[13px] font-bold text-[var(--text-primary)] tabular-nums">
            ${real.toFixed(2)}
          </span>
        </div>
      )}

      {loading && (
        <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">
          Asking every issuer…
        </p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-[11.5px] text-[var(--text-secondary)]">
          Only the venue's own book carries {ticker} right now. Nobody else has
          tokenized it, so there is nothing to weigh it against.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {/* The venue we already read, so the comparison is complete. The
            mint underneath it comes from the issuer's own listing layer
            rather than from a constant in this file. */}
        {venuePrice !== null && (
          <Row
            title={ISSUERS.backpack.name}
            symbol={`${ticker}.US`}
            price={venuePrice}
            depth={venueDepthUsd}
            drift={real ? ((venuePrice - real) / real) * 10_000 : null}
            facts={ISSUERS.backpack}
            mint={listed?.mint}
            venue={listed?.venue ? `${listed.venue}${listed.mic ? ` (${listed.mic})` : ''}` : undefined}
            expanded={open === 'backpack'}
            onToggle={() => {
              tactile.selectionTap();
              setOpen(open === 'backpack' ? null : 'backpack');
            }}
            depthLabel="across the top ten levels of the book"
          />
        )}

        {rows.map((q) => (
          <Row
            key={q.mint}
            title={ISSUERS[q.issuer].name}
            symbol={q.symbol}
            price={q.usdPrice}
            depth={q.liquidity}
            drift={driftBps(q)}
            facts={ISSUERS[q.issuer]}
            mint={q.mint}
            expanded={open === q.mint}
            onToggle={() => {
              tactile.selectionTap();
              setOpen(open === q.mint ? null : q.mint);
            }}
            depthLabel="pooled on chain"
          />
        ))}
      </div>

      {listed && (
        <div className="flex flex-col gap-2 pt-2.5 border-t border-[var(--card-border-subtle)]">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h4 className="text-[12.5px] font-bold text-[var(--text-primary)]">
              Where this size would actually fill
            </h4>
            <DataOrigin origin="venue" />
          </div>
          <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
            The mandate caps how wide a book the agent may trade into, and that
            number used to arrive from the agent itself. This asks a router
            instead: price a hundred dollars, price the real size, and the gap
            is what the trade costs for being that large. It is a public
            endpoint, so anyone can run it again and get the same answer.
          </p>

          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Trade size">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                onClick={() => {
                  tactile.selectionTap();
                  setSize(s);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                  size === s
                    ? 'bg-[var(--verdigris-chip-bg)] border-[var(--verdigris-chip-border)] text-[var(--verdigris)] font-bold'
                    : 'bg-[var(--card-surface)] border-[var(--card-border-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                ${s >= 1000 ? `${s / 1000}k` : s}
              </button>
            ))}
          </div>

          {costing && (
            <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">
              Pricing both sizes…
            </p>
          )}

          {!costing && cost?.geoBlocked && (
            <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
              The router will not price this from where you are. Backpack's
              tokens exclude several countries at the account rather than at the
              token, and this is that rule answering, from your connection and
              not from a server of ours. You can still hold {ticker} in an
              ordinary wallet and the mandate still governs it. What is closed
              is this particular way of buying it.
            </p>
          )}

          {!costing && cost && !cost.routable && !cost.geoBlocked && (
            <p className="text-[11.5px] text-[var(--text-secondary)]">
              Nothing on chain will fill ${size.toLocaleString()} of {ticker}{' '}
              right now. That is an answer, and it is the one a spread cap
              exists to act on.
            </p>
          )}

          {!costing && cost?.routable && (
            <div className="flex flex-col gap-1.5 text-[11px]">
              <Fact label="Filled by">
                {cost.route}
                {cost.probeRoute && cost.probeRoute !== cost.route
                  ? `, where a hundred dollars would go to ${cost.probeRoute}`
                  : ''}
                .
              </Fact>
              <Fact label="Cost of size">
                {(cost.impactBps ?? 0) >= 0 ? '' : '−'}
                {Math.abs(cost.impactBps ?? 0).toFixed(1)} basis points against
                the hundred dollar probe.
                {maxSpreadBps > 0 ? (
                  <>
                    {' '}
                    The sentence allows {(maxSpreadBps / 100).toFixed(2)}%, so
                    this{' '}
                    <strong
                      style={{
                        color:
                          (cost.impactBps ?? 0) > maxSpreadBps
                            ? 'var(--refused-rust)'
                            : 'var(--verdigris)',
                      }}
                    >
                      {(cost.impactBps ?? 0) > maxSpreadBps
                        ? 'would be refused'
                        : 'clears the book check'}
                    </strong>
                    .
                  </>
                ) : null}
              </Fact>
              <Fact label="Against the share">
                {(cost.driftBps ?? 0) >= 0 ? '+' : '−'}
                {Math.abs(cost.driftBps ?? 0).toFixed(0)} basis points{' '}
                {(cost.driftBps ?? 0) >= 0
                  ? 'over the share it stands for'
                  : 'under the share it stands for'}
                .{' '}
                {Math.abs(cost.driftBps ?? 0) > 100
                  ? 'Far enough to mean the arbitrage is not working.'
                  : 'Close enough that the wrapper is holding.'}
              </Fact>
              <span className="font-mono text-[9.5px] text-[var(--text-tertiary)] break-all">
                {listed.mint}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const Row: React.FC<{
  title: string;
  symbol: string;
  price: number | null;
  depth: number | null;
  drift: number | null;
  facts: (typeof ISSUERS)[keyof typeof ISSUERS];
  mint?: string;
  venue?: string;
  expanded: boolean;
  onToggle: () => void;
  depthLabel: string;
}> = ({ title, symbol, price, depth, drift, facts, mint, venue, expanded, onToggle, depthLabel }) => {
  const thin = !isDeep(depth);
  return (
    <div className="rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-2.5 py-2 text-left"
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[11.5px] font-bold text-[var(--text-primary)] whitespace-nowrap">
            {symbol}
          </span>
          <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
            {title}
          </span>
        </span>
        <span className="flex items-baseline gap-3 shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--text-primary)] font-bold">
            {price === null ? '—' : `$${price.toFixed(2)}`}
          </span>
          <span
            className={thin ? 'text-[var(--ember)] font-bold' : 'text-[var(--text-tertiary)]'}
            title={`${money(depth)} ${depthLabel}`}
          >
            {money(depth)}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0.5 flex flex-col gap-1.5 text-[11px] border-t border-[var(--card-border-subtle)]">
          <Fact label="What you own">{facts.instrument}</Fact>
          {venue && <Fact label="Listed on">{venue}</Fact>}
          <Fact label="Who may not">{facts.excluded}</Fact>
          <Fact label="To create one">{facts.mintGate}</Fact>
          <Fact label="Depth">
            {money(depth)} {depthLabel}
            {thin ? '. Thin enough that size is the risk here, not direction.' : '.'}
          </Fact>
          {drift !== null && (
            <Fact label="Against the share">
              {drift >= 0 ? '+' : ''}
              {drift.toFixed(0)} basis points.{' '}
              {Math.abs(drift) > 100
                ? 'Far enough to mean the arbitrage is not working.'
                : 'Close enough that the wrapper is holding.'}
            </Fact>
          )}
          {facts.issuerOverride && (
            <Fact label="Issuer keeps">
              A permanent delegate and a freeze authority on this mint. They can
              move or freeze it without your signature. Checked on chain, and true
              of every issuer here.
            </Fact>
          )}
          {mint && (
            <span className="font-mono text-[9.5px] text-[var(--text-tertiary)] break-all">
              {mint}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
    <span className="font-mono text-[9.5px] uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">
      {label}
    </span>
    <span className="text-[var(--text-secondary)] leading-snug min-w-0">{children}</span>
  </div>
);
