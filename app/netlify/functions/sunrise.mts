// Which mint is the real one.
//
// A ticker on Solana is not one thing. MicroStrategy exists today as a
// Backpack token listed through Sunrise, as Backed's MSTRx and as Ondo's
// MSTRon, three different legal instruments wearing the same four letters,
// and around a listing the imitations arrive within minutes. An agent that
// hardcodes an address is one stale constant away from buying nothing. So
// the address is resolved at the moment of the trade, from the issuer's own
// listing layer.
//
// Only the listing lives here. Quotes are asked for by the browser rather
// than by this function, and that is not an optimisation: Sunrise answers a
// quote with 403 GEO_BLOCKED depending on where the request comes from, and
// the region that matters is the one the person is sitting in, not the one
// a server happens to run in. Proxying it would move the check to the wrong
// place and answer a question nobody asked.
const SUNRISE = "https://api.sunrise.xyz";

interface SunriseToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  assetClass: string;
  issuer: string | null;
  icon: string | null;
  tokenProgram: string;
  stock: {
    ticker: string;
    currency: string;
    exchange: { marketIdentifierCode: string; name: string };
  } | null;
}

async function universe(): Promise<SunriseToken[]> {
  const res = await fetch(`${SUNRISE}/v1/tokens`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  const body = (await res.json()) as { data?: { tokens?: SunriseToken[] } };
  return body.data?.tokens ?? [];
}

const json = (body: unknown, status = 200, maxAge = 300) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge * 2}`,
    },
  });

export default async () => {
  try {
    const tokens = await universe();
    const rows = tokens
      .filter((t) => t.assetClass === "stock" && t.stock)
      .map((t) => ({
        ticker: t.stock!.ticker,
        mint: t.address,
        name: t.name.replace(/ - Backpack Securities$/, ""),
        decimals: t.decimals,
        // Not every row carries one. Nike's is empty today, so a reader that
        // assumes this field is populated reports the wrong issuer rather
        // than an unknown one.
        issuer: t.issuer,
        tokenProgram: t.tokenProgram,
        // ISO 10383, so XNAS rather than "Nasdaq". Four venues are
        // represented and all four are American, which is worth stating
        // plainly: the supply side has not left New York yet.
        mic: t.stock!.exchange.marketIdentifierCode,
        venue: t.stock!.exchange.name,
        currency: t.stock!.currency,
        icon: t.icon,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    return json({ count: rows.length, rows });
  } catch (err) {
    return json({ error: String(err).slice(0, 200), count: 0, rows: [] }, 502, 0);
  }
};

export const config = { path: "/api/sunrise" };
