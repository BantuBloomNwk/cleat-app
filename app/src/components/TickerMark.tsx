import React, { useEffect, useState } from 'react';

/**
 * The company's mark next to its name.
 *
 * Every app anyone compares this one to puts a small circular logo to the
 * left of a symbol, in a list, on a chart, in a notification. This one put
 * bare text everywhere, and bare text in a monospace face is what makes a
 * screen full of tickers read as a log file rather than as a market.
 *
 * Two things make it safe to add. The issuer already publishes an icon for
 * every tokenized name, so nothing here is invented or scraped. And a mark
 * that fails to load falls back to a monogram rather than a hole, because a
 * broken image is worse than no image and the network is not owed trust.
 *
 * The fallback colour is derived from the letters themselves, so a name has
 * the same colour everywhere it appears and nobody has to maintain a table.
 */

/** Names the venue has no mark for. Asked once, never asked again. */
const MISSING = new Set<string>();

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

/** Ticker to icon, read once and shared. */
async function iconMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const m = new Map<string, string>();
    try {
      const res = await fetch('/api/sunrise');
      if (res.ok) {
        const body = (await res.json()) as { rows?: { ticker: string; icon?: string }[] };
        for (const r of body.rows ?? []) {
          if (r.icon) m.set(r.ticker.toUpperCase(), r.icon);
        }
      }
    } catch {
      // A screen without logos is a worse screen, not a broken one.
    }
    cache = m;
    return m;
  })();
  return inflight;
}

/**
 * A deterministic identicon, the Gravatar way.
 *
 * The first version of this put two letters in a coloured circle, which is
 * the same thing a thousand other products do and reads as a placeholder
 * rather than as a mark. An identicon is the older and better idea: hash the
 * name, use the bits to fill a small grid, mirror it so the result looks
 * deliberate rather than noisy, and take the colour from the same hash.
 *
 * Same name, same mark, everywhere, forever, with nothing stored and nothing
 * fetched. It also matters more here than in most places, because half the
 * things this app names are not listed companies at all: a Pyth asset class
 * or a private company before any exchange lists it has no published logo to
 * fall back to, and those rows were the ones left bare.
 */
const hashOf = (s: string) => {
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  return a;
};

/** Five columns, mirrored about the centre, so it reads as a shape. */
function cellsOf(seed: number): boolean[][] {
  const rows: boolean[][] = [];
  let h = seed;
  const next = () => (h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0);
  for (let y = 0; y < 5; y++) {
    const left = [0, 1, 2].map(() => (next() & 0x3) > 0);
    rows.push([left[0], left[1], left[2], left[1], left[0]]);
  }
  return rows;
}

/**
 * The ticker inside whatever the feed calls it.
 *
 * Three feeds name the same company three ways and none of them match the
 * key the issuer publishes its icon under. Backpack says NVDA.US_USDC_PERP.
 * Pyth says Equity.US.TSLA/USD, or Commodities.WTIZ6/USD for a thing that
 * is not a company at all. PreStocks says SPACEX where the issuer says
 * SPCX. Every row in two whole lists was falling back to an identicon, and
 * because the identicon looks deliberate rather than broken, it looked like
 * a design choice instead of a failed lookup.
 *
 * Anything with no published icon still falls back, which is correct: a
 * crude oil future and a private company nobody has listed do not have
 * logos, and inventing one would be worse than drawing a mark.
 */
const ALIASES: Record<string, string> = {
  SPACEX: 'SPCX',
  // Pyth names a feed, not a tradable thing, and the mark is published
  // against the instrument people actually buy. Gold is XAU on the oracle
  // and GLD on an exchange; the euro is EUR and FXE; December crude is
  // WTIZ6 and USO. Without these three the only rows left bare were the
  // ones that are not companies, which read as the feature half working.
  XAU: 'GLD',
  EUR: 'FXE',
  WTIZ6: 'USO',
};

