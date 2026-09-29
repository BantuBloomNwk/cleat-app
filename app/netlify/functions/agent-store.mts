// The loop's storage, reachable from the runner on our own server.
//
// The alternative was a Netlify access token on that server, and a Netlify
// token can do anything to every site on the account. This does one thing:
// read and write the loop's own keys, behind a secret that exists for no
// other purpose. Anything outside those prefixes is refused.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const ALLOWED = ["book/", "public/", "runner/", "last-tick", "last-scheduled"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async (req: Request) => {
  const secret = process.env.CLEAT_RUNNER_SECRET;
  const given = req.headers.get("x-cleat-runner") ?? "";
  if (!secret || !same(given, secret)) return json({ error: "not allowed" }, 403);
  const b = (await req.json().catch(() => ({}))) as { op?: string; key?: string; value?: unknown; prefix?: string };
  const key = String(b.key ?? b.prefix ?? "");
  if (!ALLOWED.some((p) => key.startsWith(p))) return json({ error: "not a loop key" }, 400);
  const store = getStore({ name: "cleat-loop", consistency: "strong" });
  switch (b.op) {
    case "get": return json({ value: (await store.get(key, { type: "json" })) ?? null });
    case "set": await store.setJSON(key, b.value); return json({ ok: true });
    case "delete": await store.delete(key); return json({ ok: true });
    case "list": return json({ keys: (await store.list({ prefix: key })).blobs.map((x) => x.key) });
    default: return json({ error: "unknown op" }, 400);
  }
};

export const config = { path: "/api/agent-store" };
