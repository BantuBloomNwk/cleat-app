// The real instrument universe and the real trading calendar.
//
// Until now every ticker and every session in this app was invented, which
// is a fair way to build a demo and a bad way to claim a mandate is
// enforced. Backpack Securities publishes both without a key: what is
// actually tradable, with the minimum quantity and step size each session
// will accept, and the four US equity sessions with their real hours and
// closures.
//
// That matters here more than it would in most apps, because two things
// the mandate can say are only meaningful against a real calendar:
//
//   "never hold overnight"  needs to know when overnight is, and it is
//                           8pm to 4am New York, not a number someone
//                           picked
//   a cap expressed as a share of the book has to come out as a quantity
//   the venue will accept, so the clamp has to land on a step size
//
// Everything here is read only and public. Minting and redeeming a
// security entitlement runs through an onboarded Backpack account and is
// not done from a browser.

export interface SecuritySession {
  name: string;
  minQuantity: string;
  maxQuantity: string;
  stepSize: string;
}

export interface Security {
  asset: string;   // "AAPL.US"
  name: string;    // "Apple Inc."
  cusip: string;
  sessions: SecuritySession[];
}

export interface MarketSession {
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface MarketHoliday {
  date: string;
  name: string;
  market: string;
  startTime: string;
  endTime: string;
}

const base = typeof window !== "undefined" ? "/api/backpack" : "";

async function load<T>(path: string): Promise<T | null> {
  if (!base) return null;
  try {
    const res = await fetch(`${base}?path=${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // The app has to work with this endpoint down, so every caller takes
    // null and falls back to what it showed before.
    return null;
  }
}

export const loadSecurities = () => load<Security[]>("securities");
export const loadSessions = () => load<MarketSession[]>("market-sessions");
export const loadHolidays = () => load<MarketHoliday[]>("market-holidays");

/** The shorthand the UI shows: "AAPL.US" reads as "AAPL". */
export const tickerOf = (asset: string) => asset.replace(/\.US$/, "");

/**
 * Which session New York is in right now.
 *
 * Computed from the exchange's own hours in its own timezone rather than
 * from the reader's clock, because a mandate that refuses overnight trades
 * has to mean the market's overnight, not the one where the phone is.
 */
export function currentSession(
  sessions: MarketSession[] | null,
  now: Date = new Date(),
): MarketSession | null {
  if (!sessions || sessions.length === 0) return null;

  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (t: string) => ny.find((p) => p.type === t)?.value ?? "";
  const clock = `${part("hour")}:${part("minute")}:${part("second")}`;
  const weekend = part("weekday") === "Sat" || part("weekday") === "Sun";

  for (const s of sessions) {
    const wraps = s.endTime <= s.startTime; // overnight crosses midnight
    const inside = wraps
      ? clock >= s.startTime || clock < s.endTime
      : clock >= s.startTime && clock < s.endTime;
    if (!inside) continue;
    // The weekend belongs to no session except the one that runs into
    // Monday morning, and that one is already closed by Saturday.
    if (weekend && !wraps) continue;
    return s;
  }
  return null;
}

/**
 * What a session is called when it is shown to someone.
 *
 * Note what this never says: closed. There are two clocks here and only
 * one of them stops. The US equities session calendar gates the request
 * for quote flow, and the Solana market, spot books and perpetuals, does
 * not close at all. On the Sunday this was written, with the New York
 * exchanges shut, SPY was doing two and a half thousand trades and half a
 * million dollars of volume on chain.
 *
 * Calling that "market closed" would be repeating the assumption the whole
 * category exists to break, so when New York is shut this says so about
 * New York and leaves the market out of it.
 */
export function sessionLabel(s: MarketSession | null): string {
  const m: Record<string, string> = {
    US_EQUITIES_PRE_MARKET: "Pre-market",
    US_EQUITIES_REGULAR: "NYSE open",
    US_EQUITIES_POST_MARKET: "After hours",
    US_EQUITIES_OVERNIGHT: "Overnight",
  };
  if (!s) return "NYSE shut";
  return m[s.name] ?? s.description;
}

/**
 * The tokenized markets, live.
 *
 * One unauthenticated call returns every ticker the venue quotes. The ones
 * that matter here carry a ".US_" in the symbol: "NVDA.US_USDC" is the
 * tokenized share, "NVDA.US_USDC_PERP" the perpetual on it.
 */
export interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  trades: number;
  high: string;
  low: string;
}

export async function loadTickers(): Promise<Ticker[] | null> {
  const all = await load<Ticker[]>("tickers");
  if (!all) return null;
  return all.filter((t) => t.symbol.includes(".US_"));
}

/**
 * Everything the venue has tokenized, whether or not it has an order book.
 *
 * The universe used to be whatever came back from tickers with a ".US_" in
 * the symbol, which is twenty one names. That is not the tokenized universe,
 * it is the subset of it that someone has stood up a book against, and the
 * two are a long way apart: the venue has fifty eight tokenized equities live
 * on Solana today. COPX and URA are both real, both withdrawable to a Solana
 * wallet, and neither has ever had a market, so neither could ever appear.
 *
 * Reading the asset list instead fixes that and fixes the next one too. A
 * name listed tomorrow shows up on the next cache expiry with nothing to
 * edit, where the old shape needed someone to notice.
 *
 * It also carries the mint, which is the thing the app needs in order to
 * name an instrument in a mandate and have the program enforce against it.
 */
export interface TokenizedAsset {
  /** "COPX.US" */
  asset: string;
  /** "COPX" */
  ticker: string;
  name: string;
  mint: string;
  decimals: number;
}

interface RawAssetToken {
  blockchain: string;
  contractAddress: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  nativeDecimals: number;
}
interface RawAsset {
  symbol: string;
  displayName: string;
  tokens: RawAssetToken[] | null;
}

export async function loadTokenized(): Promise<TokenizedAsset[] | null> {
  const all = await load<RawAsset[]>("assets");
  if (!all) return null;
  const out: TokenizedAsset[] = [];
  for (const a of all) {
    if (!a.symbol?.endsWith(".US")) continue;
    // Both flags, because a token you can deposit and not withdraw is not
    // something to put in front of someone as tradable.
    const sol = (a.tokens ?? []).find(
      (t) =>
        t.blockchain === "Solana" &&
        t.depositEnabled &&
        t.withdrawEnabled &&
        !!t.contractAddress,
    );
    if (!sol) continue;
    out.push({
      asset: a.symbol,
      ticker: a.symbol.replace(/\.US$/, ""),
      name: a.displayName || a.symbol,
      mint: sol.contractAddress,
      decimals: sol.nativeDecimals,
    });
  }
  return out.sort((x, y) => x.ticker.localeCompare(y.ticker));
}

/** Which of the tokenized names actually has a book, and on what symbol. */
export function marketsFor(
  asset: TokenizedAsset,
  tickers: Ticker[] | null,
): { spot?: string; perp?: string } {
  const spot = `${asset.asset}_USDC`;
  const perp = `${spot}_PERP`;
  const has = (sym: string) => (tickers ?? []).some((t) => t.symbol === sym);
  return { spot: has(spot) ? spot : undefined, perp: has(perp) ? perp : undefined };
}

/** "NVDA.US_USDC_PERP" reads as "NVDA". */
export const symbolTicker = (symbol: string) =>
  symbol.split("_")[0].replace(/\.US$/, "");

export const isPerp = (symbol: string) => symbol.endsWith("_PERP");

/**
 * Is anything actually trading, and how much.
 *
 * Used to say the true thing when New York is shut, which is that the
 * market is still here.
 */
export function liveSummary(tickers: Ticker[] | null): {
  markets: number;
  trades: number;
} | null {
  if (!tickers || tickers.length === 0) return null;
  return {
    markets: tickers.length,
    trades: tickers.reduce((a, t) => a + (Number(t.trades) || 0), 0),
  };
}

/**
 * Round a quantity down onto the step size the session will accept.
 *
 * This is the same clamp the mandate already performs, carried through to
 * the number the venue would actually take. A cap that produces 3.14159
 * shares of something quoted in whole shares is not a cap that was
 * enforced, it is one that was described.
 */
export function clampToStep(qty: number, session: SecuritySession): number {
  const step = Number(session.stepSize);
  const min = Number(session.minQuantity);
  const max = Number(session.maxQuantity);
  if (!Number.isFinite(step) || step <= 0) return qty;
  const stepped = Math.floor(qty / step) * step;
  // stepSize is decimal, so bring it back off the floating point fuzz
  const dp = (session.stepSize.split(".")[1] ?? "").length;
  const clean = Number(stepped.toFixed(dp));
  if (clean < min) return 0;
  return Math.min(clean, max);
}

/** One hourly candle, as the venue reports it. */
export interface Kline {
  start: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: string;
}

export async function loadKlines(
  symbol: string,
  interval = "1h",
): Promise<Kline[] | null> {
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}?path=klines&symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as Kline[];
  } catch {
    return null;
  }
}

export interface Depth {
  bids: [string, string][];
  asks: [string, string][];
}

export async function loadDepth(symbol: string): Promise<Depth | null> {
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}?path=depth&symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as Depth;
  } catch {
    return null;
  }
}

/**
 * How wide the book is, and how much sits near the touch.
 *
 * This is the number a mandate should be sizing against when the New York
 * exchanges are shut. On the Sunday this was written, the same venue was
 * quoting NVDA's perpetual at half a basis point across seventy-eight
 * levels and Micron's spot at thirty-five basis points across twelve. An
 * agent that treats those two as the same market is the agent this whole
 * product exists to bound.
 *
 * Backpack returns bids ascending, so the best bid is the last of them.
 */
export function bookQuality(d: Depth | null): {
  spreadBps: number;
  nearDepthUsd: number;
  levels: number;
} | null {
  if (!d || d.bids.length === 0 || d.asks.length === 0) return null;
  const bestBid = Number(d.bids[d.bids.length - 1][0]);
  const bestAsk = Number(d.asks[0][0]);
  if (!Number.isFinite(bestBid) || bestBid <= 0) return null;
  const nearDepthUsd = d.bids
    .slice(-10)
    .reduce((a, [px, qty]) => a + Number(px) * Number(qty), 0);
  return {
    spreadBps: ((bestAsk - bestBid) / bestBid) * 10_000,
    nearDepthUsd,
    levels: Math.min(d.bids.length, d.asks.length),
  };
}

/** Wide enough that size is the thing that will hurt you. */
export const isThin = (q: ReturnType<typeof bookQuality>) =>
  !!q && (q.spreadBps > 15 || q.levels < 15);

/**
 * Which of the three clocks a symbol trades on.
 *
 * They are not the same market wearing different names, and a mandate that
 * treats them as one is under specified:
 *
 *   rfq    the broker quoting against real share inventory. Open only in
 *          New York's session, and the only leg the session calendar
 *          actually gates.
 *   clob   the venue's own book, spot and perpetual. Never closes, and
 *          still behind the venue's account, so it is always open and
 *          never permissionless.
 *   chain  the token itself, once withdrawn. Trades on any Solana venue
 *          that lists it, needs nothing but a wallet, and has no circuit
 *          breaker of any kind.
 *
 * Only the last of those is permissionless, which is the distinction the
 * phrase "24/7" hides.
 */
export type Venue = "rfq" | "clob" | "chain";

export function venueOf(symbol: string): Venue {
  if (symbol.endsWith("_RFQ")) return "rfq";
  return "clob";
}

/**
 * A perpetual is not a share.
 *
 * No entitlement, no redemption, cash settled against a single name, which
 * makes it a security based swap rather than a security. It matters for
 * what the product may say about itself, so it is a function rather than a
 * comment.
 */
export const isEntitlement = (symbol: string) => !isPerp(symbol);
