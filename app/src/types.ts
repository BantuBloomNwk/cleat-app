export type TabType = 'diary' | 'chart' | 'mandates' | 'you';

export type EntryStatus = 'refused' | 'trimmed' | 'cleared';

export interface LedgerEntry {
  id: string;
  status: EntryStatus;
  statusLabel: string;
  timestamp: string;
  action: string;
  cause: string;
  causeDetail: string;
  agentTrace: string;
  period: 'overnight' | 'week' | 'month';
  /** Seconds since the decision, from its slot. Absent on sample rows. */
  ageSecs?: number;
  /** The raw decision, for a receipt. Absent on sample rows. */
  raw?: { outcome: number; reason: number; category: number; proposedBps: number; allowedBps: number };
  ticker?: string;
  amount?: string;
  expanded?: boolean;
}

export interface ChartMarker {
  id: string;
  ticker: string;
  time: string;
  title: string;
  desc: string;
  rule: string;
  saved: string;
  status: EntryStatus;
  price: number;
  cx: number;
  cy: number;
  r: number;
  hasRadarRing?: boolean;
  venue?: string;
  /** A share of the book in basis points. The log never records an amount. */
  proposedBps?: number;
  drawdownSaved?: string;
  slippagePrevented?: string;
  blockNumber?: number;
  solanaSlot?: number;
  gasSaved?: string;
  cuSaved?: string;
  zkProofHash?: string;
  proofSig?: string;
  perMpcSession?: string;
  arciumClusterId?: string;
  counterfactualPnl?: string;
  rawPayload?: string;
}

export interface TimeInterval {
  label: string;
  x: number;
}

export interface PriceLevel {
  label: string;
  y: number;
}

export interface TimeframeData {
  tf: '1H' | '24H' | '7D' | '30D' | '1Y' | 'ALL';
  netReturnText: string;
  refusalsCountText: string;
  trajectoryPath: string;
  ceilingPath?: string;
  floorPath?: string;
  areaFillPath: string;
  timeIntervals: TimeInterval[];
  priceLevels: PriceLevel[];
  markers: ChartMarker[];
}

export interface EnforcerStats {
  cleared: number;
  trimmed: number;
  refused: number;
}
