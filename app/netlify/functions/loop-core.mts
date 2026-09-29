// The agent that runs on its own, and the paper book it keeps.
//
// Shared by agent-tick (the scheduled loop) and agent-book (the owner's read).
// Not a function itself; scripts/bundle-functions.mjs skips it.
//
// What is real here and what is not, said once so the rest can be short:
//   real      the grant (set_agent, with an expiry, revocable), every proposal
//             (propose_trade, decided on chain against the owner's sentence),
//             the kill switch, and the prices (Pyth first, Backpack when Pyth
//             has nothing, live either way)
//   simulated the fill. A cleared proposal is filled on paper at the live
//             price, against a paper book of 10,000 dollars. Nothing is
//             bought, and the book says so everywhere it is shown.

import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");
export const LOOP_AGENT = new PublicKey("H6J8BYK6nRgopKjU5dHjnra7C8MXMCR4PD3zydm9fnrE");
/** The one account whose book anybody may read, so the loop can be seen working. */
export const DEMO_OWNER = new PublicKey("8JRDD8GVsJBDeSDHCscvUxTEZ4ZrUtPeLGwNuPUZxpWq");
const TREASURY = new PublicKey("APXm5boJUumXARvhya72so43gkbmwnEPaHWURyRHbaWT");

export const PAPER_BOOK_USD = 10_000;
const PYTH = "https://pyth.dourolabs.app";
const BACKPACK = "https://api.backpack.exchange/api/v1";

/**
 * What the agent can trade: only names it can price. Pyth is the price
 * source. When Pyth has nothing to say, which is outside US market hours for
 * these feeds and whenever the key is missing, the agent reads Backpack's
 * markets for the tokenized versions of the same stocks, which need no key
 * and trade around the clock. Every fill records which one priced it. The
 * mints are Backpack's own Solana tokens.
 */
export const INSTRUMENTS = [
  {
    ticker: "TSLA", name: "Tesla", category: 5, sector: "Consumer",
    symbol: "Equity.US.TSLA/USD", venue: "TSLA.US_USDC_PERP", mint: "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S",
  },
  {
    ticker: "QQQ", name: "Nasdaq 100", category: 1, sector: "Technology",
    symbol: "Equity.US.QQQ/USD", venue: "QQQ.US_USDC_PERP", mint: "QQQvDYxG7g11Rr4rnaJqDddmP9ocH74YhE3mDaG37R9",
  },
] as const;
export type Ticker = (typeof INSTRUMENTS)[number]["ticker"];

export interface Position { bps: number; units: number; cost: number }
export interface Fill {
  at: number; ticker: Ticker; side: 0 | 1; askedBps: number; allowedBps: number;
  price: number; outcome: number; reason: number; signature: string;
  /** Which feed priced the fill. */
  source?: 'Pyth' | 'Backpack';
}
export interface Activity { at: number; line: string; signature?: string }
export interface Book {
  /** Paper dollars not in a position. Starts at PAPER_BOOK_USD. */
  cash: number;
  /** Profit or loss already locked in by reductions. */
  realized: number;
  positions: Partial<Record<Ticker, Position>>;
  fills: Fill[];
  activity: Activity[];
  lastActionAt: Partial<Record<Ticker, number>>;
}

export const emptyBook = (): Book => ({
  cash: PAPER_BOOK_USD, realized: 0, positions: {}, fills: [], activity: [], lastActionAt: {},
});

/**
 * Fill a decision on paper at the live price. Only what the sentence allowed
 * is filled: a trimmed proposal fills the trimmed size, a refusal fills
 * nothing. Adds are sized against the starting book, reductions sell the
 * matching share of the position and lock in its profit or loss.
 */
