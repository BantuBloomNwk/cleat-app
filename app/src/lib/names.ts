import { useEffect, useState } from 'react';

/**
 * Primary .sol names for the owners on screen, where they have one.
 * Remembered on the device for a day. Everyone without a name keeps their
 * short address, which is what identity is here.
 */
const KEY = 'cleat_names_v1';
const DAY = 24 * 60 * 60 * 1000;
const known = new Map<string, string | null>();
try {
  const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { at: number; names: Record<string, string | null> } | null;
  if (raw && Date.now() - raw.at < DAY) for (const [k, v] of Object.entries(raw.names)) known.set(k, v);
} catch { /* look them up */ }

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const displayName = (owner: string, names: Map<string, string | null>) => names.get(owner) ?? shortAddress(owner);

export function useNames(owners: string[]): Map<string, string | null> {
  const [names, setNames] = useState(() => new Map(known));
  const want = [...new Set(owners)].filter((o) => !known.has(o)).sort().join(',');
  useEffect(() => {
    if (!want) return;
    let live = true;
    fetch(`/api/names?owners=${want}`)
      .then((r) => r.json())
      .then((b: { names: Record<string, string | null> }) => {
        for (const [k, v] of Object.entries(b.names ?? {})) known.set(k, v);
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), names: Object.fromEntries(known) })); } catch { /* session only */ }
        if (live) setNames(new Map(known));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [want]);
  return names;
}
