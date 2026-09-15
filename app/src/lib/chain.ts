// Reading the real thing off devnet.
//
// Every number the diary and the chart show comes from here. The account
// layouts below mirror the Rust structs exactly, so if a field is added to the
// program this file is the one that has to move with it.
//
// Note what is NOT here: there is no way to read a holding, because there isn't
// one to read. A verdict records a sector and a share of the portfolio and
// nothing else, which is the same reason the UI can show this to anybody.

import { Connection, PublicKey } from "@solana/web3.js";
import type { LedgerEntry, ChartMarker, EntryStatus, EnforcerStats } from "../types";

export const PROGRAM_ID = new PublicKey(
  "2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL",
);

/** A devnet owner whose verdict log holds real decisions, for the preview. */
export const DEMO_OWNER = new PublicKey(
  "GZGvz2J7jLpdAJXvWf92cSKL2uJTzCAF2fiutfpzvnEc",
);

/** In the browser we go through the proxy so the upstream key stays server side. */
const RPC_URL =
  (import.meta as any).env?.VITE_RPC_URL ??
  (typeof window !== "undefined" ? "/api/rpc" : "https://api.devnet.solana.com");

export const connection = new Connection(
  RPC_URL.startsWith("/") ? new URL(RPC_URL, window.location.origin).toString() : RPC_URL,
  "confirmed",
);

/**
 * Reading account bytes without Node's Buffer.
 *
 * `Buffer` is not a browser global. It was being used here anyway, which
 * worked for exactly as long as something else in the bundle happened to
 * define it, and when that stopped the whole chain read threw and the app fell
 * back to sample data with nothing on screen to say so. A DataView needs no
 * polyfill and cannot quietly disappear.
 */
const seed = (s: string) => new TextEncoder().encode(s);

class Cursor {
  private view: DataView;
  private bytes: Uint8Array;
  o = 0;

  constructor(data: Uint8Array) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get length() {
    return this.bytes.length;
  }

  u8(at = this.o, advance = true) {
    const v = this.view.getUint8(at);
    if (advance && at === this.o) this.o += 1;
    return v;
  }

  u16(at = this.o, advance = true) {
    const v = this.view.getUint16(at, true);
    if (advance && at === this.o) this.o += 2;
    return v;
  }

  u32(at = this.o, advance = true) {
    const v = this.view.getUint32(at, true);
    if (advance && at === this.o) this.o += 4;
    return v;
  }

  u64(at = this.o, advance = true) {
    const v = this.view.getBigUint64(at, true);
    if (advance && at === this.o) this.o += 8;
    return v;
  }

  slice(n: number) {
    const v = this.bytes.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }

  utf8(n: number) {
    return new TextDecoder().decode(this.slice(n));
  }

  skip(n: number) {
    this.o += n;
  }
}

export const mandatePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [seed("mandate"), owner.toBuffer()],
    PROGRAM_ID,
  )[0];

/**
 * The Arcium accounts behind the confidential gate.
 *
 * Written down rather than derived. Deriving them needs the circuit name
 * hashed through Arcium's own offset scheme, which means shipping their client
 * into the bundle to recompute two constants that cannot change while the
 * circuit keeps its name. Both were read off devnet on 15 September 2026 and
 * both are owned by the Arcium program.
 */
export const ARCIUM_COMP_DEF = new PublicKey(
  "FCQCHbvqM2wxyzWHCY6u3hy2dpk4rsr51NJRa2KL4EN9",
);
export const ARCIUM_MXE = new PublicKey(
  "DMNi8mRDCMDnnQv4q9WBsZPDxKN1dk26kDWWYw2nwLow",
);

export interface GateCheck {
  label: string;
  /** "live" is read and true. "blocked" is read and false. */
  state: "live" | "blocked" | "unknown";
  detail: string;
}

/**
 * What is actually standing between an agent and the book, checked rather
 * than claimed.
 *
 * This replaced a badge that ran a timer for seven hundred milliseconds and
 * then announced an Arcium computation had been attested at eighteen
 * milliseconds. No computation ran, the number was invented, and the
 * confidential gate it was reporting on has never returned a verdict. On a
 * product whose argument is that you should not have to trust it, that was
 * the worst thing on the screen.
 *
 * Two of these three are now read off the chain on every load. The third is
 * stated plainly, because it is false and saying so is the only honest
 * option available.
 */
