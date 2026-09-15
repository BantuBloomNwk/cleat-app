// What the agent is watching, across asset classes, and what the sentence
// makes of it.
//
// The first attempt at this asked for Apple as an equity alongside Backed's
// and Ondo's wrappers, and all three came back 403. That was read as the
// trial being too small. It was not: the trial entitles twenty five named
// symbols and Apple is not among them. Six of them are, across six different
// asset classes, and that turns out to be the more interesting build anyway.
//
// The useful one is oil. Four WTI contracts are entitled, and the mandate
// this app demonstrates says no fossil fuels. So a real crude price moving is
// a real reason for an agent to want energy exposure, and a real refusal
// comes back, decided against a deny list naming actual mints. Nothing about
// that chain is staged: the price is published by Pyth, the rule is on chain,
// and the refusal is in a ring buffer anyone can read.
//
// Two things about the plumbing, both learned expensively. The host is
// pyth.dourolabs.app, not hermes.pyth.network, which answers the feed
// catalogue to anyone and 401s on every price path, so against the wrong host
// a good key looks like a bad one. And the endpoint takes a symbol rather
// than a feed id, which makes the ids Hermes hands out useless here.
const HOST = "https://pyth.dourolabs.app";
const KEY = process.env.PYTH_API_KEY ?? "";

/** Six of the twenty five the trial entitles, one per asset class. */
const WATCHED = [
  {
    symbol: "Equity.US.TSLA/USD",
    label: "Tesla",
    klass: "A single name",
    note: "One company, which is what a position cap is a cap on.",
  },
  {
    symbol: "Equity.US.QQQ/USD",
    label: "Nasdaq 100",
    klass: "An index",
    note: "A basket, so a sector cap reads differently against it than against one name.",
  },
  {
    symbol: "Commodities.WTIZ6/USD",
    label: "Crude oil, Dec",
    klass: "Fossil fuel",
    note: "The sentence rules this out by name. A price moving here is a reason to want exposure and the mandate refuses it anyway.",
    denied: true,
  },
  {
    symbol: "Metal.XAU/USD",
    label: "Gold",
    klass: "Metal",
    note: "Trades around the clock, like everything on this screen and unlike New York.",
  },
  {
    symbol: "FX.EUR/USD",
    label: "Euro",
    klass: "Currency",
    note: "What the book is worth depends on this, which is easy to forget when the caps are in percentages.",
  },
  {
    symbol: "Crypto.SOL/USD",
    label: "Solana",
    klass: "Crypto",
    note: "What the fees and the rent are paid in.",
  },
];

let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 5 * 60 * 1000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });

/**
 * Where a symbol is now and where it was, from one call.
 *
 * The history endpoint is the one whose syntax is known to work, and a month
 * of daily closes gives both the latest price and something to compare it
 * with, which is what makes a move rather than a number.
 */
async function series(symbol: string) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 60 * 60 * 24 * 30;
  const res = await fetch(
    `${HOST}/v1/fixed_rate@1000ms/history?symbol=${encodeURIComponent(symbol)}` +
      `&from=${from}&to=${to}&resolution=1D`,
    { headers: { authorization: `Bearer ${KEY}`, accept: "application/json" } },
  );
  if (!res.ok) return { error: String(res.status) };
  const b = (await res.json()) as any;
  const c: number[] = (b?.c ?? []).filter((n: number) => Number.isFinite(n));
  if (c.length === 0) return { error: "no points" };
  const price = c[c.length - 1];
  const prev = c.length > 1 ? c[c.length - 2] : price;
  const first = c[0];
  return {
    price,
    dayBps: prev > 0 ? ((price - prev) / prev) * 10_000 : 0,
    monthBps: first > 0 ? ((price - first) / first) * 10_000 : 0,
    // The whole series, because it was already fetched and thrown away. A
    // markets screen with no chart on it is a strange thing, and the data
    // for one has been arriving in this response the entire time.
    series: c,
    at: (b?.t ?? []).slice(-c.length),
  };
}

export default async () => {
  if (!KEY) {
    return json({
      priced: false,
      reason:
        "Pyth gates prices behind a paid tier. The feeds are named because that much is true without a key, and the numbers are not guessed.",
      rows: WATCHED,
    });
  }
  if (cache && Date.now() - cache.at < TTL_MS) return json(cache.body);

  try {
    const rows = [];
    for (const w of WATCHED) rows.push({ ...w, ...(await series(w.symbol)) });
    const body = { priced: rows.some((r: any) => r.price), asOf: Date.now(), rows };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (err) {
    return json({ priced: false, reason: String(err).slice(0, 140), rows: WATCHED });
  }
};

export const config = { path: "/api/pyth" };
