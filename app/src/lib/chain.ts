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
  "8QXJYpb7gKV99DuSjDX7FCyUgj73qxhQ9px5cQLTiCMc",
);

/** In the browser we go through the proxy so the upstream key stays server side. */
const RPC_URL =
  (import.meta as any).env?.VITE_RPC_URL ??
  (typeof window !== "undefined" ? "/api/rpc" : "https://api.devnet.solana.com");

export const connection = new Connection(
  RPC_URL.startsWith("/") ? new URL(RPC_URL, window.location.origin).toString() : RPC_URL,
  "confirmed",
);

export const mandatePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), owner.toBuffer()],
    PROGRAM_ID,
  )[0];

export const verdictLogPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("verdicts"), owner.toBuffer()],
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
}

export interface Mandate {
  version: number;
  text: string;
  maxPositionBps: number;
  maxTradeBps: number;
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

/** 0 none, 1 position cap, 2 single trade cap, 3 denied asset, 4 stale, 5 ingested. */
const REASONS = [
  "",
  'Triggered boundary: the position cap',
  'Triggered boundary: the single trade cap',
  "Triggered boundary: an asset the mandate refuses",
  "The mandate changed after the grant was issued",
  "The instruction arrived inside something the agent read",
];

const OUTCOME_TO_STATUS: EntryStatus[] = ["cleared", "trimmed", "refused"];
const OUTCOME_LABEL = ["Cleared", "Trimmed", "Refused"];

export function decodeVerdictLog(data: Uint8Array): VerdictLog {
  const b = Buffer.from(data);
  let o = 8 + 32 + 32; // discriminator, owner, vault
  o += 1; // head
  const cleared = b.readUInt32LE(o); o += 4;
  const clamped = b.readUInt32LE(o); o += 4;
  const refused = b.readUInt32LE(o); o += 4;
  const count = b.readUInt32LE(o); o += 4;

  const entries: Verdict[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      slot: b.readBigUInt64LE(o),
      mandateVersion: b.readUInt16LE(o + 8),
      category: b.readUInt8(o + 10),
      proposedBps: b.readUInt16LE(o + 11),
      allowedBps: b.readUInt16LE(o + 13),
      outcome: b.readUInt8(o + 15),
      reason: b.readUInt8(o + 16),
    });
    o += 17;
  }
  return { cleared, clamped, refused, entries };
}

export function decodeMandate(data: Uint8Array): Mandate {
  const b = Buffer.from(data);
  let o = 8 + 32; // discriminator, owner
  const version = b.readUInt16LE(o); o += 2;
  const textLen = b.readUInt32LE(o); o += 4;
  const text = b.subarray(o, o + textLen).toString("utf8"); o += textLen;
  o += 32; // text hash
  const maxPositionBps = b.readUInt16LE(o); o += 2;
  const maxTradeBps = b.readUInt16LE(o); o += 2;
  const deniedLen = b.readUInt32LE(o); o += 4 + deniedLen * 32;
  const hasParent = b.readUInt8(o); o += 1 + (hasParent ? 32 : 0);
  const adoptCount = b.readUInt32LE(o);
  return { version, text, maxPositionBps, maxTradeBps, adoptCount };
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
      v.outcome === 2 && v.reason === 5
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
    solanaSlot: Number(v.slot),
  };
}

export interface ChainSnapshot {
  mandate: Mandate | null;
  stats: EnforcerStats;
  entries: LedgerEntry[];
  markers: ChartMarker[];
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
    const [logInfo, mandateInfo, latestSlot] = await Promise.all([
      connection.getAccountInfo(verdictLogPda(owner)),
      connection.getAccountInfo(mandatePda(owner)),
      connection.getSlot(),
    ]);
    if (!logInfo) return null;

    const log = decodeVerdictLog(logInfo.data);
    if (log.entries.length === 0) return null;

    const slot = BigInt(latestSlot);
    // newest first, the way a diary reads
    const ordered = [...log.entries].reverse();

    return {
      mandate: mandateInfo ? decodeMandate(mandateInfo.data) : null,
      stats: { cleared: log.cleared, trimmed: log.clamped, refused: log.refused },
      entries: ordered.map((v, i) => verdictToLedgerEntry(v, i, slot)),
      markers: log.entries.map((v, i) =>
        verdictToChartMarker(v, i, log.entries.length),
      ),
    };
  } catch {
    // An unreachable endpoint should degrade to the sample data, not a blank app.
    return null;
  }
}
