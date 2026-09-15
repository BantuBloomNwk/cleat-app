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
const ALLOWED = new Set(["getAccountInfo", "getSlot", "getProgramAccounts"]);

/**
 * getProgramAccounts is the expensive one, so it is fenced rather than just
 * allowed. It may only ask this program for accounts carrying the Mandate
 * discriminator, which is what the mandate exchange needs and nothing more. An
 * unfenced scan of an arbitrary program is a way to make somebody else pay for
 * an indexer.
 */
const PROGRAM_ID = "2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL";
const MANDATE_DISCRIMINATOR = "L3ScUhMvnTK"; // base58 of [113,216,98,159,185,63,55,18]

function scanIsFenced(call: any): boolean {
  const [program, opts] = call.params ?? [];
  if (program !== PROGRAM_ID) return false;
  const filters = opts?.filters;
  if (!Array.isArray(filters)) return false;
  return filters.some(
    (f: any) =>
      f?.memcmp?.offset === 0 && f?.memcmp?.bytes === MANDATE_DISCRIMINATOR,
  );
}

/** Batched requests are fine, so long as every call in the batch is allowed. */
function permitted(parsed: unknown): boolean {
  const one = (c: any) => {
    if (!c || typeof c !== "object" || typeof c.method !== "string") return false;
    if (!ALLOWED.has(c.method)) return false;
    if (c.method === "getProgramAccounts") return scanIsFenced(c);
    return true;
  };
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
  if (body.length > 16384) {
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
