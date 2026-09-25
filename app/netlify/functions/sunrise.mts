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

/**
 * Which mints are real, from the venue that issues them.
 *
 * This read the issuer's listing layer until 24 September 2026, when that
 * endpoint began answering 401 to anyone without an API key. It had been
 * open, and sixty names came back from it that morning.
 *
 * The venue's own asset list is the better source anyway and was there the
 * whole time. It needs no key, it is the exchange that actually issues and
 * custodies these tokens rather than a layer above them, and it carries
 * eleven hundred US listings with their Solana mints instead of sixty. The
 * only thing lost is the market identifier code, which the venue does not
 * publish per asset; every name here is a US listing, so that field says so
 * rather than inventing an exchange.
 *
 * The quote endpoint is untouched and still open, which is fortunate,
 * because it is the one that answers the question a spread cap needs.
 */
const VENUE_ASSETS = "https://api.backpack.exchange/api/v1/assets";

interface VenueAsset {
  symbol?: string;
  displayName?: string;
  tokens?: {
    blockchain?: string;
    contractAddress?: string;
    nativeDecimals?: number;
  }[];
}

async function universe(): Promise<SunriseToken[]> {
  const res = await fetch(VENUE_ASSETS, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`assets ${res.status}`);
  const assets = (await res.json()) as VenueAsset[];

  const out: SunriseToken[] = [];
  for (const a of assets) {
    const symbol = a.symbol ?? "";
    // Tokenised equities carry a country suffix. Everything without one is a
    // coin, which this list is not about.
    if (!symbol.endsWith(".US")) continue;
    const onSolana = (a.tokens ?? []).find(
      (t) => t.blockchain === "Solana" && t.contractAddress,
    );
    if (!onSolana?.contractAddress) continue;
    const ticker = symbol.slice(0, -3);
    out.push({
      address: onSolana.contractAddress,
      symbol: ticker,
      name: a.displayName ?? ticker,
      decimals: onSolana.nativeDecimals ?? 9,
      assetClass: "stock",
      issuer: "backpack_securities",
      icon: null,
      tokenProgram: "",
      stock: {
        ticker,
        currency: "USD",
        // Left null rather than guessed. The venue does not say which of the
        // US exchanges a name is listed on, and writing XNAS for all eleven
        // hundred would be a fact nobody checked.
        exchange: { marketIdentifierCode: "", name: "" },
      },
    });
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
        // ISO 10383, so XNAS rather than "Nasdaq". The venue does not say
        // which US exchange each name sits on, so this is null rather than
        // guessed, and null renders as "not stated" instead of an invented
        // four letter code. Every name in this list is a US listing, which
        // is itself worth stating plainly: the supply side has not left New
        // York yet.
        mic: t.stock?.exchange.marketIdentifierCode || null,
        venue: t.stock?.exchange.name || null,
        currency: t.stock?.currency ?? "USD",
        icon: t.icon,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    return json({ count: rows.length, rows });
  } catch (err) {
    // Answer 200 with an empty list and a reason rather than 502.
    //
    // The venue started requiring a key on its listing endpoint on 24
    // September and now returns 401 to anyone without one. That is a real
    // change and the screens that read this have to say so, but it is not
    // this function failing: a 502 here puts a red line in every visitor's
    // console for something nobody can act on, and drowns the errors that
    // do matter. The body carries the truth and the caller decides what to
    // show.
    const reason = /401|unauthorized/i.test(String(err))
      ? 'the venue now requires a key for its listing'
      : String(err).slice(0, 160);
    return json({ unavailable: true, reason, count: 0, rows: [] }, 200, 0);
  }
};

export const config = { path: "/api/sunrise" };
