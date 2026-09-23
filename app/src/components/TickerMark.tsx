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

/** Stable hue from the letters, so a name keeps its colour across screens. */
const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

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

  const hue = hueOf(ticker);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(7, Math.round(size * 0.42)),
  };

  if (!src || failed) {
    return (
      <span
        className={`ticker-mark ticker-mark-fallback ${className}`}
        style={{
          ...style,
          background: `hsl(${hue} 42% 22%)`,
          color: `hsl(${hue} 70% 78%)`,
        }}
        aria-hidden="true"
      >
        {ticker.slice(0, 2)}
      </span>
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
