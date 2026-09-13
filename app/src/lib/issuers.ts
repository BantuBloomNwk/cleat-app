// What each issuer actually is, checked rather than repeated.
//
// Three companies have tokenized the same American shares onto Solana and
// the results are not the same instrument. One is a claim on a share held
// by a registered broker dealer. One is a Jersey issued note under a
// prospectus that excludes several countries by contract. One mints only
// against a signed attestation from its own compliance service. They trade
// under the same ticker and a price chart cannot tell them apart.
//
// The mint facts below were read off Solana mainnet with getAccountInfo,
// not taken from a landing page. Every one of these tokens is Token-2022
// with a permanent delegate and a freeze authority live, and a transfer
// hook slot present but not wired to any program. So anyone can hold one
// today, and the issuer can move it out of their account tomorrow without
// their signature. That is the industry pattern rather than one company's
// flaw, and a product that does not say so is hiding the thing that
// matters most about what its users are holding.

export type IssuerId = "backpack" | "xstocks" | "ondo";

export interface IssuerFacts {
  id: IssuerId;
  name: string;
  /** What the holder actually owns, in one line. */
  instrument: string;
  /** Who may not hold it, by contract rather than by code. */
  excluded: string;
  /** Whether the issuer retains a standing override on the token. */
  issuerOverride: boolean;
  /** What has to happen before a new one can be created. */
  mintGate: string;
}

export const ISSUERS: Record<IssuerId, IssuerFacts> = {
  backpack: {
    id: "backpack",
    name: "Backpack Securities",
    instrument: "A claim on a share held by a registered US broker dealer",
    excluded: "US, UK, UAE and Japan, at the account rather than the token",
    issuerOverride: true,
    mintGate: "A verified Backpack account, then withdraw to Solana",
  },
  xstocks: {
    id: "xstocks",
    name: "Backed, xStocks",
    instrument: "A Jersey issued note tracking the share, under a prospectus",
    excluded: "US, UK, Canada and Australia, by the terms of the offering",
    issuerOverride: true,
    mintGate: "An onboarded distributor, not the public",
  },
  ondo: {
    id: "ondo",
    name: "Ondo Global Markets",
    instrument: "A tokenized share minted against a signed attestation",
    excluded: "Set by Ondo's own compliance service, which signs each mint",
    issuerOverride: true,
    mintGate: "A secp256k1 attestation from Ondo before the program will mint",
  },
};

export interface IssuerQuote {
  symbol: string;
  mint: string;
  issuer: IssuerId;
  usdPrice: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
  realPrice: number | null;
  decimals: number | null;
}

const base = typeof window !== "undefined" ? "/api/issuers" : "";

export async function loadIssuerQuotes(
  ticker: string,
): Promise<IssuerQuote[] | null> {
  if (!base) return null;
  try {
    const res = await fetch(`${base}?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) return null;
    return (await res.json()) as IssuerQuote[];
  } catch {
    return null;
  }
}

/**
 * How far the token has drifted from the share it stands for.
 *
 * A wrapper that is holding trades at the price of the thing inside it.
 * One that is not tells you something the ticker does not: that the
 * arbitrage is thin, or the redemption is slow, or nobody is watching.
 */
export function driftBps(q: IssuerQuote): number | null {
  if (!q.usdPrice || !q.realPrice) return null;
  return ((q.usdPrice - q.realPrice) / q.realPrice) * 10_000;
}

/** Enough depth that a normal sized order is not the whole book. */
export const isDeep = (liquidity: number | null) =>
  typeof liquidity === "number" && liquidity >= 100_000;
