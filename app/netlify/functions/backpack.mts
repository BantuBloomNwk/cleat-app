// Backpack Securities, read only.
//
// Backpack Securities is the registered US broker dealer issuing tokenized
// equities on Solana, and in September 2026 it opened mint and redeem to
// any developer. Four of its endpoints need no key and no account, and
// they are the four that decide whether a mandate is enforceable against
// the real market rather than an invented one:
//
//   securities        the tradable universe, with cusips and the minimum
//                     quantity and step size each session will accept
//   market-sessions   the four real US equity sessions and their hours
//   market-holidays   the closures, including overnight eves
//   markets           which of those actually have a market, spot or perp
//   tickers           what every one of them is trading at, right now
//   klines            real candles, so the chart plots a real price
//   depth             the book, so a mandate can size against how thin it is
//
// A browser cannot call them directly because the API sends no CORS
// header, so it calls this. Nothing here is authenticated, nothing here
// signs, and no key is involved: this proxy exists for the header and for
// the cache, not for a secret.
//
// Minting and redeeming is a different matter and deliberately not here.
// That path runs through an account Backpack has onboarded, and it is a
// withdrawal to Solana one way and a deposit the other. It needs signed
// credentials, so it belongs on a server with a real client's consent,
// never in a page.

const UPSTREAM = "https://api.backpack.exchange/api/v1";

// Paths that take no parameters.
const ALLOWED = new Set([
  "securities",
  "market-sessions",
  "market-holidays",
  "markets",
  "tickers",
  // Every asset the venue knows, with the Solana mint and the deposit and
  // withdrawal flags per chain. This is the only endpoint that answers the
  // question the app actually asks, which is what is tokenized and live
  // right now. Tickers answers a narrower one, which is what has an order
  // book, and a name can be real and tradable without having one.
  "assets",
  // A price for the names with no book.
  "markPrices",
]);

// Paths that take a symbol, and the shape a symbol is allowed to have.
// Anchored and narrow on purpose: the symbol goes into an upstream URL, so
// it is validated rather than trusted.
const SYMBOL_PATHS = new Set(["klines", "depth", "ticker", "market"]);
// Two dots happen: BRK.B.US is in the venue's own security list. RFQ is a
// documented market suffix. Neither used to pass, so neither could ever be
// asked for through here.
const SYMBOL = /^[A-Z0-9]{1,12}(\.[A-Z]{1,4}){0,2}_[A-Z0-9]{1,8}(_PERP|_RFQ)?$/;
const INTERVAL = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

export default async (req: Request) => {
  const url = new URL(req.url);
  const which = url.searchParams.get("path") ?? "securities";

  // A company's mark, re-served from here.
  //
  // The venue publishes an SVG for any ticker, which is the only source that
  // covers the names with no token behind them: Tesla and the Nasdaq trade
  // here as perpetuals only, so they appear in no token list and had no logo
  // anywhere. It serves them as text/plain, which an img tag will not render,
  // and fetching it from the page would need the origin opened in connect-src
  // for no reason. Proxying fixes the content type, keeps it same origin, and
  // lets the edge cache it for a day.
  if (which === "logo") {
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
    if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) {
      return new Response("bad symbol", { status: 400 });
    }
    try {
      const res = await fetch(`https://backpack.exchange/api/stock-logo/${symbol}`);
      if (!res.ok) return new Response("no mark", { status: 404 });
      const buf = new Uint8Array(await res.arrayBuffer());

      // Sniff it rather than trust it. The endpoint serves SVG for most
      // names and PNG for others, all of it as text/plain, so the type has
      // to be worked out here. An earlier version only accepted SVG, which
      // silently dropped every mark that happened to be a bitmap and looked
      // exactly like the logo not existing.
      const head = new TextDecoder().decode(buf.subarray(0, 64));
      const type =
        head.includes("<svg") ? "image/svg+xml; charset=utf-8"
        : buf[0] === 0x89 && buf[1] === 0x50 ? "image/png"
        : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
        : buf[0] === 0x52 && buf[1] === 0x49 ? "image/webp"
        : null;
      // Anything that is not a recognised image is a miss, and a miss falls
      // through to the identicon rather than putting unknown bytes in an
      // image tag.
      if (!type) return new Response("no mark", { status: 404 });

      return new Response(buf, {
        status: 200,
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=86400, s-maxage=604800",
        },
      });
    } catch {
      return new Response("upstream unreachable", { status: 502 });
    }
  }

  // An allowlist rather than a passthrough. A proxy that forwards whatever
  // path it is handed is an open relay wearing this project's domain.
  const takesSymbol = SYMBOL_PATHS.has(which);
  if (!ALLOWED.has(which) && !takesSymbol) {
    return new Response(JSON.stringify({ error: "unknown path" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const query = new URLSearchParams();
  if (takesSymbol) {
    const symbol = url.searchParams.get("symbol") ?? "";
    if (!SYMBOL.test(symbol)) {
      return new Response(JSON.stringify({ error: "bad symbol" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    query.set("symbol", symbol);

    // Depth returns up to five thousand levels by default and nothing here
    // reads past the top of the book, so the rest is payload nobody opens.
    if (which === "depth") query.set("limit", "100");

    if (which === "klines") {
      const interval = url.searchParams.get("interval") ?? "1h";
      if (!INTERVAL.has(interval)) {
        return new Response(JSON.stringify({ error: "bad interval" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      query.set("interval", interval);
      // The window is computed here rather than accepted, so the caller
      // cannot ask the upstream for an unbounded range.
      const hours = interval === "1d" || interval === "1w" ? 24 * 90 : 24 * 7;
      query.set(
        "startTime",
        String(Math.floor(Date.now() / 1000) - hours * 3600),
      );
    }
  }

  const qs = query.toString();
  try {
    const res = await fetch(`${UPSTREAM}/${which}${qs ? `?${qs}` : ""}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      // Pass the upstream status through rather than calling everything a
      // 502. A 400 means we asked for something that does not exist, and
      // reporting that as a bad gateway makes our own mistake look like the
      // venue being down. That is exactly how a dead default symbol sat in
      // the console for days looking like an outage.
      const status = res.status >= 400 && res.status < 500 ? res.status : 502;
      return new Response(
        JSON.stringify({ error: `upstream ${res.status}`, path: which }),
        { status, headers: { "content-type": "application/json" } },
      );
    }
    const body = await res.text();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        // The universe and the calendar change on the order of days, so
        // this is cached hard at the edge. It keeps the page fast and
        // keeps us from leaning on someone else's public endpoint.
        // Prices move, the calendar does not, and a book moves fastest of
        // all. Three different caches rather than one compromise.
        "cache-control":
          which === "depth"
            ? "public, max-age=5, s-maxage=10"
            : which === "tickers" || which === "ticker" || which === "klines"
              ? "public, max-age=15, s-maxage=30"
              : "public, max-age=900, s-maxage=3600",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/backpack" };