export function tickerOf(symbol: string): string {
  let t = symbol.split('/')[0];        // Equity.US.TSLA/USD -> Equity.US.TSLA
  t = t.split('_')[0];                 // NVDA.US_USDC_PERP  -> NVDA.US
  const parts = t.split('.');
  // NVDA.US keeps its head, Equity.US.TSLA keeps its tail. The difference
  // is whether the last segment is the country tag.
  t = parts.length > 1 && /^(US|USD)$/i.test(parts[parts.length - 1])
    ? parts[0]
    : parts[parts.length - 1];
  t = t.toUpperCase();
  return ALIASES[t] ?? t;
}

export const TickerMark: React.FC<{
  /** "NVDA", "NVDA.US" or "NVDA.US_USDC_PERP" all work. */
  symbol: string;
  /**
   * A mark the caller already has. PreStocks ships one for every private
   * company it lists, which is the only source for names no exchange has
   * listed, and looking those up by ticker was never going to find them.
   */
  image?: string | null;
  /**
   * Whether this names a listed company at all.
   *
   * The venue's endpoint answers for stock tickers, so asking it about a
   * crypto or commodity feed returns whichever company happens to share
   * those letters. SOL came back as ReneSola, a solar manufacturer, which
   * is a worse answer than no answer: a wrong logo is read as fact.
   */
  equity?: boolean;
  size?: number;
  className?: string;
}> = ({ symbol, image, equity = true, size = 18, className = '' }) => {
  const ticker = tickerOf(symbol);
  // When the caller already handed over a mark there is nothing to look up,
  // so it should be on the first frame. Setting it in the effect instead
  // meant one paint of identicon before the real thing replaced it, which
  // is exactly the flicker people notice on the row that scrolls past.
  const [src, setSrc] = useState<string | null>(() =>
    image ? `/api/backpack?path=hosted&url=${encodeURIComponent(image)}` : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (image) {
        setSrc(`/api/backpack?path=hosted&url=${encodeURIComponent(image)}`);
        return;
      }
      // A cached map answers in the same tick, so a mark already known does
      // not flash an identicon on the way in either.
      if (cache) {
        const hit = cache.get(ticker);
        if (hit) { setSrc(hit); return; }
      }
      const m = await iconMap();
      // The issuer's own icon first, because it is the one that matches the
      // token. Anything with no token falls through to the venue's mark,
      // which covers names that trade here as perpetuals only and so appear
      // in no token list at all.
      const own = m.get(ticker);
      if (own) { if (live) setSrc(own); return; }
      // Not a listed company, so there is nothing to ask about and asking
      // would return somebody else's logo.
      if (!equity) return;

      // Ask before drawing. Pointing an img tag at a name with no mark puts
      // a 404 in the console for every private company on the screen, and a
      // console full of expected failures is where a real one goes to hide.
      // A fetch that comes back 404 is a value, not an error.
      if (MISSING.has(ticker)) return;
      try {
        // Asked in JSON, which always answers 200, so a name with no mark
        // costs a value rather than an error. Pointing an img at it or
        // reading a status both put a 404 in the console for every private
        // company on screen.
        const res = await fetch(`/api/backpack?path=haslogo&symbol=${ticker}`);
        const { ok } = (await res.json()) as { ok: boolean };
        if (!live) return;
        if (ok) setSrc(`/api/backpack?path=logo&symbol=${ticker}`);
        else MISSING.add(ticker);
      } catch {
        MISSING.add(ticker);
      }
    })();
    return () => {
      live = false;
    };
  }, [ticker, image, equity]);

  const style: React.CSSProperties = { width: size, height: size };

  if (!src || failed) {
    const seed = hashOf(ticker);
    const hue = seed % 360;
    const cells = cellsOf(seed);
    return (
      <svg
        className={`ticker-mark ${className}`}
        style={style}
        viewBox="0 0 5 5"
        role="img"
        aria-label={ticker}
      >
        <rect width="5" height="5" fill={`hsl(${hue} 38% 17%)`} />
        {cells.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width="1"
                height="1"
                fill={`hsl(${hue} 62% ${58 + ((x * 7 + y * 5) % 14)}%)`}
              />
            ) : null,
          ),
        )}
      </svg>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={`ticker-mark ${className}`}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};