export async function loadGateStatus(): Promise<GateCheck[]> {
  const read = async (key: PublicKey) => {
    try {
      return await connection.getAccountInfo(key);
    } catch {
      return null;
    }
  };

  const [program, compDef, mxe] = await Promise.all([
    read(PROGRAM_ID),
    read(ARCIUM_COMP_DEF),
    read(ARCIUM_MXE),
  ]);

  return [
    {
      label: "Boundaries enforced on chain",
      state: program?.executable ? "live" : "unknown",
      detail: program?.executable
        ? "The program is deployed and executable on devnet. Every refusal on this screen came out of it."
        : "Could not reach the program account from here.",
    },
    {
      label: "Confidential circuit finalised",
      state: compDef && mxe ? "live" : "unknown",
      detail:
        compDef && mxe
          ? "The computation definition and the execution environment both exist on devnet, owned by the Arcium program."
          : "Could not read the Arcium accounts from here.",
    },
    {
      label: "Gate returning verdicts",
      state: "blocked",
      detail:
        "It is not. The network runs the computation and the callback is delivered, and what comes back is a signed failure. A circuit that runs on this same cluster under a different environment, copied byte for byte, fails here too, which puts the fault above this program. TOOLCHAIN.md has the reproduction.",
    },
  ];
}

export const vaultPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [seed("vault"), owner.toBuffer()],
    PROGRAM_ID,
  )[0];

export const verdictLogPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [seed("verdicts"), owner.toBuffer()],
    PROGRAM_ID,
  )[0];

export interface Verdict {
  slot: bigint;
  mandateVersion: number;
  category: number;
  proposedBps: number;
  allowedBps: number;
  outcome: number; // 0 cleared, 1 trimmed, 2 refused
  reason: number;
}

export interface VerdictLog {
  cleared: number;
  clamped: number;
  refused: number;
  entries: Verdict[];
  /** What has been cleared into each sector so far, in basis points. */
  exposureBps: number[];
}

export interface Mandate {
  version: number;
  /** The owner stopped everything. Nothing proposes until they lift it. */
  halted: boolean;
  text: string;
  maxPositionBps: number;
  maxTradeBps: number;
  /** The widest market the agent may trade into. Zero means unset. */
  maxSpreadBps: number;
  /** Mints the sentence rules out, resolved off chain and enforced on it. */
  denied: string[];
  adoptCount: number;
}

const SECTORS = [
  "Unspecified",
  "Technology",
  "Energy",
  "Healthcare",
  "Financials",
  "Consumer",
];

/**
 * 0 none, 1 position cap, 2 single trade cap, 3 denied asset, 4 stale,
 * 5 ingested, 6 the book was too wide, 7 the sector is already at its cap,
 * 8 past the hard ceiling the owner set on the agent.
 */
const REASONS = [
  "",
  "Triggered boundary: the position cap",
  "Triggered boundary: the single trade cap",
  "Triggered boundary: an asset the mandate refuses",
  "The mandate changed after the grant was issued",
  "The instruction arrived inside something the agent read",
  "The book was wider than the mandate will trade into",
  "Triggered boundary: this sector is already at its cap",
  "Triggered boundary: the agent's hard ceiling in cash",
  "The owner halted the mandate",
];

/** The program's reason codes, rendered for a reader. */
export const reasonText = (reason: number) =>
  REASONS[reason] ?? "Inside every limit set";

/** 0 cleared, 1 trimmed, 2 refused. */
export const outcomeLabel = (outcome: number) =>
  OUTCOME_LABEL[outcome] ?? "Refused";

const OUTCOME_TO_STATUS: EntryStatus[] = ["cleared", "trimmed", "refused"];
const OUTCOME_LABEL = ["Cleared", "Trimmed", "Refused"];

export function decodeVerdictLog(data: Uint8Array): VerdictLog {
  const c = new Cursor(data);
  c.skip(8 + 32 + 32); // discriminator, owner, vault
  c.skip(1); // head
  const cleared = c.u32();
  const clamped = c.u32();
  const refused = c.u32();
  const count = c.u32();

  const entries: Verdict[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      slot: c.u64(),
      mandateVersion: c.u16(),
      category: c.u8(),
      proposedBps: c.u16(),
      allowedBps: c.u16(),
      outcome: c.u8(),
      reason: c.u8(),
    });
  }

  // Sector totals sit straight after the entries, so where they start depends
  // on how many verdicts are in the log. Older accounts were written before
  // these existed and are read as zero rather than as an error, because during
  // an upgrade both layouts are on chain at once and a reader that assumes the
  // newer one turns every older account into garbage. Garbage is worse than an
  // absence, because it looks like data.
  const exposureBps: number[] = [];
  for (let i = 0; i < SECTORS.length; i++) {
    exposureBps.push(c.o + 2 <= c.length ? c.u16() : 0);
  }

  return { cleared, clamped, refused, entries, exposureBps };
}

