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

export const TickerMark: React.FC<{
  /** "NVDA", "NVDA.US" or "NVDA.US_USDC_PERP" all work. */
  symbol: string;
  size?: number;
  className?: string;
}> = ({ symbol, size = 18, className = '' }) => {
  const ticker = symbol.split('_')[0].replace(/\.US$/i, '').toUpperCase();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    iconMap().then((m) => {
      if (live) setSrc(m.get(ticker) ?? null);
    });
    return () => {
      live = false;
    };
  }, [ticker]);

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
