// Pre-IPO tokens, and what a mandate makes of them.
//
// A tokenized public share has a book, however thin. A pre-IPO token has an
// SPV mark and whatever somebody will pay, and the gap between those two is
// not a spread in the usual sense: it is the price of the fact that there is
// no market. PreStocks publishes both, which makes it the clearest test there
// is of the argument this product rests on.
//
// The mandate's spread cap was written for a book quoting thirty two basis
// points wide on a Sunday. Against a pre-IPO name the same rule refuses
// almost everything, and it should: an agent buying an illiquid private
// company at three in the morning is the exact thing an owner asleep in
// another timezone would want stopped.
const UPSTREAM = "https://prestocks.com/api/prestocks";

const json = (body: unknown, status = 200, maxAge = 60) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge * 2}`,
    },
  });

export default async () => {
  try {
    const res = await fetch(UPSTREAM, { headers: { accept: "application/json" } });
    if (!res.ok) return json({ error: `upstream ${res.status}`, rows: [] }, 502, 0);
    const all = (await res.json()) as any[];

    const rows = (Array.isArray(all) ? all : []).map((t) => {
      const mark = Number(t.markPrice);
      const token = Number(t.tokenPrice);
      // What the token costs against what the SPV says it is worth. This is
      // the number a spread cap should be looking at for an instrument with
      // no book, and it is published rather than inferred.
      const driftBps =
        Number.isFinite(mark) && mark > 0 && Number.isFinite(token)
          ? ((token - mark) / mark) * 10_000
          : null;
      return {
        symbol: String(t.symbol ?? ""),
        name: String(t.name ?? "").replace(/ PreStocks$/, ""),
        mint: String(t.contract_address ?? ""),
        markPrice: Number.isFinite(mark) ? mark : null,
        tokenPrice: Number.isFinite(token) ? token : null,
        markValuation: Number(t.markValuation) || null,
        impliedValuation: Number(t.impliedValuation) || null,
        supply: Number(t.supply) || null,
        driftBps,
        image: t.image ?? null,
        url: t.external_url ?? null,
      };
    })
      .filter((r) => r.symbol && r.driftBps !== null)
      .sort((a, b) => Math.abs(b.driftBps!) - Math.abs(a.driftBps!));

    return json({ count: rows.length, rows });
  } catch (err) {
    return json({ error: String(err).slice(0, 160), rows: [] }, 502, 0);
  }
};

export const config = { path: "/api/prestocks" };
