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

// Jupiter, because the issuer's router closed.
//
// This proxied Sunrise, whose quote endpoint was open on the morning of 24
// September and answering 401 to everyone by that evening, alongside its
// listing. A dependency can be withdrawn and the honest response is to name
// a different one rather than to describe a capability that no longer runs.
//
// Jupiter is the better answer anyway and was already named on the chart as
// the venue these fills route through. It is public, it needs no key, it
// returns the two things a spread cap wants, and anybody can run the same
// two calls and get the same numbers, which is the property that made this
// worth doing instead of asking the agent.
//
// The geographic argument for answering from the edge still holds and costs
// nothing to keep: a router that ever starts refusing by region should
// refuse based on where the person is rather than where a server happens to
// sit, and this already runs at the point of presence nearest the viewer.
const JUPITER = "https://lite-api.jup.ag/swap/v1/quote";

/** USDC on Solana, the side every quote here is priced from. */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

  // The caller still speaks the shape the app has always sent. Translating
  // here rather than in the browser keeps the swap to a different router a
  // single file, and keeps the client's fallback to a direct call honest for
  // the day an issuer opens a quote endpoint again.
  let toToken: string;
  let fromAmount: string;
  try {
    const asked = JSON.parse(body) as { toToken?: unknown; fromAmount?: unknown };
    toToken = String(asked.toToken ?? "");
    fromAmount = String(asked.fromAmount ?? "");
  } catch {
    return new Response(JSON.stringify({ error: "not a quote" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(toToken) || !/^\d{1,20}$/.test(fromAmount)) {
    return new Response(JSON.stringify({ error: "not a quote" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const url =
      `${JUPITER}?inputMint=${USDC}&outputMint=${toToken}` +
      `&amount=${fromAmount}&slippageBps=50`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const raw = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: raw?.error ?? `router ${res.status}` }), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }

    // Answered in the shape the app already reads, so nothing downstream had
    // to learn a second router's vocabulary.
    const inUsd = Number(raw.swapUsdValue ?? 0);
    const impact = Number(raw.priceImpactPct ?? 0);
    const text = JSON.stringify({
      success: true,
      data: {
        quotes: [{
          routeName: (raw.routePlan ?? [])
            .map((r: { swapInfo?: { label?: string } }) => r?.swapInfo?.label)
            .filter(Boolean)
            .join(" + ") || "unknown",
          fromAmountUSD: inUsd,
          // Jupiter reports the impact rather than a dollar figure on the
          // far side, and the difference between the two is exactly the cost
          // of being this size, which is the number the cap is checked
          // against.
          toAmountUSD: inUsd * (1 - impact),
          toAmount: String(raw.outAmount ?? "0"),
        }],
      },
    });
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
