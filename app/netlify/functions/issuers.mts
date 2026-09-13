// The same company, from every issuer that has tokenized it.
//
// A ticker on Solana is not one thing. Apple exists as a Backpack spot
// token, as Backed's AAPLx and as Ondo's AAPLon, and those are different
// legal instruments with different holder rules and wildly different
// depth, wearing the same three letters. Nobody shows that, and the
// difference is the whole question of where a trade should go.
//
// Jupiter's token search knows which issuer minted what, because it tags
// them, and it prices them against real on chain liquidity. This narrows
// the search to a ticker and hands back only the rows an issuer we can
// name is behind, because a search for AAPL also returns a pile of
// memecoins called AAPLCAT.

const UPSTREAM = "https://lite-api.jup.ag/tokens/v2/search";

/** Issuers we have actually checked on chain. Everything else is noise. */
const KNOWN = new Set(["xstocks", "ondo"]);

const TICKER = /^[A-Z]{1,6}$/;

export default async (req: Request) => {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();

  if (!TICKER.test(ticker)) {
    return new Response(JSON.stringify({ error: "bad ticker" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${UPSTREAM}?query=${encodeURIComponent(ticker)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `upstream ${res.status}` }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const all = (await res.json()) as any[];

    const rows = (Array.isArray(all) ? all : [])
      .map((t) => {
        const tags: string[] = t.tags ?? [];
        const issuer = tags.find((x) => KNOWN.has(x));
        if (!issuer) return null;
        // A search for MU also returns MUU, and for NVDA it returns NVDAG.
        // Each issuer marks its tokens with a fixed suffix, so the symbol
        // has to be the ticker plus exactly that and nothing else.
        const sym = String(t.symbol ?? "");
        const suffix = issuer === "ondo" ? "on" : "x";
        if (sym !== `${ticker}${suffix}`) return null;
        return {
          symbol: sym,
          mint: t.id ?? t.address,
          issuer,
          usdPrice: t.usdPrice ?? null,
          liquidity: t.liquidity ?? null,
          priceChange24h: t.priceChange24h ?? null,
          // The price of the actual share, when Jupiter carries it. The gap
          // between this and usdPrice is the token's premium or discount,
          // which is the number that says whether the wrapper is holding.
          realPrice: t.stockData?.price ?? null,
          decimals: t.decimals ?? null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.liquidity ?? 0) - (a.liquidity ?? 0));

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=30, s-maxage=60",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/issuers" };
