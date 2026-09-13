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

const ALLOWED = new Set([
  "securities",
  "market-sessions",
  "market-holidays",
  "markets",
]);

export default async (req: Request) => {
  const url = new URL(req.url);
  const which = url.searchParams.get("path") ?? "securities";

  // An allowlist rather than a passthrough. A proxy that forwards whatever
  // path it is handed is an open relay wearing this project's domain.
  if (!ALLOWED.has(which)) {
    return new Response(JSON.stringify({ error: "unknown path" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${UPSTREAM}/${which}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `upstream ${res.status}` }),
        { status: 502, headers: { "content-type": "application/json" } },
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
        "cache-control": "public, max-age=900, s-maxage=3600",
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
