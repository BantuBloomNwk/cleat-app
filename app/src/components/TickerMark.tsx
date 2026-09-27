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

/**
 * Marks that ship with the app.
 *
 * The venue's endpoint only knows about listed companies, so asking it for
 * a crypto ticker returns whichever company happens to share the letters:
 * SOL came back as ReneSola, a solar manufacturer. Not asking at all left
 * Solana with an identicon on a Solana app, which is worse than wrong in a
 * different way. These few are held locally, taken from the issuer's own
 * brand page, so they are right and they cost no request at all.
 */
const LOCAL: Record<string, string> = {
  SOL: '/marks/sol.svg',
  // Gold, the euro and December crude are not companies, so there is no
  // company mark to find. They were pointed at the exchange traded funds
  // that track them, which is a defensible answer and a bad looking one:
  // two of those funds have the same sponsor, so the index and the currency
  // came up wearing the same blue circle and read as a duplicate. A plain
  // symbol says what the thing is and claims nothing that is not true.
  XAU: '/marks/gold.svg',
  EUR: '/marks/eur.svg',
  WTIZ6: '/marks/oil.svg',
};

/** Names the venue has no mark for. Asked once, never asked again. */
const MISSING = new Set<string>();

/**
 * What this device already learned, kept for a day.
 *
 * Every launch used to redo up to three round trips per name before a logo
 * could appear, and on a slow phone that is a second or two of identicon
 * that then turns into something else, which reads as the wrong logo
 * followed by the right one. Remembered, a name seen yesterday has its mark
 * on the first frame. An empty string means "looked, there is none".
 */
const MEMO_KEY = 'cleat_marks_v1';
const MEMO_TTL_MS = 24 * 60 * 60 * 1000;
const known = new Map<string, string>();
try {
  const raw = JSON.parse(localStorage.getItem(MEMO_KEY) ?? 'null') as { at: number; marks: Record<string, string> } | null;
  if (raw && Date.now() - raw.at < MEMO_TTL_MS) {
    for (const [k, v] of Object.entries(raw.marks)) {
      known.set(k, v);
      if (v === '') MISSING.add(k);
    }
  }
} catch { /* no memory, look everything up */ }
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function remember(ticker: string, src: string) {
  if (known.get(ticker) === src) return;
  known.set(ticker, src);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(MEMO_KEY, JSON.stringify({ at: Date.now(), marks: Object.fromEntries(known) }));
    } catch { /* remembered for this session only */ }
  }, 800);
}

/** What can be shown for a name without asking anybody. */
function immediate(ticker: string, image?: string | null): string | null | undefined {
  if (LOCAL[ticker]) return LOCAL[ticker];
  if (image) return `/api/backpack?path=hosted&url=${encodeURIComponent(image)}`;
  const k = known.get(ticker) ?? cache?.get(ticker);
  if (k !== undefined) return k === '' ? null : k;
  if (MISSING.has(ticker)) return null;
  return undefined; // not known yet
}

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
  // The state carries the ticker it belongs to. Switching names used to
  // leave the previous company's logo up until the new lookup finished,
  // so for a moment Tesla wore Nvidia's mark. A state for another ticker is
  // simply not used.
  const [state, setState] = useState<{ ticker: string; src: string | null | undefined; failed: boolean }>(
    () => ({ ticker, src: immediate(ticker, image), failed: false }),
  );
  const current = state.ticker === ticker ? state : { ticker, src: immediate(ticker, image), failed: false };
  const src = current.src;
  const failed = current.failed;
  const setSrc = (v: string | null) => setState({ ticker, src: v, failed: false });
  const setFailed = () => setState((s) => ({ ...s, failed: true }));

  useEffect(() => {
    let live = true;
    const now = immediate(ticker, image);
    setState({ ticker, src: now, failed: false });
    if (now !== undefined) return () => { live = false; };
    (async () => {
      const m = await iconMap();
      const own = m.get(ticker);
      if (own) { remember(ticker, own); if (live) setSrc(own); return; }
      // Not a listed company, so there is nothing to ask about and asking
      // would return somebody else's logo.
      if (!equity) { if (live) setSrc(null); return; }
      if (MISSING.has(ticker)) { if (live) setSrc(null); return; }
      try {
        // Asked in JSON, which always answers 200, so a name with no mark
        // costs a value rather than an error in the console.
        const res = await fetch(`/api/backpack?path=haslogo&symbol=${ticker}`);
        const { ok } = (await res.json()) as { ok: boolean };
        const url = ok ? `/api/backpack?path=logo&symbol=${ticker}` : '';
        if (!ok) MISSING.add(ticker);
        remember(ticker, url);
        if (live) setSrc(url || null);
      } catch {
        MISSING.add(ticker);
        if (live) setSrc(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [ticker, image, equity]); // eslint-disable-line react-hooks/exhaustive-deps

  const style: React.CSSProperties = { width: size, height: size };

  // Still finding out. A quiet disc rather than an identicon, because an
  // identicon that turns into a logo half a second later reads as the wrong
  // mark being corrected.
  if (src === undefined && !failed) {
    return <span className={`ticker-mark ticker-mark-pending ${className}`} style={style} aria-label={ticker} role="img" />;
  }

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
      // Not lazy. These are eighteen pixel vectors, and lazy loading them
      // means a tile scrolled off the right of a shelf shows nothing until
      // it is dragged into view, which is the flicker rather than a saving.
      className={`ticker-mark ${className}`}
      style={style}
      onError={() => setFailed()}
    />
  );
};

/** Held so a preload is not collected before it lands in the image cache. */
const warm = new Set<HTMLImageElement>();

/**
 * Resolve and download marks before they are needed.
 *
 * The ticker board changes name every few seconds, and a mark looked up at
 * the moment of the switch arrived a second or two after the name did. Called
 * with the names about to be shown, so each switch finds its mark already in
 * the browser's cache and draws on the same frame as the text.
 */
export async function preloadMarks(symbols: string[]) {
  const m = await iconMap();
  for (const sym of symbols) {
    const t = tickerOf(sym);
    let src = immediate(t);
    if (src === undefined) {
      const own = m.get(t);
      if (own) {
        remember(t, own);
        src = own;
      } else {
        try {
          const res = await fetch(`/api/backpack?path=haslogo&symbol=${t}`);
          const { ok } = (await res.json()) as { ok: boolean };
          src = ok ? `/api/backpack?path=logo&symbol=${t}` : null;
          if (!ok) MISSING.add(t);
          remember(t, src ?? '');
        } catch {
          continue;
        }
      }
    }
    if (!src) continue;
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => { warm.delete(img); };
    warm.add(img);
    img.src = src;
  }
}
