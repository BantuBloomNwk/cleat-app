// Pricing a trade, from where the person actually is.
//
// Sunrise answers a quote with 403 GEO_BLOCKED depending on where the
// request came from, and the region that decides whether somebody may trade
// is the one they are sitting in. That was written down from the start and
// then quietly not honoured, because the quote was proxied by a regular
// function, regular functions run in us-east-1, and Sunrise blocks the
// United States. So everybody got Virginia's answer: a person in Kuala
// Lumpur was told the service is unavailable in their region while the same
// call from their own machine returned a real route.
//
// The browser cannot ask directly, which is the reason the proxy exists at
// all: the upstream sends access-control-allow-origin twice and a browser
// rejects a duplicated header, so the direct path provably cannot succeed
// today whatever the origin.
//
// An edge function is the way out. These run on Deno at the point of
// presence nearest the viewer rather than in one fixed region, so the check
// lands near the person: somebody in Malaysia is priced from Asia and
// somebody in the United States gets the refusal that is genuinely theirs.
// It is the behaviour the design described before the plumbing caught up.
//
// It stays a refusal when it is one. Nothing here pretends a blocked region
// is anything else, and the screen already has copy for that answer.

const SUNRISE = "https://api.sunrise.xyz/v1/quotes";

/**
 * Where the runtime placed the viewer.
 *
 * Typed locally rather than imported, because this file is checked by the
 * app's own tsconfig, which knows about browsers and node and nothing about
 * the edge runtime.
 */
interface EdgeContext {
  geo?: { country?: { code?: string }; city?: string };
}

export default async (req: Request, context: EdgeContext): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return new Response(JSON.stringify({ error: "no body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  // A quote is small. Anything larger is not one, and this endpoint has no
  // reason to forward it.
  if (body.length > 2048) {
    return new Response(JSON.stringify({ error: "too large to be a quote" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(SUNRISE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        // Which point of presence answered. The whole point of this file is
        // that the region is not Virginia any more, so it should be possible
        // to check that rather than take it on trust.
        // Which region the check was made from, so the claim that it lands
        // near the person is something that can be read rather than trusted.
        "x-cleat-viewer-region": context?.geo?.country?.code ?? "unknown",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err).slice(0, 160) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/quote" };
