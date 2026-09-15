// The share, the wrapper, and the gap between them.
//
// Pyth publishes three feeds for one company: the equity itself, the xStock
// wrapper and the Ondo wrapper. That is the comparison this app already
// draws, drawn better, because a difference between two published prices is
// firmer than an inference off pooled liquidity.
//
// Two things about the plumbing, both learned the hard way. The host is
// pyth.dourolabs.app and not hermes.pyth.network, which answers the feed
// catalogue to anyone and 401s on every price path; against the wrong host a
// perfectly good key looks like a bad one. And the endpoint takes a symbol
// rather than a feed id, which is why the ids fetched from Hermes turned out
// to be useless here.
//
// The account is a trial and the trial does not reach these feeds. Six
// tokens were spent establishing exactly that, and the result is worth
// writing down because it is not obvious: the key is good, the host and the
// request shape are right, and Crypto.BTC/USD comes back at a real price.
// Equity.US.AAPL/USD and Crypto.AAPLX/USD both return 403. So the three
// feeds this integration exists for sit above the trial tier, and no amount
// of fiddling with resolutions or windows changes that.
//
// The plumbing was worth getting right anyway, and two parts of it were not
// obvious either. The host is pyth.dourolabs.app, not hermes.pyth.network,
// which answers the feed catalogue to anyone and 401s on every price path.
// And the endpoint takes a symbol rather than a feed id, so the ids Hermes
// hands out are useless here. Against the wrong host a good key looks like a
// bad one, which is how an afternoon goes missing.
//
// It is one environment variable and an entitlement away from working.
const HOST = "https://pyth.dourolabs.app";
const KEY = process.env.PYTH_API_KEY ?? "";

/** One company, because the allowance does not stretch to browsing. */
const SYMBOLS = [
  { symbol: "Equity.US.AAPL/USD", kind: "equity" as const, label: "Apple, the share" },
  { symbol: "Crypto.AAPLX/USD", kind: "xstock" as const, label: "Backed's AAPLx" },
  { symbol: "Crypto.AAPLON/USD", kind: "ondo" as const, label: "Ondo's AAPLon" },
];

let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // An hour at the edge too, so the trial is spent once and not per
      // reader.
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });

/**
 * The last published price for one symbol.
 *
 * There is a history endpoint and it is the one whose syntax is known to
 * work, so a narrow recent window is asked for and the final point taken.
 * Guessing at a latest endpoint would cost a token per guess.
 */
async function lastPrice(symbol: string, resolution = "1D") {
  const to = Math.floor(Date.now() / 1000);
  // A month at daily resolution, which is the shape of the request the
  // provider's own example uses. Narrower windows and finer resolutions were
  // refused, and each guess costs a token from a trial allowance.
  const from = to - 60 * 60 * 24 * 30;
  const url =
    `${HOST}/v1/fixed_rate@1000ms/history` +
    `?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=${resolution}`;

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${KEY}`, accept: "application/json" },
  });
  if (!res.ok) return { error: `${res.status}` };
  const body = (await res.json()) as any;

  // TradingView shaped: parallel arrays of t, o, h, l, c. Take the last close
  // that exists rather than assuming the series is full.
  const closes: number[] = body?.c ?? [];
  const times: number[] = body?.t ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(closes[i])) {
      return { price: Number(closes[i]), at: times[i] ?? null, points: closes.length };
    }
  }
  return { error: "no points", raw: Object.keys(body ?? {}).join(",") };
}

export default async () => {
  if (!KEY) {
    return json({
      priced: false,
      reason:
        "Pyth publishes these three feeds and gates the prices behind a paid tier. They are named because that much is true without a key, and the numbers are not guessed.",
      feeds: SYMBOLS,
    });
  }

  if (cache && Date.now() - cache.at < TTL_MS) return json(cache.body);

  try {
    const out = [];
    for (const s of SYMBOLS) {
      out.push({ ...s, ...(await lastPrice(s.symbol)) });
    }

    const equity = out.find((o: any) => o.kind === "equity" && o.price);
    const body = {
      priced: out.some((o: any) => o.price),
      asOf: Date.now(),
      equity: equity ?? null,
      wrappers: out
        .filter((o: any) => o.kind !== "equity")
        .map((w: any) => ({
          ...w,
          // What the wrapper costs against the thing it stands for.
          driftBps:
            equity && w.price
              ? ((w.price - (equity as any).price) / (equity as any).price) * 10_000
              : null,
        })),
    };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (err) {
    return json({ priced: false, reason: String(err).slice(0, 140), feeds: SYMBOLS });
  }
};

export const config = { path: "/api/pyth" };
