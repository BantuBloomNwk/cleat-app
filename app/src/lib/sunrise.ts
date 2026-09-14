// Which mint is the real one, and what a trade in it would cost.
//
// Backpack Securities issues and custodies the share. Sunrise is where the
// resulting token is listed, so it is the issuer's own answer to "which
// address is the real Micron", and it is the answer that moves when a
// listing moves. Hardcoding an address is how an agent ends up holding
// something that shares four letters with what it meant to buy.
//
// The second thing here matters more. Cleat's mandate carries a spread
// cap, and the number it was checked against used to arrive from the
// agent, which is the weakest input in the design and is written up as
// such. A quote engine that routes real size answers the same question
// without asking the agent: price a small probe, price the real size, and
// the difference is what this trade costs for being this large. Anyone can
// rerun it against the same public endpoint and get the same number.

export interface SunriseStock {
  ticker: string;
  mint: string;
  name: string;
  decimals: number;
  issuer: string | null;
  tokenProgram: string;
  /** ISO 10383 market identifier, so XNAS rather than "Nasdaq". */
  mic: string;
  venue: string;
  currency: string;
  icon: string | null;
}

export interface RouteCost {
  mint: string;
  usd: number;
  routable: boolean;
  /** The request was refused for where it came from, not for what it asked. */
  geoBlocked?: boolean;
  probeUsd?: number;
  /** Who would actually fill it. */
  route?: string;
  probeRoute?: string;
  /** How far the wrapper trades from the price the quote references. */
  driftBps?: number;
  /** What this size costs for being this size. The number a cap wants. */
  impactBps?: number;
  outAmount?: string;
}

const base = typeof window !== "undefined" ? "/api/sunrise" : "";

let universeCache: Promise<SunriseStock[]> | null = null;

export function loadSunriseUniverse(): Promise<SunriseStock[]> {
  if (!base) return Promise.resolve([]);
  if (!universeCache) {
    universeCache = fetch(base)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => (j.rows ?? []) as SunriseStock[])
      .catch(() => []);
  }
  return universeCache;
}

/** The canonical mint for a plain ticker, or null if this venue has no such name. */
export async function resolveMint(ticker: string): Promise<SunriseStock | null> {
  const all = await loadSunriseUniverse();
  return all.find((t) => t.ticker === ticker.toUpperCase()) ?? null;
}

// ── Pricing ──────────────────────────────────────────────────────────
//
// Asked for by the browser, not by a function on our origin, and that is
// deliberate rather than convenient. Sunrise answers a quote with 403
// GEO_BLOCKED depending on where the request comes from, and the region
// that decides whether somebody may trade is the one they are sitting in.
// A server side proxy would move the check to a machine in Virginia and
// answer a question nobody asked. Here it is the real answer, and when it
// comes back no, the screen says so rather than showing an empty box.

const SUNRISE = "https://api.sunrise.xyz";
/** USDC on Solana mainnet. Sunrise prices against it and does not list it. */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** What a probe trade costs, in the same units as the real one. */
const PROBE_USD = 100;

interface RawQuote {
  route: string;
  inUsd: number;
  outUsd: number;
  outAmount: string;
}

