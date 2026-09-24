/**
 * What the thing actually cost, read off the recordings rather than typed in.
 *
 * Several panels in this app quoted latencies. They were written by hand,
 * they were wrong, and they were wrong in the flattering direction: one of
 * them claimed the confidential gate answers in twenty two milliseconds when
 * the measured median is three and a quarter seconds, which is a number any
 * judge discovers by pressing the button and counting. A figure nobody can
 * reproduce is worse than no figure, and a figure two orders of magnitude
 * too good is worse than that.
 *
 * So the numbers come from the files in measurements/, which are written by
 * the scripts that did the runs and carry devnet signatures. They are
 * imported rather than copied, so the day somebody records a better run the
 * screen changes with it and cannot drift back into fiction.
 *
 * These are devnet, on a handful of samples, from one machine in one place.
 * That is said on screen wherever they appear, because a median of twenty
 * one runs is evidence and not a benchmark.
 */

interface GateFile {
  measuredAt: string;
  cluster: number;
  circuit: string;
  runs?: { landed?: boolean; totalMs?: number; queuedMs?: number }[];
}

interface RefusalFile {
  measuredAt: string;
  evidence?: { ms?: number; signature?: string }[];
}

const gateFiles = import.meta.glob<GateFile>('../../../measurements/gate-*.json', {
  eager: true, import: 'default',
});
const refusalFiles = import.meta.glob<RefusalFile>('../../../measurements/refusals-*.json', {
  eager: true, import: 'default',
});

export interface Measured {
  /** How many runs are behind the number. */
  n: number;
  min: number;
  p50: number;
  max: number;
  /** When the most recent of those runs was recorded. */
  at: string | null;
}

const summarise = (values: number[], at: string | null): Measured => {
  const v = [...values].sort((a, b) => a - b);
  return {
    n: v.length,
    min: v[0] ?? 0,
    p50: v[Math.floor(v.length / 2)] ?? 0,
    max: v[v.length - 1] ?? 0,
    at,
  };
};

const newest = (dates: (string | undefined)[]) =>
  dates.filter(Boolean).sort().pop() ?? null;

/** The confidential gate: queue, circuit, callback, verdict readable. */
export const ARCIUM: Measured = (() => {
  const all: number[] = [];
  const dates: (string | undefined)[] = [];
  for (const f of Object.values(gateFiles)) {
    dates.push(f?.measuredAt);
    for (const r of f?.runs ?? []) {
      if (r.landed && typeof r.totalMs === 'number') all.push(r.totalMs);
    }
  }
  return summarise(all, newest(dates));
})();

/** The public policy path, decided inside one ordinary Solana transaction. */
export const PUBLIC_GATE: Measured = (() => {
  const all: number[] = [];
  const dates: (string | undefined)[] = [];
  for (const f of Object.values(refusalFiles)) {
    dates.push(f?.measuredAt);
    for (const e of f?.evidence ?? []) {
      if (typeof e.ms === 'number') all.push(e.ms);
    }
  }
  return summarise(all, newest(dates));
})();

/**
 * The attested rollup leg, from scripts/roundtrip.mjs.
 *
 * Not imported from a file because that script prints its timings rather
 * than writing them, which is a gap worth closing and not tonight. Each of
 * these came off a run whose transactions are on devnet.
 */
export const PER = {
  attestationMs: 1808,
  sealMs: 168,
  releaseMs: 205,
  /** Median submit to confirm once the vault is inside the rollup. */
  insideMs: 36,
  at: '2026-09-22',
};

/** "3,254ms" rather than "3254". */
export const ms = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 2)}s` : `${Math.round(n)}ms`;

/** One line saying where a number came from, for putting under it. */
export const provenance = (m: Measured) =>
  m.n > 0
    ? `median of ${m.n} devnet runs${m.at ? `, ${m.at.slice(0, 10)}` : ''}`
    : 'not measured yet';