export function applyFill(b: Book, ticker: Ticker, side: 0 | 1, allowedBps: number, price: number) {
  if (allowedBps <= 0 || !(price > 0)) return;
  const p = b.positions[ticker] ?? { bps: 0, units: 0, cost: 0 };
  if (side === 0) {
    const spend = Math.min(b.cash, (allowedBps / 10_000) * PAPER_BOOK_USD);
    p.units += spend / price;
    p.cost += spend;
    p.bps += allowedBps;
    b.cash -= spend;
  } else {
    if (p.bps <= 0) return;
    const f = Math.min(1, allowedBps / p.bps);
    const units = p.units * f;
    const costOut = p.cost * f;
    const proceeds = units * price;
    p.units -= units;
    p.cost -= costOut;
    p.bps = Math.max(0, p.bps - allowedBps);
    b.cash += proceeds;
    b.realized += proceeds - costOut;
  }
  b.positions[ticker] = p;
}
// Strong, not the default eventual: each pass reads the book the last one
// wrote. Eventual consistency lost four of seven fills in the first test run.
//
// Inside Netlify this is Blobs directly. On another machine (the Contabo
// runner) there is no Blobs access without an account-wide Netlify token,
// which is too much power to leave on a server, so it goes through
// /api/agent-store instead: one narrow endpoint, its own secret, and only
// the loop's own keys. Set CLEAT_STORE_URL and CLEAT_RUNNER_SECRET there.
export interface LoopStore {
  get(key: string, opts?: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

function remoteStore(url: string, secret: string): LoopStore {
  const call = async (op: string, body: Record<string, unknown>) => {
    const res = await fetch(`${url}/api/agent-store`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cleat-runner": secret },
      body: JSON.stringify({ op, ...body }),
    });
    if (!res.ok) throw new Error(`agent-store ${op} ${res.status}`);
    return res.json();
  };
  return {
    get: async (key) => ((await call("get", { key })) as { value: unknown }).value ?? null,
    setJSON: (key, value) => call("set", { key, value }),
    delete: (key) => call("delete", { key }),
    list: async ({ prefix }) => ({ blobs: ((await call("list", { prefix })) as { keys: string[] }).keys.map((key) => ({ key })) }),
  };
}

export const store = (): LoopStore =>
  process.env.CLEAT_STORE_URL && process.env.CLEAT_RUNNER_SECRET
    ? remoteStore(process.env.CLEAT_STORE_URL, process.env.CLEAT_RUNNER_SECRET)
    : (getStore({ name: "cleat-loop", consistency: "strong" }) as unknown as LoopStore);

/** A runner elsewhere writes this every pass. While it is fresh, Netlify's schedule stands down. */
export const RUNNER_HEARTBEAT = "runner/heartbeat";
export const RUNNER_FRESH_MS = 45 * 60 * 1000;
export const bookKey = (owner: string, index: number) => `book/${owner}/${index}`;

export async function readBook(owner: string, index: number): Promise<Book> {
  const b = (await store().get(bookKey(owner, index), { type: "json" })) as Book | null;
  return b ?? emptyBook();
}
export async function writeBook(owner: string, index: number, b: Book) {
  b.fills = b.fills.slice(-60);
  b.activity = b.activity.slice(-60);
  await store().setJSON(bookKey(owner, index), b);
}

/* ---- prices ---- */

export interface Quote { price: number; momentumBps: number; at: number; source: 'Pyth' | 'Backpack' }

/** Last close against the average of the window, in basis points. */
const momentum = (c: number[]) => {
  const mean = c.reduce((acc, x) => acc + x, 0) / c.length;
  return ((c[c.length - 1] - mean) / mean) * 10_000;
};

/**
 * Where a name is now against where it has been over the last four hours,
 * from five minute bars. Pyth first. Backpack when Pyth has no bars in the
 * window, which is what US market hours look like from Pyth, or no key.
 */
export async function quote(symbol: string): Promise<Quote | null> {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const from = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
  const to = Math.floor(Date.now() / 1000);
  const key = process.env.PYTH_API_KEY;
  if (key) {
    try {
      const res = await fetch(
        `${PYTH}/v1/fixed_rate@1000ms/history?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=5`,
        { headers: { authorization: `Bearer ${key}`, accept: "application/json" } },
      );
      if (res.ok) {
        const b = (await res.json()) as { c?: number[] };
        const c = (b.c ?? []).filter((n) => Number.isFinite(n) && n > 0);
        if (c.length) return { price: c[c.length - 1], momentumBps: momentum(c), at: to, source: "Pyth" };
      }
    } catch { /* fall through to the venue */ }
  }
  if (!inst) return null;
  try {
    const res = await fetch(`${BACKPACK}/klines?symbol=${encodeURIComponent(inst.venue)}&interval=5m&startTime=${from}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const bars = (await res.json()) as { close: string }[];
    const c = (Array.isArray(bars) ? bars : []).map((x) => Number(x.close)).filter((n) => Number.isFinite(n) && n > 0);
    if (!c.length) return null;
    return { price: c[c.length - 1], momentumBps: momentum(c), at: to, source: "Backpack" };
  } catch {
    return null;
  }
}

/* ---- chain ---- */

const enc = (s: string) => Buffer.from(s);
const idx = (i: number) => (i === 0 ? Buffer.alloc(0) : Buffer.from(Uint16Array.of(i).buffer));
export const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const vaultPda = (o: PublicKey, i: number) => pda([enc("vault"), o.toBuffer(), idx(i)]);
export const mandatePda = (o: PublicKey, i: number) => pda([enc("mandate"), o.toBuffer(), idx(i)]);
export const logPda = (o: PublicKey, i: number) => pda([enc("verdicts"), o.toBuffer(), idx(i)]);
const universePda = (m: PublicKey) => pda([enc("universe"), m.toBuffer()]);

/** Every vault that has handed this agent authority, with whether it is still live. */
export async function grantedVaults(conn: Connection) {
  const rows = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: "cJJWPqNMczr" } },
      { memcmp: { offset: 74, bytes: LOOP_AGENT.toBase58() } },
    ],
  });
  const now = Math.floor(Date.now() / 1000);
  return rows.map((r) => {
    const d = r.account.data;
    const owner = new PublicKey(d.subarray(8, 40));
    let index = -1;
    for (let i = 0; i < 32; i++) if (vaultPda(owner, i).equals(r.pubkey)) { index = i; break; }
    return {
      vault: r.pubkey, owner, index,
      expiresAt: Number(d.readBigInt64LE(106)),
      live: Number(d.readBigInt64LE(106)) > now,
    };
  }).filter((v) => v.index >= 0);
}

/** The halt flag, on the layouts that carry one. */
export function isHalted(mandate: Buffer): boolean {
  return mandate.length >= 676 + 3 && mandate[8 + 32 + 2] === 1;
}

const D_PROPOSE = Buffer.from([90, 218, 7, 166, 111, 48, 29, 15]);
const EVENT_DECIDED = Buffer.from([167, 144, 117, 143, 103, 76, 101, 235]);

/** Propose, wait for it to land, and read back what the program decided. */
export async function propose(
  conn: Connection, agent: Keypair, owner: PublicKey, index: number,
  category: number, bps: number, side: 0 | 1, mint: string,
) {
  const mandate = mandatePda(owner, index);
  const u16 = (n: number) => Buffer.from(Uint16Array.of(n).buffer);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda(owner, index), isSigner: false, isWritable: true },
      { pubkey: mandate, isSigner: false, isWritable: false },
      { pubkey: logPda(owner, index), isSigner: false, isWritable: true },
      { pubkey: universePda(mandate), isSigner: false, isWritable: false },
      { pubkey: TREASURY, isSigner: false, isWritable: true },
    ],
    // index, category, bps, from ingested content (never, it reads prices),
    // side, observed spread (0: there is no live book for these mints to read
    // a spread from, and inventing one would be worse), mint.
    data: Buffer.concat([
      D_PROPOSE, u16(index), Buffer.from([category]), u16(bps), Buffer.from([0]),
      Buffer.from([side]), u16(0), new PublicKey(mint).toBuffer(),
    ]),
  }));
  tx.feePayer = agent.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(agent);
  const signature = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  const got = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (got?.meta?.err) return { signature, error: JSON.stringify(got.meta.err) };
  for (const l of got?.meta?.logMessages ?? []) {
    if (!l.startsWith("Program data: ")) continue;
    const d = Buffer.from(l.slice(14), "base64");
    if (!d.subarray(0, 8).equals(EVENT_DECIDED)) continue;
    // fee u64, vault, version u16, category u8, proposed u16, allowed u16, outcome u8, reason u8
    const o = 8 + 8 + 32 + 2 + 1;
    return {
      signature,
      proposedBps: d.readUInt16LE(o),
      allowedBps: d.readUInt16LE(o + 2),
      outcome: d[o + 4],
      reason: d[o + 5],
    };
  }
  return { signature, error: "no decision in the logs" };
}

/* ---- the owner's read ---- */

const secret = () => process.env.CLEAT_BOOK_SECRET ?? "";

/** A day-long read token, issued after the owner signs once. */
export function issueToken(owner: string, index: number): string {
  const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const mac = createHmac("sha256", secret()).update(`${owner}:${index}:${exp}`).digest("hex");
  return `${exp}.${mac}`;
}
export function checkToken(owner: string, index: number, token: string): boolean {
  const [exp, mac] = token.split(".");
  if (!exp || !mac || Number(exp) < Date.now() / 1000 || !secret()) return false;
  const want = createHmac("sha256", secret()).update(`${owner}:${index}:${exp}`).digest("hex");
  return want.length === mac.length && timingSafeEqual(Buffer.from(want), Buffer.from(mac));
}

/** Marked to market: what each position is worth now, and the book overall. */
export function mark(book: Book, prices: Partial<Record<Ticker, number>>) {
  let invested = 0;
  let value = 0;
  const rows = INSTRUMENTS.map((i) => {
    const p = book.positions[i.ticker];
    const now = prices[i.ticker];
    if (!p || p.units <= 0) return null;
    const worth = now ? p.units * now : p.cost;
    invested += p.cost;
    value += worth;
    return {
      ticker: i.ticker, name: i.name, sector: i.sector, bookBps: p.bps,
      units: p.units, avgPrice: p.cost / p.units, price: now ?? null,
      pnl: worth - p.cost, pnlPct: p.cost > 0 ? ((worth - p.cost) / p.cost) * 100 : 0,
    };
  }).filter(Boolean);
  const total = book.cash + value;
  return {
    rows, cash: book.cash, invested, value,
    unrealized: value - invested, realized: book.realized,
    total, pnl: total - PAPER_BOOK_USD, pnlPct: ((total - PAPER_BOOK_USD) / PAPER_BOOK_USD) * 100,
  };
}

/* ---- the model ---- */

/**
 * Gemini decides; the rules are the fallback.
 *
 * Everything it is shown is public already: prices and their four hour move,
 * the owner's sentence and caps, which are on chain, and the paper book's
 * shares, which are simulated. No key, no holding, no identity. It can only
 * propose. The program still clears, trims or refuses what it asks, and its
 * answer is checked against a fixed shape and fixed bounds before anything is
 * sent; anything else falls back to the momentum rule. Free tier.
 */
// Newest first. gemini-2.5-flash is retired (404). The lite model is the
// fallback when the main one is busy, which on the free tier is often.
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
let geminiModel: string | null = null;
/** What the model did on the last call, for the manual run to report. */
export let lastGemini: { model?: string; status: string; answer?: string } = { status: "not called" };

/** Ask Google which Flash models this key can use, when every guess is gone. */
async function discoverModel(key: string): Promise<string | null> {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", { headers: { "x-goog-api-key": key } });
    if (!res.ok) return null;
    const b = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const ok = (b.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /flash/.test(m.name) && !/image|tts|live|audio|thinking/.test(m.name));
    return ok.length ? ok[0].name.replace(/^models\//, "") : null;
  } catch {
    return null;
  }
}

export interface Thought { ticker: Ticker; side: 0 | 1; bps: number; why: string; by: string }

export interface ThinkCtx {
  sentence: string; capBps: number; tradeCapBps: number; cash: number;
  quotes: Partial<Record<Ticker, Quote>>; book: Book;
}

/** The same question for every model: the public facts, and the fixed answer shape. */
function promptFor(ctx: ThinkCtx) {
  const names = INSTRUMENTS.filter((i) => ctx.quotes[i.ticker]);
  if (!names.length) return null;
  const facts = names.map((i) => {
    const q = ctx.quotes[i.ticker]!;
    const held = ctx.book.positions[i.ticker]?.bps ?? 0;
    const last = ctx.book.lastActionAt[i.ticker];
    return {
      ticker: i.ticker, name: i.name, sector: i.sector, price: Number(q.price.toFixed(4)),
      move_vs_4h_average_bps: Math.round(q.momentumBps), held_bps_of_book: held,
      minutes_since_last_trade: last ? Math.round((Date.now() - last) / 60000) : null,
    };
  });
  const prompt = [
    "You are the order entry agent for a paper trading book. You propose at most one trade, or hold.",
    "Use only the numbers given. Do not invent news, prices or facts. No advice, no predictions stated as fact.",
    `The owner's rule, which a program enforces after you: "${ctx.sentence.slice(0, 280)}"`,
    `Sector cap: ${ctx.capBps} bps of the book. Single trade cap: ${ctx.tradeCapBps} bps. Cash: $${ctx.cash.toFixed(0)} of a $${PAPER_BOOK_USD} book.`,
    `Instruments: ${JSON.stringify(facts)}`,
    "Favour holding unless a move is meaningful (roughly 25 bps or more). Do not add to a name traded in the last 120 minutes.",
    "Answer with action add, reduce or hold; ticker; bps between 100 and 500 (for reduce, at most what is held); and why in under 100 characters citing the numbers.",
    'Reply with only a JSON object: {"action":"...","ticker":"...","bps":0,"why":"..."}',
  ].join("\n");
  return { names, prompt };
}

/**
 * Read an answer, from whichever model, against the same bounds. The object
 * is found wherever it sits in the text, and a hold is read even from an
 * answer cut off halfway. Anything out of bounds is no answer at all.
 */
function readAnswer(text: string, ctx: ThinkCtx, by: string): Thought | "hold" | null {
  if (/"action"\s*:\s*"hold"/.test(text)) return "hold";
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) return null;
  let a: { action?: string; ticker?: string; bps?: number; why?: string };
  try { a = JSON.parse(found[0]); } catch { return null; }
  if (a.action === "hold" || !a.action) return "hold";
  const inst = INSTRUMENTS.find((i) => i.ticker === a.ticker);
  const bps = Math.round(Number(a.bps));
  if (!inst || !Number.isFinite(bps) || bps < 100 || bps > 500) return null;
  const held = ctx.book.positions[inst.ticker]?.bps ?? 0;
  if (a.action === "reduce" && (held <= 0 || bps > held)) return null;
  if (a.action !== "add" && a.action !== "reduce") return null;
  const why = String(a.why ?? "").replace(/[\r\n\u2014]/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
  if (!why) return null;
  return { ticker: inst.ticker, side: a.action === "add" ? 0 : 1, bps, why, by };
}

/**
 * A model on our own server, when there is one: any OpenAI-compatible
 * endpoint, such as the Qwen that already runs on the Contabo box. Nothing
 * leaves that machine. Set LOCAL_LLM_URL (the base, ending in /v1) and
 * LOCAL_LLM_MODEL. When it is set, Gemini is not asked at all.
 */
export async function thinkLocally(ctx: ThinkCtx): Promise<Thought | "hold" | null> {
  lastGemini = { status: "not called" };
  const base = process.env.LOCAL_LLM_URL;
  const q = promptFor(ctx);
  if (!base || !q) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.LOCAL_LLM_MODEL ?? "qwen",
        messages: [{ role: "user", content: q.prompt }],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) { lastGemini = { model: "local", status: `http ${res.status}` }; return null; }
    const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = out.choices?.[0]?.message?.content ?? "";
    const r = readAnswer(text, ctx, "the local model");
    lastGemini = { model: "local", status: r === "hold" ? "hold" : r ? "answered" : "unusable answer", answer: text.slice(0, 300) };
    return r;
  } catch (e) {
    lastGemini = { model: "local", status: `error ${String((e as Error)?.message ?? e).slice(0, 120)}` };
    return null;
  }
}

