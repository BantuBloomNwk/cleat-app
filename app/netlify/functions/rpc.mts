// Solana RPC proxy.
//
// The app needs a reliable devnet endpoint, and the reliable one carries an API
// key. A key in a browser bundle is a published key, so the browser talks to
// this instead and the key stays in the project's environment.
//
// Read only by construction: the app never signs here, it only asks for
// accounts, so the worst this proxy can do is fetch public chain state.
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
