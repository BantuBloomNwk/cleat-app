import React, { useEffect, useMemo, useState } from 'react';
import { SECTORS, connection, loadAllVerdicts, mandateOfLog, reasonText, type PlacedVerdict, type PublishedMandate } from '../lib/chain';
import { useFollowing } from '../lib/following';
import { shareReceipt } from '../lib/receipt';
import { tactile } from '../utils/haptics';
import { DataOrigin } from './DataOrigin';

const WORD = ['Cleared', 'Trimmed', 'Refused'];
const COLOR = ['var(--verdigris)', 'var(--trimmed-amber)', 'var(--refused-rust)'];
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/**
 * What the sentences you follow have decided lately.
 *
 * Every row is a public decision read off chain: which way it went, the
 * sector, the share of the book and the rule. Never a company or an amount.
 * Nothing here is a post anybody wrote, which is why it needs no moderation.
 */
export const FollowingFeed: React.FC<{ published: PublishedMandate[] }> = ({ published }) => {
  const following = useFollowing();
  const [verdicts, setVerdicts] = useState<PlacedVerdict[] | null>(null);
  const [nowSlot, setNowSlot] = useState<bigint>(0n);

  useEffect(() => {
    if (following.size === 0) return;
    let live = true;
    Promise.all([loadAllVerdicts(), connection.getSlot().catch(() => 0)]).then(([v, slot]) => {
      if (!live) return;
      setVerdicts(v);
      // Ages against the chain's clock now, not against the newest decision,
      // which made the latest one always read a minute old.
      setNowSlot(BigInt(slot || 0) || v.reduce((a, x) => (x.slot > a ? x.slot : a), 0n));
    });
    return () => { live = false; };
  }, [following.size]);

  const byAddress = useMemo(() => new Map(published.map((m) => [m.address, m])), [published]);

  const rows = useMemo(() => {
    if (!verdicts) return [];
    return verdicts
      .map((v) => ({ v, mandate: mandateOfLog(v.owner, v.logAddress) }))
      .filter((x): x is { v: PlacedVerdict; mandate: string } => !!x.mandate && following.has(x.mandate))
      .sort((a, b) => Number(b.v.slot - a.v.slot))
      .slice(0, 8);
  }, [verdicts, following]);

  if (following.size === 0) return null;

  return (
    <section className="flex flex-col gap-2.5" id="following">
      <div className="section-row-header">
        <h3 className="section-heading text-[16px] font-bold">Following</h3>
        <span className="flex items-center gap-2">
          <span className="section-hint text-[11px]">{following.size} sentence{following.size === 1 ? '' : 's'}</span>
          <DataOrigin origin="chain" />
        </span>
      </div>
      {verdicts === null && <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">Reading their logs…</p>}
      {verdicts !== null && rows.length === 0 && (
        <p className="text-[11.5px] text-[var(--text-tertiary)]">Nothing decided on these yet. When one of them says yes or no, it shows here.</p>
      )}
      {rows.map(({ v, mandate }) => {
        const m = byAddress.get(mandate);
        const agoS = nowSlot > 0n ? Number(nowSlot - v.slot) * 0.4 : 0;
        const ago = agoS < 3600 ? `${Math.max(1, Math.round(agoS / 60))}m` : agoS < 86400 ? `${Math.round(agoS / 3600)}h` : `${Math.round(agoS / 86400)}d`;
        const why = reasonText(v.reason).replace(/^Triggered boundary: /, '');
        return (
          <div key={`${v.logAddress}-${v.slot}`} className="ledger-entry flex flex-col gap-1 p-3 rounded-xl">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span style={{ color: COLOR[v.outcome] }} className="font-bold">{WORD[v.outcome]}</span>
              <span className="text-[var(--text-tertiary)]">{ago} ago</span>
            </div>
            {m && <p className="font-mandate italic text-[13px] text-[var(--text-primary)] leading-snug">“{m.text}”</p>}
            <p className="text-[11.5px] text-[var(--text-secondary)]">
              {pct(v.proposedBps)} into {SECTORS[v.category] ?? 'a sector'}
              {v.outcome === 1 ? `, cut to ${pct(v.allowedBps)}` : ''}
              {v.outcome !== 0 ? `. ${why[0].toUpperCase()}${why.slice(1)}.` : '. Inside every line.'}
            </p>
            {m && v.outcome !== 0 && (
              <button
                type="button"
                className="self-start text-[11px] font-mono text-[var(--verdigris)] underline underline-offset-2"
                onClick={() => {
                  tactile.selectionTap();
                  void shareReceipt({
                    sentence: m.text, mandate, outcome: v.outcome, reason: v.reason, category: v.category,
                    proposedBps: v.proposedBps, allowedBps: v.allowedBps,
                    when: new Date(Date.now() - agoS * 1000),
                    theirs: true,
                  });
                }}
              >
                share this refusal
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
};
