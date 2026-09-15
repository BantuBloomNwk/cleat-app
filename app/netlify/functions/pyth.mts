// The share, the wrapper, and the gap between them.
//
// Cleat's mandate carries a cap on how wide a book it will trade into, and
// the app already shows how far each issuer's token has drifted from the
// share it stands for. Both numbers came from Jupiter, which prices tokens
// against on chain liquidity and does not know what the underlying equity is
// worth.
//
// Pyth publishes all three: the equity itself, the xStock wrapper and the
// Ondo wrapper, as separate feeds with their own confidence intervals. That
// turns the drift from an inference off pooled liquidity into a difference
// between two published prices, and it brings a confidence interval with it,
// which is the part that matters. A price with a wide confidence band is a
// price nobody is sure of, and trading into one is the thing the spread cap
// exists to stop.
// Metadata is open; prices are not. Hermes answers /v2/price_feeds to anyone
// and returns 401 unauthorized on every price path, which is the split Pyth
// Pro sells. The equity, xStock and Ondo feeds are pull oracles rather than
// sponsored feeds, so they are not sitting on Solana to be read either: the
// price account PDAs for them do not exist on mainnet at any shard.
//
// So this works without a key as far as saying which feeds exist for a
// ticker, and needs one to say what they cost. That is stated on screen
// rather than faked, and the moment PYTH_API_KEY is set the prices appear
// with no other change.
const HERMES = "https://hermes.pyth.network";
const KEY = process.env.PYTH_API_KEY ?? "";
const authed = (init: RequestInit = {}): RequestInit =>
  KEY
    ? { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${KEY}` } }
    : init;

/**
 * A ticker's three prices. Not every name has all three, and a name with
 * only one is not a failure, it is a name only one issuer has wrapped.
 */
interface Feed {
  id: string;
  symbol: string;
  kind: "equity" | "xstock" | "ondo" | "other";
}

const KIND = (symbol: string): Feed["kind"] => {
  if (/^Equity\.US\./.test(symbol)) return "equity";
  if (/X\/USD$/.test(symbol)) return "xstock";
  if (/ON\/USD$/.test(symbol)) return "ondo";
  return "other";
};

const json = (body: unknown, status = 200, maxAge = 15) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge * 2}`,
    },
  });

export default async (req: Request) => {
  const ticker = (new URL(req.url).searchParams.get("ticker") ?? "").toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(ticker)) return json({ error: "bad ticker" }, 400, 0);

  try {
    const res = await fetch(
      `${HERMES}/v2/price_feeds?query=${encodeURIComponent(ticker)}`,
      authed({ headers: { accept: "application/json" } }),
    );
    if (!res.ok) return json({ error: `hermes ${res.status}` }, 502, 0);
    const all = (await res.json()) as any[];

    // Only the three the bounty names, and only exact matches. A search for
    // MU also returns MUSD and similar, and a chart showing the wrong
    // company's price is worse than a chart showing none.
    const wanted: Feed[] = [];
    for (const f of all) {
      const symbol = String(f?.attributes?.symbol ?? "");
      const kind = KIND(symbol);
      if (kind === "other") continue;
      const bare = symbol.replace(/^(Equity\.US\.|Crypto\.)/, "").replace(/\/USD$/, "");
      if (bare !== ticker && bare !== `${ticker}X` && bare !== `${ticker}ON`) continue;
      wanted.push({ id: f.id, symbol, kind });
    }
    if (wanted.length === 0) return json({ ticker, feeds: [] });

    // Which feeds exist is answerable without a key and is worth answering:
    // it says outright that this company is wrapped by two issuers and that
    // Pyth publishes the share itself alongside both.
    const catalogue = wanted.map((f) => ({ id: f.id, symbol: f.symbol, kind: f.kind }));
    if (!KEY) {
      return json({
        ticker,
        priced: false,
        reason:
          "Pyth publishes these three feeds and gates the prices behind Pyth Pro. The feeds are named here because that much is true without a key; the numbers are not guessed.",
        feeds: catalogue,
      });
    }

    const q = wanted.map((f) => `ids[]=${f.id}`).join("&");
    const pr = await fetch(
      `${HERMES}/v2/updates/price/latest?${q}`,
      authed({ headers: { accept: "application/json" } }),
    );
    if (!pr.ok) return json({ ticker, priced: false, reason: `hermes said ${pr.status}`, feeds: catalogue }, 200, 0);
    const body = (await pr.json()) as any;

    const priced = (body.parsed ?? []).map((p: any) => {
      const meta = wanted.find((f) => f.id.replace(/^0x/, "") === String(p.id).replace(/^0x/, ""));
      // Pyth prices are an integer and an exponent, and the confidence is in
      // the same units. Carrying both is the point: a number without its
      // uncertainty is the kind of figure this product exists to argue with.
      const scale = 10 ** Number(p.price.expo);
      const price = Number(p.price.price) * scale;
      const conf = Number(p.price.conf) * scale;
      return {
        id: p.id,
        symbol: meta?.symbol ?? "",
        kind: meta?.kind ?? "other",
        price,
        conf,
        /** How unsure the network is, in basis points of the price. */
        confBps: price > 0 ? (conf / price) * 10_000 : null,
        publishTime: p.price.publish_time,
      };
    });

    const equity = priced.find((p: any) => p.kind === "equity");
    const wrappers = priced.filter((p: any) => p.kind !== "equity");

    return json({
      ticker,
      priced: true,
      equity: equity ?? null,
      wrappers: wrappers.map((w: any) => ({
        ...w,
        // What the wrapper costs against the thing it stands for. Positive
        // means it trades over the share, negative under.
        driftBps:
          equity && equity.price > 0
            ? ((w.price - equity.price) / equity.price) * 10_000
            : null,
      })),
    });
  } catch (err) {
    return json({ error: String(err).slice(0, 200) }, 502, 0);
  }
};

export const config = { path: "/api/pyth" };
