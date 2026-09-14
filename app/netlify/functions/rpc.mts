// Solana RPC proxy.
//
// The app needs a reliable devnet endpoint, and the reliable one carries an API
// key. A key in a browser bundle is a published key, so the browser talks to
// this instead and the key stays in the project's environment.
//
// It used to forward whatever body it was handed, on the reasoning that the app
// only ever reads. That reasoning was about the app and this endpoint is not the
// app: anyone who found the URL could have posted `sendTransaction` through it
// and spent this project's quota relaying their own traffic. The key was never
// reachable and nothing here can sign, so it was a bill rather than a breach,
// but an open relay is an open relay.
//
// So the method is checked against what the app actually calls, which is two
// things. Anything else is refused by name rather than forwarded.
const ALLOWED = new Set(["getAccountInfo", "getSlot"]);

/** Batched requests are fine, so long as every call in the batch is allowed. */
function permitted(parsed: unknown): boolean {
  const one = (c: any) =>
    c && typeof c === "object" && typeof c.method === "string" && ALLOWED.has(c.method);
  if (Array.isArray(parsed)) {
    return parsed.length > 0 && parsed.length <= 20 && parsed.every(one);
  }
  return one(parsed);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }
  const upstream = process.env.SOLANA_RPC_URL;
  if (!upstream) {
    return new Response(JSON.stringify({ error: "no upstream configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const body = await req.text();
  // A body large enough to hold a transaction is already the wrong shape for
  // the two calls this allows, so it is refused before it is parsed.
  if (body.length > 8192) {
    return new Response(JSON.stringify({ error: "too large" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "not json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!permitted(parsed)) {
    return new Response(
      JSON.stringify({ error: "this proxy reads accounts and the slot, nothing else" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  const res = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};

export const config = { path: "/api/rpc" };
