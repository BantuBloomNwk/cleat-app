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
