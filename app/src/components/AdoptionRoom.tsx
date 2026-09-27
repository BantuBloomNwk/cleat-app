import React, { useEffect, useMemo, useState } from 'react';
import { loadPublishedMandates, type PublishedMandate } from '../lib/chain';
import { AgentAvatar } from './AgentAvatar';
import { DataOrigin } from './DataOrigin';
import { tactile } from '../utils/haptics';

/**
 * Who runs whose sentence.
 *
 * This was a copier room with 1,420 copiers, a chat, likes and a Sync button,
 * and none of it was read from anywhere. The real version of copying already
 * exists on chain: adopting a sentence writes a new mandate that points at
 * its parent, and the parent's adoption count goes up. So every row here is
 * an account the program wrote. There is no chat, because there is nowhere
 * for one to live that is not a server we would have to moderate.
 */

type Event = {
  key: string;
  kind: 'adopted' | 'wrote' | 'rewrote';
  at: number;
  who: string;
  from: string | null;
  mandate: PublishedMandate;
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const BADGE: Record<Event['kind'], string> = {
  adopted: 'Adopted',
  wrote: 'New sentence',
  rewrote: 'Rewrote',
};

export const AdoptionRoom: React.FC<{ onOpenSentences: () => void }> = ({ onOpenSentences }) => {
  const [rows, setRows] = useState<PublishedMandate[] | null>(null);

  useEffect(() => {
    let live = true;
    loadPublishedMandates({ distinct: false }).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, []);

  const { events, adoptions, sentences } = useMemo(() => {
    const all = rows ?? [];
    const ownerOf = new Map(all.map((m) => [m.address, m.owner]));
    const ev: Event[] = [];
    for (const m of all) {
      if (m.createdAt > 0) {
        ev.push({
          key: `${m.address}-c`,
          kind: m.adoptedFrom ? 'adopted' : 'wrote',
          at: m.createdAt,
          who: m.owner,
          from: m.adoptedFrom ? ownerOf.get(m.adoptedFrom) ?? m.adoptedFrom : null,
          mandate: m,
        });
      }
      if (m.version > 1 && m.updatedAt > m.createdAt) {
        ev.push({ key: `${m.address}-u`, kind: 'rewrote', at: m.updatedAt, who: m.owner, from: null, mandate: m });
      }
    }
    ev.sort((a, b) => b.at - a.at);
    return {
      events: ev.slice(0, 12),
      adoptions: all.filter((m) => m.adoptedFrom).length,
      sentences: new Set(all.map((m) => m.text)).size,
    };
  }, [rows]);

  return (
    <div className="social-stream-card" id="adoption-room">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-1 border-b border-[var(--card-border-subtle)]">
        <h3 className="font-sans font-bold text-[14px] text-[var(--text-primary)] whitespace-nowrap">
          Who runs whose sentence
        </h3>
        <span className="flex items-center gap-2 shrink-0">
          <DataOrigin origin="chain" />
          {rows && (
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] whitespace-nowrap">
              {adoptions} adopted · {sentences} sentences
            </span>
          )}
        </span>
      </div>

      <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
        Taking somebody's sentence writes a new mandate under your own key that
        points back at theirs. You get their limits and your own vault. Nobody
        gets your positions, including them.
      </p>

      <div className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto pr-0.5">
        {rows === null && (
          <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">Reading the program…</p>
        )}
        {rows !== null && events.length === 0 && (
          <p className="text-[11.5px] text-[var(--text-tertiary)]">
            Nothing to show. Either nobody has written a sentence yet or the read failed.
          </p>
        )}
        {events.map((e) => (
          <div key={e.key} className="social-msg-item">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AgentAvatar seed={e.who} size={26} />
                <span className="font-mono font-bold text-[12px] text-[var(--text-primary)]">{short(e.who)}</span>
                <span className="text-[9.5px] font-sans font-semibold px-2 py-0.5 rounded-full bg-[var(--card-surface)] text-[var(--text-tertiary)] border border-[var(--card-border-subtle)] whitespace-nowrap">
                  {BADGE[e.kind]}
                </span>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-tertiary)] shrink-0">{ago(e.at)}</span>
            </div>

            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed font-sans pl-8">
              {e.kind === 'adopted' && e.from && <>Took {short(e.from)}'s sentence: </>}
              {e.kind === 'rewrote' && <>Now at version {e.mandate.version}: </>}
              <span className="italic text-[var(--text-primary)]">“{e.mandate.text}”</span>
            </p>

            <div className="flex items-center justify-between gap-2 pl-8 pt-1 text-[11px] font-mono flex-wrap">
              <span className="text-[var(--text-tertiary)]">
                {pct(e.mandate.maxPositionBps)} a sector · {pct(e.mandate.maxTradeBps)} a trade
                {e.mandate.adoptCount > 0 && <> · adopted {e.mandate.adoptCount}×</>}
              </span>
              <span className="flex items-center gap-3">
                <a
                  href={`https://explorer.solana.com/address/${e.mandate.address}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[var(--verdigris)] underline underline-offset-2"
                >
                  on chain
                </a>
                <button
                  type="button"
                  className="text-[var(--ember)] font-bold hover:underline"
                  onClick={() => { tactile.selectionTap(); onOpenSentences(); }}
                >
                  Take it
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