/** Whichever model this machine has: local first, Gemini otherwise. */
export const think = (ctx: ThinkCtx) => (process.env.LOCAL_LLM_URL ? thinkLocally(ctx) : thinkWithGemini(ctx));

export async function thinkWithGemini(ctx: ThinkCtx): Promise<Thought | "hold" | null> {
  lastGemini = { status: "not called" };
  const key = process.env.GEMINI_API_KEY;
  if (!key) { lastGemini = { status: "no key" }; return null; }
  const q = promptFor(ctx);
  if (!q) return null;
  const { names, prompt } = q;

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      // Newer Flash models reason before they answer, and that reasoning
      // counts against this. Too tight and the answer is cut off.
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING", enum: ["add", "reduce", "hold"] },
          ticker: { type: "STRING", enum: names.map((n) => n.ticker) },
          bps: { type: "INTEGER" },
          why: { type: "STRING" },
        },
        required: ["action", "ticker", "bps", "why"],
      },
    },
  });

  // The one that answered last time goes first, the rest stay behind it so a
  // busy model can hand over to the next.
  const models = geminiModel ? [geminiModel, ...GEMINI_MODELS.filter((m) => m !== geminiModel)] : [...GEMINI_MODELS];
  for (let n = 0; n < models.length; n++) {
    const model = models[n];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
      });
      if (res.status === 404) {
        // That name is gone. After the last guess, ask which ones exist.
        if (n === models.length - 1 && !models.includes("__discovered")) {
          const found = await discoverModel(key);
          if (found && !models.includes(found)) models.push(found, "__discovered");
        }
        continue;
      }
      if (model === "__discovered") continue;
      if (res.status === 503 || res.status === 429) {
        // Busy or rate limited. Try the next model before giving the pass
        // back to the rules.
        lastGemini = { model, status: `http ${res.status}, trying next` };
        continue;
      }
      if (!res.ok) { lastGemini = { model, status: `http ${res.status}`, answer: (await res.text()).slice(0, 200) }; return null; }
      if (!geminiModel) geminiModel = model;
      const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      // The schema asks for bare JSON; some models still wrap it in a sentence.
      // Take the object from whichever part carries it. The fields and bounds
      // below are checked either way.
      const text = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
      const r = readAnswer(text, ctx, "Gemini");
      lastGemini = { model, status: r === "hold" ? "hold" : r ? "answered" : "unusable answer", answer: text.slice(0, 300) };
      return r;
    } catch (e) {
      lastGemini = { model, status: `error ${String((e as Error)?.message ?? e).slice(0, 120)}` };
      return null;
    }
  }
  if (lastGemini.status === "not called") lastGemini = { status: "no model answered", answer: models.join(",") };
  return null;
}