async function quote(
  toToken: string,
  usd: number,
): Promise<RawQuote | "geo" | null> {
  try {
    const res = await fetch(`${SUNRISE}/v1/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fromToken: USDC,
        toToken,
        fromAmount: String(Math.round(usd * 1e6)),
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      return body?.error?.code === "GEO_BLOCKED" ? "geo" : null;
    }
    const q = body?.data?.quotes?.[0];
    if (!q) return null;
    return {
      route: String(q.routeName ?? "unknown"),
      inUsd: Number(q.fromAmountUSD),
      outUsd: Number(q.toAmountUSD),
      outAmount: String(q.toAmount),
    };
  } catch {
    return null;
  }
}

export async function loadRouteCost(
  mint: string,
  usd: number,
): Promise<RouteCost | null> {
  if (typeof window === "undefined") return null;

  const [probe, real] = await Promise.all([quote(mint, PROBE_USD), quote(mint, usd)]);
  if (probe === "geo" || real === "geo") {
    return { mint, usd, routable: false, geoBlocked: true };
  }
  if (!probe || !real) return { mint, usd, routable: false };

  const rate = (q: RawQuote) => q.outUsd / q.inUsd;
  // Negative when the token trades under the reference price the quote
  // carries, which is the wrapper's discount rather than a cost.
  const driftBps = (1 - rate(probe)) * 10_000;
  // What this size costs for being this size, against the probe. This is
  // the number a spread cap should be checked against, and the only one
  // here that an agent could not have made up.
  const impactBps = (rate(probe) - rate(real)) * 10_000;

  return {
    mint,
    usd,
    routable: true,
    probeUsd: PROBE_USD,
    route: real.route,
    probeRoute: probe.route,
    driftBps,
    impactBps,
    outAmount: real.outAmount,
  };
}

/**
 * Every canonical mint for one company, across every issuer we can name.
 *
 * This is the part a deny list needs and did not have. "No fossil fuels"
 * resolves to a list of mints, and a list that names one issuer's wrapper
 * stops nothing: MicroStrategy exists right now as a Backpack token, as
 * Backed's MSTRx and as Ondo's MSTRon, three addresses for one company. An
 * agent refused at the first one routes to the second without breaking a
 * rule, because the rule only knew about the first.
 *
 * So a clause has to resolve across issuers or it is decoration. The
 * mandate holds eight mints, which is two or three companies once this is
 * done honestly, and that ceiling is worth knowing about before somebody
 * writes a sentence that rules out a sector.
 */
export interface ResolvedMint {
  mint: string;
  issuer: string;
  symbol: string;
}

export async function resolveAcrossIssuers(
  ticker: string,
): Promise<ResolvedMint[]> {
  const t = ticker.toUpperCase();
  const out: ResolvedMint[] = [];

  const sun = await resolveMint(t);
  if (sun) {
    out.push({
      mint: sun.mint,
      issuer: "Backpack Securities",
      symbol: sun.ticker,
    });
  }

  try {
    const res = await fetch(`/api/issuers?ticker=${encodeURIComponent(t)}`);
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        symbol: string;
        mint: string;
        issuer: string;
      }>;
      for (const r of rows) {
        if (out.some((o) => o.mint === r.mint)) continue;
        out.push({
          mint: r.mint,
          issuer: r.issuer === "ondo" ? "Ondo Global Markets" : "Backed, xStocks",
          symbol: r.symbol,
        });
      }
    }
  } catch {
    // One issuer missing is a shorter list, not a broken screen.
  }

  return out;
}

/** What a mint on a deny list actually is. */
export interface IdentifiedMint {
  mint: string;
  symbol: string | null;
  name: string | null;
  issuer: string | null;
}

const ISSUER_NAMES: Record<string, string> = {
  xstocks: "Backed",
  ondo: "Ondo",
};

export function issuerLabel(id: string | null): string {
  return id ? (ISSUER_NAMES[id] ?? id) : "unknown issuer";
}

/**
 * Turn a deny list back into something a person can check.
 *
 * Four base58 strings say nothing about whether they cover one company or
 * four, or whether an issuer has been missed. Resolved, they say it, and
 * the gap in a clause becomes visible instead of being asserted.
 */
export async function identifyMints(mints: string[]): Promise<IdentifiedMint[]> {
  if (typeof window === "undefined" || mints.length === 0) return [];
  try {
    const res = await fetch(
      `/api/issuers?mints=${encodeURIComponent(mints.join(","))}`,
    );
    if (!res.ok) return [];
    return (await res.json()) as IdentifiedMint[];
  } catch {
    return [];
  }
}
