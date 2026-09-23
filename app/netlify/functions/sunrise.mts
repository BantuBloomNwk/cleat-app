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
  // Paginated, and it did not used to be read that way. The page limit is
  // two hundred and the list sat at eighty eight, so the missing cursor
  // cost nothing and would have cost everything past two hundred silently.
  // Names are being added by the dozen, so that is weeks away, not years.
  const out: SunriseToken[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`${SUNRISE}/v1/tokens${qs}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`tokens ${res.status}`);
    const body = (await res.json()) as {
      data?: { tokens?: SunriseToken[]; pagination?: { nextCursor?: string | null } };
    };
    out.push(...(body.data?.tokens ?? []));
    cursor = body.data?.pagination?.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

const json = (body: unknown, status = 200, maxAge = 300) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge * 2}`,
    },
  });

export default async (req: Request) => {
  // Pricing a route, from here, because the browser cannot.
  //
  // The design was deliberately to call this from the page: the router
  // answers differently depending on where the request comes from, and the
  // region that decides whether somebody may trade is the one they are
  // sitting in, not the one our servers are in. That argument still holds.
  //
  // It just does not work. The upstream sends access-control-allow-origin
  // twice, and a browser rejects a duplicated header, so the call fails
  // from every origin rather than being geo-blocked from some. A feature
  // that never runs protects nobody. This proxies it so the price is real,
  // and the client still tries direct first, so the moment they fix the
  // header the geo property comes back on its own.
  if (new URL(req.url).searchParams.get("path") === "quote") {
    try {
      const body = await req.text();
      const res = await fetch(`${SUNRISE}/v1/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch (err) {
      return json({ error: String(err).slice(0, 160) }, 502, 0);
    }
  }

  try {
    const tokens = await universe();
    const rows = tokens
      // The sub-object, not the asset class, used to gate this. It is null
      // on the newest mints because nobody has filled it in yet, so nine
      // real names were dropped for a missing field rather than for not
      // being stocks. The symbol field already carries the plain ticker, so
      // a row with no exchange detail is listed with the detail left blank
      // rather than dropped.
      .filter((t) => t.assetClass === "stock")
      .map((t) => ({
        ticker: t.stock?.ticker ?? t.symbol,
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
        mic: t.stock?.exchange.marketIdentifierCode ?? null,
        venue: t.stock?.exchange.name ?? null,
        currency: t.stock?.currency ?? "USD",
        icon: t.icon,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    return json({ count: rows.length, rows });
  } catch (err) {
    return json({ error: String(err).slice(0, 200), count: 0, rows: [] }, 502, 0);
  }
};

export const config = { path: "/api/sunrise" };
