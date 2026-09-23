// A face, generated from a seed, served from here.
//
// DiceBear draws a deterministic avatar from any string: same seed, same
// avatar, forever, with nothing stored and no account. That is the only kind
// of profile picture this product can have, because there is no profile to
// hang one on and asking somebody to upload a photo would contradict the
// whole argument.
//
// It is proxied rather than hotlinked for the same reason the company marks
// are. Same origin means nothing new opens in the content security policy,
// the edge caches it so the third party is hit once per seed rather than
// once per render, and if that service disappears the failure is one 404
// here instead of a broken image on every screen.
//
// Note on the animation option: DiceBear documents animated styles whose
// keyframes live inside the SVG, and the public API accepts `animation` as a
// boolean and then returns byte-identical output for every style tested.
// So the motion in this app is ours, applied on top, which suits it better
// anyway: a looping idle is decoration, and motion that fires on a verdict
// is the product.

const STYLES = new Set([
  "voxel-bot",
  "voxel-art",
  "bottts",
  "thumbs",
  "shapes",
  "pixel-art",
]);

export default async (req: Request) => {
  const url = new URL(req.url);
  const style = url.searchParams.get("style") ?? "voxel-bot";
  const seed = url.searchParams.get("seed") ?? "";
  // DiceBear draws every style on a coloured plate. In a 40px circle that
  // plate is the avatar's background and looks right. At 124px on a dark
  // card it looks like a sticker somebody stuck to the screen, so the big
  // one asks for no plate and gets its depth from a shadow instead.
  // The API rejects the word transparent and wants hex, so a fully
  // transparent colour is eight zeroes rather than a keyword.
  const bare = url.searchParams.get("bg") === "none";

  // An allowlist rather than a passthrough: the style goes into an upstream
  // URL, so it is checked rather than trusted.
  if (!STYLES.has(style)) {
    return new Response(JSON.stringify({ error: "unknown style" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!seed || seed.length > 128) {
    return new Response(JSON.stringify({ error: "bad seed" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const upstream =
      `https://api.dicebear.com/10.x/${style}/svg?seed=${encodeURIComponent(seed)}` +
      (bare ? "&backgroundColor=00000000" : "");
    const res = await fetch(upstream, { headers: { accept: "image/svg+xml" } });
    const body = await res.text();
    if (!res.ok || !body.includes("<svg")) {
      return new Response("no avatar", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // A seed always draws the same thing, so this can be cached hard.
        "cache-control": "public, max-age=604800, s-maxage=2592000",
      },
    });
  } catch {
    return new Response("upstream unreachable", { status: 502 });
  }
};

export const config = { path: "/api/avatar" };
