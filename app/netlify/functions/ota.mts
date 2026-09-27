// Is there a newer build for the Android app?
//
// The updater in the app posts what it is running, and this answers with the
// latest bundle if that is something else. The bundle and its manifest are
// static files written by scripts/ota-bundle.mjs at deploy time, so a web
// deploy is also an app update and nothing here holds state.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST only" }, 405);

  let running = "";
  try {
    const body = (await req.json()) as { version_name?: unknown };
    running = String(body?.version_name ?? "");
  } catch {
    return json({ error: "bad_request", message: "not json" }, 400);
  }

  const origin = new URL(req.url).origin;
  let latest: { version: string; url: string; checksum: string };
  try {
    const res = await fetch(`${origin}/ota/latest.json`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    latest = await res.json();
  } catch {
    return json({ error: "no_new_version_available", message: "no bundle published" });
  }

  if (!latest?.version || latest.version === running) {
    return json({ error: "no_new_version_available", message: "already on the latest build" });
  }
  return json({ version: latest.version, url: latest.url, checksum: latest.checksum });
};

export const config = { path: "/api/ota" };
