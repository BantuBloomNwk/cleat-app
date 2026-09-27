import React, { useEffect, useMemo, useState } from 'react';
import { SECTORS, connection, loadAllVerdicts, type PlacedVerdict } from '../lib/chain';
import { DataOrigin } from './DataOrigin';

/** Ten minutes of devnet slots, at about 400ms each. */
const WINDOW_SLOTS = 1500n;

interface Moment { category: number; logs: Set<string>; start: bigint; end: bigint; count: number }

/**
 * Held together: when several sentences refused the same sector at once.
 *
 * The one thing in the room that strangers share. Nobody wrote a post and
 * nobody can see a book; the chain simply shows that in the same ten minutes
 * a handful of unrelated sentences all said no to the same sector. A single
 * sentence refusing is not a moment, so it takes two different ones.
 */
export const HeldTogether: React.FC<{ myLogs: string[] }> = ({ myLogs }) => {
  const [verdicts, setVerdicts] = useState<PlacedVerdict[] | null>(null);
  const [nowSlot, setNowSlot] = useState(0n);

  useEffect(() => {
    let live = true;
    Promise.all([loadAllVerdicts(), connection.getSlot().catch(() => 0)]).then(([v, s]) => {
      if (!live) return;
      setVerdicts(v);
      setNowSlot(BigInt(s || 0));
    });
    return () => { live = false; };
  }, []);

  const moments = useMemo(() => {
    if (!verdicts) return [];
    const out: Moment[] = [];
    for (let c = 1; c < SECTORS.length; c++) {
      const refusals = verdicts.filter((v) => v.outcome === 2 && v.category === c).sort((a, b) => Number(a.slot - b.slot));
      let i = 0;
      while (i < refusals.length) {
        const start = refusals[i].slot;
        const inWindow = [];
        let j = i;
        while (j < refusals.length && refusals[j].slot - start <= WINDOW_SLOTS) inWindow.push(refusals[j++]);
        const logs = new Set(inWindow.map((v) => v.logAddress));
        if (logs.size >= 2) {
          out.push({ category: c, logs, start, end: inWindow[inWindow.length - 1].slot, count: inWindow.length });
          i = j; // windows do not overlap
        } else {
          i++;
        }
      }
    }
    return out.sort((a, b) => Number(b.end - a.end)).slice(0, 3);
  }, [verdicts]);

  if (!verdicts || moments.length === 0) return null;
  const mine = new Set(myLogs);

  return (
    <section className="flex flex-col gap-2" id="held-together">
      <div className="section-row-header">
        <h3 className="section-heading text-[16px] font-bold">Held together</h3>
        <DataOrigin origin="chain" />
      </div>
      {moments.map((m) => {
        const agoS = nowSlot > 0n ? Number(nowSlot - m.end) * 0.4 : 0;
        const ago = agoS < 3600 ? `${Math.max(1, Math.round(agoS / 60))}m` : agoS < 86400 ? `${Math.round(agoS / 3600)}h` : `${Math.round(agoS / 86400)}d`;
        const yours = [...m.logs].some((l) => mine.has(l));
        return (
          <div key={`${m.category}-${m.start}`} className="ledger-entry p-3 rounded-xl flex flex-col gap-1">
            <p className="text-[12.5px] text-[var(--text-primary)] leading-snug">
              <strong>{m.logs.size} sentences</strong> refused {SECTORS[m.category]} within ten minutes,{' '}
              {m.count} times between them.
            </p>
            <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
              {ago} ago{yours && <span className="text-[var(--verdigris)]"> · yours was one</span>}
            </p>
          </div>
        );
      })}
    </section>
  );
};