export function decodeMandate(data: Uint8Array): Mandate {
  // Three layouts have existed and the difference is not visible by parsing.
  //
  // The spread cap arrived after the first accounts were written, and the halt
  // flag after that. During an upgrade all of them sit on chain at once, and a
  // reader that assumes the newest turns every older account into garbage
  // rather than into an error. Garbage is the worse failure, because it looks
  // like data: an account read one field out of step reported an adoption count
  // of two point seven billion and nothing about the screen said anything was
  // wrong.
  //
  // Anchor allocates the whole max_len up front, so parsing cannot tell them
  // apart; both walk to a plausible end through the padding. The allocation
  // itself can. Each field added makes the account exactly that much larger.
  const WITHOUT_SPREAD = 676;
  const hasSpread = data.length >= WITHOUT_SPREAD + 2;
  const hasHalt = data.length >= WITHOUT_SPREAD + 3;

  const c = new Cursor(data);
  c.skip(8 + 32); // discriminator, owner
  const version = c.u16();
  const halted = hasHalt ? c.u8() === 1 : false;
  const textLen = c.u32();
  const text = c.utf8(textLen);
  c.skip(32); // text hash
  const maxPositionBps = c.u16();
  const maxTradeBps = c.u16();
  const maxSpreadBps = hasSpread ? c.u16() : 0;

  const deniedLen = c.u32();
  const denied: string[] = [];
  for (let i = 0; i < deniedLen; i++) {
    denied.push(new PublicKey(c.slice(32)).toBase58());
  }
  const hasParent = c.u8();
  if (hasParent) c.skip(32);
  const adoptCount = c.u32();

  return {
    version,
    halted,
    text,
    maxPositionBps,
    maxTradeBps,
    maxSpreadBps,
    denied,
    adoptCount,
  };
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** Devnet slots are about 400ms apart, which is close enough to date an entry. */
function slotToClock(slot: bigint, latestSlot: bigint): string {
  const secondsAgo = Number(latestSlot - slot) * 0.4;
  const d = new Date(Date.now() - secondsAgo * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")} UTC`;
}

export function verdictToLedgerEntry(
  v: Verdict,
  i: number,
  latestSlot: bigint,
): LedgerEntry {
  const status = OUTCOME_TO_STATUS[v.outcome] ?? "refused";
  const sector = SECTORS[v.category] ?? "Unspecified";
  const action =
    v.outcome === 0
      ? `Cleared ${pct(v.allowedBps)} into ${sector}`
      : v.outcome === 1
        ? `Trimmed ${pct(v.proposedBps)} to ${pct(v.allowedBps)} in ${sector}`
        : `Blocked ${pct(v.proposedBps)} into ${sector}`;

  return {
    id: `chain-${v.slot}-${i}`,
    status,
    statusLabel: OUTCOME_LABEL[v.outcome] ?? "Refused",
    timestamp: slotToClock(v.slot, latestSlot),
    action,
    cause: REASONS[v.reason] || "Inside every limit set",
    causeDetail:
      v.outcome === 2 && v.reason === 6
        ? "Every size check passed. The book where this would have landed was wider than the sentence allows, and a trade that clears every cap still executes badly into a market that thin."
        : v.outcome === 2 && v.reason === 5
        ? "The proposal originated in content the agent ingested rather than in its own reasoning. Size was never the question."
        : `Decided against mandate version ${v.mandateVersion}. The sector and the share of the book are recorded; the holding is not.`,
    agentTrace: `Slot ${v.slot}. Asked ${pct(v.proposedBps)}, allowed ${pct(
      v.allowedBps,
    )}. Holdings never left the computation.`,
    period: "overnight",
    expanded: i === 0,
  };
}

export function verdictToChartMarker(
  v: Verdict,
  i: number,
  count: number,
): ChartMarker {
  const status = OUTCOME_TO_STATUS[v.outcome] ?? "refused";
  return {
    id: `mk-${v.slot}-${i}`,
    ticker: SECTORS[v.category] ?? "Unspecified",
    time: `slot ${v.slot}`,
    title: OUTCOME_LABEL[v.outcome] ?? "Refused",
    desc: REASONS[v.reason] || "Inside every limit set",
    rule: `Asked ${pct(v.proposedBps)}, allowed ${pct(v.allowedBps)}`,
    saved: v.outcome === 2 ? pct(v.proposedBps) : pct(0),
    status,
    price: 0,
    // spread the marks across the plot so the shape of the session reads
    cx: count > 1 ? 30 + (i * 320) / (count - 1) : 180,
    cy: v.outcome === 2 ? 42 : v.outcome === 1 ? 70 : 96,
    r: 4,
    proposedBps: v.proposedBps,
    solanaSlot: Number(v.slot),
  };
}

/**
 * What the agent asked for against what the sentence allowed.
 *
 * Arithmetic over the log and nothing else: every proposal's size added up,
 * and every allowance added up. No interpretation, no counterfactual about
 * what would have been bought, which is why it can be said without hedging.
 * It is the shortest true answer to what the boundary is worth.
 */
/**
 * Whether the vault is actually sealed, rather than whether we would like it
 * to be.
 *
 * Sealing means the vault has been delegated to MagicBlock's attested rollup
 * and its privacy flags set, and delegation reassigns the account away from
 * this program. So the owner field answers the question on its own: if the
 * program still owns it, nothing has been sealed, whatever the screen says.
 *
 * "pending" is set by the app while a delegation is in flight, because that
 * is the one state a single read cannot see.
 */
export type SealState = "cleated" | "pending" | "open";

export interface Restraint {
  askedBps: number;
  allowedBps: number;
  heldBps: number;
}

export interface SectorExposure {
  sector: string;
  bps: number;
  capBps: number;
}

export interface ChainSnapshot {
  mandate: Mandate | null;
  stats: EnforcerStats;
  entries: LedgerEntry[];
  markers: ChartMarker[];
  /** Sectors that have something in them, against the cap they run to. */
  exposure: SectorExposure[];
  restraint: Restraint;
  sealed: SealState;
}

/**
 * One round trip for everything the diary and the chart need.
 *
 * Returns null rather than throwing when there is nothing on chain yet, so the
 * caller can keep showing the sample data instead of an empty screen.
 */
export async function loadChainSnapshot(
  owner: PublicKey = DEMO_OWNER,
): Promise<ChainSnapshot | null> {
  try {
    const [logInfo, mandateInfo, vaultInfo, latestSlot] = await Promise.all([
      connection.getAccountInfo(verdictLogPda(owner)),
      connection.getAccountInfo(mandatePda(owner)),
      connection.getAccountInfo(vaultPda(owner)),
      connection.getSlot(),
    ]);
    if (!logInfo) return null;

    const log = decodeVerdictLog(logInfo.data);
    if (log.entries.length === 0) return null;
    const mandate = mandateInfo ? decodeMandate(mandateInfo.data) : null;

    const slot = BigInt(latestSlot);
    // newest first, the way a diary reads
    const ordered = [...log.entries].reverse();

    return {
      mandate,
      stats: { cleared: log.cleared, trimmed: log.clamped, refused: log.refused },
      entries: ordered.map((v, i) => verdictToLedgerEntry(v, i, slot)),
      markers: log.entries.map((v, i) =>
        verdictToChartMarker(v, i, log.entries.length),
      ),
      // Only the sectors with something in them. An empty one is not a fact
      // worth a row, and the list is short enough to read at a glance.
      // Delegation moves the account away from this program, so an owner that
      // is still the program means nothing has been sealed.
      sealed: (vaultInfo && !vaultInfo.owner.equals(PROGRAM_ID)
        ? "cleated"
        : "open") as SealState,
      restraint: log.entries.reduce(
        (acc, v) => ({
          askedBps: acc.askedBps + v.proposedBps,
          allowedBps: acc.allowedBps + v.allowedBps,
          heldBps: acc.heldBps + (v.proposedBps - v.allowedBps),
        }),
        { askedBps: 0, allowedBps: 0, heldBps: 0 },
      ),
      exposure: log.exposureBps
        .map((bps, i) => ({
          sector: SECTORS[i] ?? "Unspecified",
          bps,
          capBps: mandate?.maxPositionBps ?? 0,
        }))
        .filter((e) => e.bps > 0),
    };
  } catch (err) {
    // An unreachable endpoint should degrade to the sample data, not a blank
    // app. It should not degrade silently, though: a screen that quietly falls
    // back to samples looks exactly like a screen that is working, and the
    // whole claim of this one is that what it shows came off the chain.
    console.warn("chain snapshot unavailable, showing sample data", err);
    return null;
  }
}