/* ---- one pass of the loop ---- */

/** Why the sentence said no, as a clause that follows "because". */
const REASON = [
  "", "it would break the sector cap in your sentence", "it was bigger than one trade may be",
  "your sentence rules the name out", "your sentence changed after the grant was issued",
  "it came from something the agent read", "the market was too thin for your sentence",
  "that sector is already at its cap", "it passed the hard ceiling you set on the agent",
  "you stopped everything", "your sentence never declared the name",
  "the sector does not match the name",
];
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** How far off its four hour average a name has to be before the agent asks. */
const SIGNAL_BPS = 25;
/** How long before it asks to add to the same name again. */
const ADD_COOLDOWN_MS = 2 * 60 * 60 * 1000;
/** The size of one ask, in basis points of the book. */
const ASK_BPS = 200;

export async function runTick(opts: { force?: { owner: string; index: number; ticker: Ticker; side: 0 | 1; bps?: number } } = {}) {
  const url = process.env.SOLANA_RPC_URL;
  const secretKey = process.env.CLEAT_LOOP_AGENT;
  if (!url || !secretKey) return { ran: false, reason: "not configured" };
  const conn = new Connection(url, "confirmed");
  const agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKey)));

  const quotes: Partial<Record<Ticker, Quote>> = {};
  for (const i of INSTRUMENTS) {
    const q = await quote(i.symbol);
    if (q) quotes[i.ticker] = q;
  }

  let vaults = (await grantedVaults(conn)).filter((v) => v.live);
  if (opts.force) {
    vaults = vaults.filter((v) => v.owner.toBase58() === opts.force!.owner && v.index === opts.force!.index);
  }
  const done: unknown[] = [];

  for (const v of vaults.slice(0, 12)) {
    const owner = v.owner.toBase58();
    const book = await readBook(owner, v.index);
    const mandate = await conn.getAccountInfo(mandatePda(v.owner, v.index));
    if (!mandate) continue;
    if (isHalted(mandate.data)) {
      if (!book.activity.at(-1)?.line.startsWith("Stopped")) {
        book.activity.push({ at: Date.now(), line: "Stopped by you. Not asking for anything until you start it again." });
        await writeBook(owner, v.index, book);
      }
      continue;
    }

    // Pick the one thing worth asking for this pass, if anything.
    let pick: { ticker: Ticker; side: 0 | 1; bps: number; why: string } | null = null;
    let modelHeld = false;
    if (opts.force) {
      const held = book.positions[opts.force.ticker]?.bps ?? 0;
      pick = {
        ticker: opts.force.ticker, side: opts.force.side,
        bps: opts.force.bps ?? (opts.force.side === 1 ? held : ASK_BPS),
        why: "on a manual test run",
      };
      if (pick.side === 1 && pick.bps <= 0) pick = null;
    } else {
      // Gemini first, when there is a key. The momentum rule below is the
      // fallback for a failed, malformed or out-of-bounds answer.
      const caps = mandate.data;
      const hasHalt = caps.length >= 676 + 3;
      let o = 8 + 32 + 2 + (hasHalt ? 1 : 0);
      const tlen = caps.readUInt32LE(o);
      const sentence = caps.subarray(o + 4, o + 4 + tlen).toString("utf8");
      o += 4 + tlen + 32;
      const capBps = caps.readUInt16LE(o);
      const tradeCapBps = caps.readUInt16LE(o + 2);
      // A hold is a decision, not a missing answer, so the rule below does
      // not overrule it. Only a failed or unusable answer falls through.
      const thought = await think({ sentence, capBps, tradeCapBps, cash: book.cash, quotes, book }).catch(() => null);
      if (thought === "hold") modelHeld = true;
      else if (thought) pick = { ticker: thought.ticker, side: thought.side, bps: thought.bps, why: `because ${thought.why.replace(/\.$/, "")} (${thought.by}'s reasoning)` };
    }
    if (!pick && !opts.force && !modelHeld) {
      let best = 0;
      for (const i of INSTRUMENTS) {
        const q = quotes[i.ticker];
        if (!q) continue;
        const held = book.positions[i.ticker]?.bps ?? 0;
        const last = book.lastActionAt[i.ticker] ?? 0;
        const m = q.momentumBps;
        if (m >= SIGNAL_BPS && Date.now() - last > ADD_COOLDOWN_MS && m > best) {
          best = m;
          pick = { ticker: i.ticker, side: 0, bps: ASK_BPS, why: `as it rose ${pct(Math.round(m))} above its four hour average` };
        } else if (held > 0 && m <= -SIGNAL_BPS && -m > best) {
          best = -m;
          pick = { ticker: i.ticker, side: 1, bps: held, why: `as it fell ${pct(Math.round(-m))} below its four hour average` };
        }
      }
    }
    if (!pick) continue;

    const inst = INSTRUMENTS.find((i) => i.ticker === pick!.ticker)!;
    const q = quotes[pick.ticker];
    const verb = pick.side === 0 ? "add" : "reduce";
    try {
      const r = await propose(conn, agent, v.owner, v.index, inst.category, pick.bps, pick.side, inst.mint);
      book.lastActionAt[pick.ticker] = Date.now();
      if ("error" in r && r.error) {
        book.activity.push({ at: Date.now(), line: `Tried to ${verb} ${inst.name} and the chain refused the transaction: ${r.error}`, signature: r.signature });
      } else {
        const d = r as { signature: string; proposedBps: number; allowedBps: number; outcome: number; reason: number };
        const price = q?.price ?? 0;
        if (d.allowedBps > 0 && price > 0) applyFill(book, pick.ticker, pick.side, d.allowedBps, price);
        book.fills.push({
          at: Date.now(), ticker: pick.ticker, side: pick.side, askedBps: d.proposedBps,
          allowedBps: d.allowedBps, price, outcome: d.outcome, reason: d.reason, signature: d.signature,
          source: q?.source,
        });
        const ask = `Asked to ${verb} ${pct(d.proposedBps)} of the book in ${inst.name} ${pick.why}.`;
        const said =
          d.outcome === 0 ? `Cleared, filled on paper at ${money(price)} (${q?.source ?? "last"} price).`
          : d.outcome === 1 ? `Trimmed to ${pct(d.allowedBps)} because ${REASON[d.reason] || "your sentence said so"}, filled on paper at ${money(price)} (${q?.source ?? "last"} price).`
          : `Refused because ${REASON[d.reason] || "your sentence said so"}. Nothing filled.`;
        book.activity.push({ at: Date.now(), line: `${ask} ${said}`, signature: d.signature });
      }
      await writeBook(owner, v.index, book);
      done.push({ owner, index: v.index, ticker: pick.ticker, side: pick.side, result: r });
    } catch (e) {
      book.activity.push({ at: Date.now(), line: `Tried to ${verb} ${inst.name} and could not reach the chain.` });
      await writeBook(owner, v.index, book);
      done.push({ owner, index: v.index, error: String((e as Error).message ?? e).slice(0, 200) });
    }
  }

  await store().setJSON("last-tick", {
    at: Date.now(),
    quotes,
    vaults: vaults.length,
    proposals: done.length,
  });
  return { ran: true, vaults: vaults.length, quotes, done, gemini: lastGemini };
}
