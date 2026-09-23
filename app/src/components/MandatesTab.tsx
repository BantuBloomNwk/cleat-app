import React, { useEffect, useMemo, useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { Download, Check, FileDown, ShieldCheck } from 'lucide-react';
import { CommunityMandate } from '../types';
import type { Mandate, SectorExposure } from '../lib/chain';
import { identifyMints, issuerLabel, type IdentifiedMint } from '../lib/sunrise';
import { PublicKey } from '@solana/web3.js';
import {
  loadPublishedMandates, loadStandings, MIN_DECISIONS_TO_RANK, PROGRAM_ID,
  type PublishedMandate, type StandingRow,
} from '../lib/chain';
import { tactile } from '../utils/haptics';
import { adoptMandate } from '../lib/adopt';
import { confirmPresence } from '../lib/passkey';
import type { Keypair } from '@solana/web3.js';

interface MandatesTabProps {
  mandates: CommunityMandate[];
  onAdoptMandate: (sentence: string) => void;
  /** Sectors with something cleared into them, read off the devnet log. */
  exposure: SectorExposure[];
  /** The mandate that log answers to, or null before the read lands. */
  chainMandate: Mandate | null;
  /** The person's own key, once the passkey has been unlocked. */
  keypair: Keypair | null;
  /** Which of that key's sleeves the adopted sentence lands in. */
  sleeve: number;
  onNeedWallet: () => void;
}

export const MandatesTab: React.FC<MandatesTabProps> = ({
  mandates,
  onAdoptMandate,
  exposure,
  chainMandate,
  keypair,
  sleeve,
  onNeedWallet,
}) => {
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const [denied, setDenied] = useState<IdentifiedMint[]>([]);
  // Every mandate anybody has published, read off the program. Empty until
  // the scan lands, and it stays empty rather than inventing anyone.
  const [published, setPublished] = useState<PublishedMandate[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);

  /* Taking a sentence on chain. One at a time, and the result stays on the
     row it came from rather than in a toast that vanishes before it is read. */
  const [takingId, setTakingId] = useState<string | null>(null);
  const [taken, setTaken] = useState<Record<string, { url: string; sponsored: boolean } | string>>({});

  const takeOnChain = async (m: PublishedMandate) => {
    if (!keypair) { onNeedWallet(); return; }
    tactile.mandateAction();
    setTakingId(m.address);
    try {
      if (!(await confirmPresence())) {
        setTaken((t) => ({ ...t, [m.address]: 'That was not confirmed, so nothing was written.' }));
        return;
      }
      const r = await adoptMandate(keypair, new PublicKey(m.address), m.text, sleeve);
      setTaken((t) => ({ ...t, [m.address]: { url: r.explorer, sponsored: r.sponsored } }));
      onAdoptMandate(m.text);
      loadPublishedMandates().then(setPublished);
    } catch (e) {
      setTaken((t) => ({ ...t, [m.address]: (e as Error).message }));
    } finally {
      setTakingId(null);
    }
  };

  // The leaderboard and the sentence list are the same people, and they
  // were living in two places: a column of truncated addresses with a
  // percentage next to it, and a column of sentences with no outcome. Put
  // the outcome on the sentence and the table stops being the interesting
  // half.
  const heldBy = useMemo(() => {
    const m = new Map<string, { heldPct: number; decisions: number }>();
    for (const r of standings) m.set(r.owner, { heldPct: r.heldPct, decisions: r.decisions });
    return m;
  }, [standings]);

  useEffect(() => {
    let live = true;
    loadPublishedMandates().then((rows) => {
      if (live) setPublished(rows);
    });
    loadStandings().then((rows) => {
      if (live) setStandings(rows);
    });
    return () => {
      live = false;
    };
  }, []);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // The deny list, read back as companies rather than as addresses.
  const deniedKey = (chainMandate?.denied ?? []).join(',');
  useEffect(() => {
    if (!deniedKey) {
      setDenied([]);
      return;
    }
    let live = true;
    identifyMints(deniedKey.split(',')).then((rows) => {
      if (live) setDenied(rows);
    });
    return () => {
      live = false;
    };
  }, [deniedKey]);

  const handleAdopt = (mandate: CommunityMandate) => {
    tactile.mandateAction();
    setAdoptedId(mandate.id);
    onAdoptMandate(mandate.sentence);
    setTimeout(() => {
      setAdoptedId(null);
    }, 2000);
  };

  // Everything in this file is read off the program before it is written out.
  // An export that a judge cannot re-derive from devnet is worse than no
  // export, so nothing here is computed from the sample exchange rows.
  const handleExportHistory = () => {
    tactile.mandateAction();
    setIsExporting(true);

    try {
      const exportPayload = {
        source: 'Cleat, read from Solana devnet',
        cluster: 'devnet',
        programId: PROGRAM_ID.toBase58(),
        exportTimestampUtc: new Date().toISOString(),
        howToVerify:
          'Every field below came from one getProgramAccounts scan against the ' +
          'program id above, filtered on the Mandate and VerdictLog account ' +
          'discriminators. Re-run the same scan and you get the same rows.',
        publishedMandates: published.map((m) => ({
          address: m.address,
          owner: m.owner,
          sentence: m.text,
          version: m.version,
          halted: m.halted,
          maxPositionBps: m.maxPositionBps,
          maxTradeBps: m.maxTradeBps,
          maxSpreadBps: m.maxSpreadBps,
          deniedCount: m.deniedCount,
          adoptedFrom: m.adoptedFrom,
          adoptCount: m.adoptCount,
          createdAtUnix: m.createdAt,
          updatedAtUnix: m.updatedAt,
          heldDays: m.heldDays,
        })),
        standings: standings.map((r) => ({
          owner: r.owner,
          verdictLog: r.logAddress,
          decisions: r.decisions,
          askedBps: r.askedBps,
          allowedBps: r.allowedBps,
          heldBps: r.heldBps,
          heldPct: r.heldPct,
          cleared: r.cleared,
          clamped: r.clamped,
          refused: r.refused,
        })),
        notes: [
          `Standings list logs with at least ${MIN_DECISIONS_TO_RANK} decisions. Below that the ratio does not mean anything yet.`,
          'Holdings are not in this file because they are not in the computation. The log records what was asked for and what was allowed, never a position.',
        ],
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `cleat-devnet-mandates-${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const n = published.length;
      setExportNotice(n > 0 ? `${n} on-chain` : 'Nothing on chain yet');
      setTimeout(() => {
        setIsExporting(false);
        setExportNotice(null);
      }, 2500);
    } catch {
      setIsExporting(false);
      setExportNotice('Export failed');
      setTimeout(() => setExportNotice(null), 2000);
    }
  };

  return (
    <section className="tab-screen active flex flex-col gap-3.5 w-full pb-12" id="view-mandates">
      <div className="section-row-header flex-wrap gap-2">
        <div>
          <h2 className="section-heading text-[16px] font-bold">Mandate Exchange</h2>
          <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
            <span className="section-hint text-[11px]">Sentences, never positions</span>
          </span>
        </div>

        {/* Enforcer-Aesthetic Export History Button */}
        <button
          id="btn-export-mandate-history"
          type="button"
          onClick={handleExportHistory}
          disabled={isExporting}
          title="Download the mandates and verdict logs read off devnet"
          aria-label="Export on-chain mandates as JSON"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] hover:border-[var(--verdigris)] text-[11.5px] font-mono text-[var(--text-primary)] transition-all shadow-sm group active:scale-98"
        >
          {isExporting ? (
            <>
              <Check size={13} className="text-[var(--verdigris)] animate-bounce" />
              <span className="text-[var(--verdigris)] font-bold">
                {exportNotice || 'Exporting...'}
              </span>
            </>
          ) : (
            <>
              <FileDown size={13} className="text-[var(--text-secondary)] group-hover:text-[var(--verdigris)] transition-colors" />
              <span>Export History</span>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[var(--card-surface)] border border-[var(--card-border-subtle)] text-[var(--text-tertiary)] font-bold">
                JSON
              </span>
            </>
          )}
        </button>
      </div>

      {exposure.length > 0 && (
        <article className="glass-card" id="sector-standing">
          <div className="card-topbar">
            <span className="meta-kicker">Where the book stands</span>
            <DataOrigin origin="chain" />
          </div>
          <p className="text-[11.5px] leading-[1.5] text-[var(--text-secondary)] mb-3">
            What has been cleared into each sector, against the ceiling the
            sentence sets. This is the running total that makes a position cap a
            position cap. It counts decisions, never holdings.
          </p>
          <div className="flex flex-col gap-2.5">
            {exposure.map((e) => {
              const full = e.capBps > 0 && e.bps >= e.capBps;
              const width = e.capBps > 0
                ? Math.min(100, (e.bps / e.capBps) * 100)
                : 0;
              return (
                <div key={e.sector} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-medium text-[var(--text-primary)]">
                      {e.sector}
                    </span>
                    <span
                      className="text-[11px] font-mono tabular-nums"
                      style={{
                        color: full
                          ? 'var(--refused-rust)'
                          : 'var(--text-secondary)',
                      }}
                    >
                      {(e.bps / 100).toFixed(2)}% of {(e.capBps / 100).toFixed(2)}%
                    </span>
                  </div>
                  <div
                    className="h-[5px] rounded-full overflow-hidden bg-[var(--card-surface)] border border-[var(--card-border-subtle)]"
                    role="meter"
                    aria-valuenow={e.bps}
                    aria-valuemin={0}
                    aria-valuemax={e.capBps}
                    aria-label={`${e.sector} exposure`}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${width}%`,
                        background: full
                          ? 'var(--refused-rust)'
                          : 'var(--verdigris)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {chainMandate && chainMandate.denied.length > 0 && (
            <div className="mt-3.5 pt-3 border-t border-[var(--card-border-subtle)]">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Ruled out by name
              </span>
              <p className="text-[11px] leading-[1.6] text-[var(--text-secondary)] mt-1">
                The sentence says no fossil fuels. A program cannot read that, so
                the clause resolves off chain into {chainMandate.denied.length}{' '}
                mints and the list is what gets enforced. It has to name every
                issuer that has wrapped the company, because an agent refused at
                one address can route to another without breaking a rule.
              </p>
              <div className="flex flex-col gap-1.5 mt-2">
                {chainMandate.denied.map((mint) => {
                  const known = denied.find((d) => d.mint === mint);
                  return (
                    <div key={mint} className="flex flex-col gap-0.5">
                      {known?.name && (
                        <span className="text-[11px] text-[var(--text-primary)]">
                          {known.name}
                          <span className="text-[var(--text-tertiary)]">
                            {' '}
                            via {issuerLabel(known.issuer)}
                            {known.symbol ? `, ${known.symbol}` : ''}
                          </span>
                        </span>
                      )}
                      <code className="text-[10px] font-mono text-[var(--text-tertiary)] break-all">
                        {mint}
                      </code>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {chainMandate?.halted && (
            <p className="mt-3 text-[11.5px] font-medium text-[var(--text-primary)]">
              This mandate is halted. Nothing proposes until the owner lifts it.
            </p>
          )}
        </article>
      )}

      {standings.length > 0 && (
        <section className="flex flex-col gap-2.5" id="published-mandates">
          <div className="section-row-header">
            <h3 className="section-heading text-[16px] font-bold">
              Published on chain
            </h3>
            <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
              <span className="section-hint text-[11px]">
                {published.length} mandate{published.length === 1 ? '' : 's'}
              </span>
              <DataOrigin origin="chain" />
            </span>
          </div>

          <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
            Every one of these lives at an address derived from its author's own
            key, so nobody can publish somebody else's sentence. That is the
            whole of the identity system, and it needs no profile, no handle and
            no domain. A name, when there is one, is a label on top of a proof
            that already holds without it.
          </p>

          {published.map((m) => (
            <article key={m.address} className="glass-card flex flex-col gap-2">
              <div className="card-topbar">
                <span className="meta-kicker font-mono text-[10.5px]">
                  {m.owner.slice(0, 4)}…{m.owner.slice(-4)}
                </span>
                <span className="flex items-center gap-2 flex-wrap">
                  {m.halted && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--refused-rust)] font-bold">
                      halted
                    </span>
                  )}
                  <span className="text-[10.5px] font-mono text-[var(--text-tertiary)]">
                    v{m.version}
                  </span>
                </span>
              </div>

              <p className="text-[13px] leading-[1.6] text-[var(--text-primary)] italic">
                “{m.text}”
              </p>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>
                  <strong className="text-[var(--text-primary)]">
                    {(m.maxPositionBps / 100).toFixed(0)}%
                  </strong>{' '}
                  a sector
                </span>
                <span>
                  <strong className="text-[var(--text-primary)]">
                    {(m.maxTradeBps / 100).toFixed(0)}%
                  </strong>{' '}
                  a trade
                </span>
                {m.maxSpreadBps > 0 && (
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {(m.maxSpreadBps / 100).toFixed(2)}%
                    </strong>{' '}
                    widest book
                  </span>
                )}
                {m.deniedCount > 0 && (
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {m.deniedCount}
                    </strong>{' '}
                    ruled out by name
                  </span>
                )}
              </div>

              {(() => {
                const done = taken[m.address];
                const busy = takingId === m.address;
                const mine = keypair?.publicKey.toBase58() === m.owner;
                if (typeof done === 'object') {
                  return (
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Taken. It is your sentence now, on a child account under
                      your own key.{' '}
                      {done.sponsored && 'Devnet rent was covered for the demo. '}
                      <a
                        href={done.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[var(--verdigris)] underline underline-offset-2"
                      >
                        check the transaction
                      </a>
                    </p>
                  );
                }
                return (
                  <>
                    <button
                      type="button"
                      className="btn-inject"
                      disabled={busy || mine}
                      onClick={() => takeOnChain(m)}
                      title={mine ? 'This one is already yours' : 'Write this sentence to your own account'}
                    >
                      {busy ? 'Signing…' : mine ? 'Yours' : 'Take this sentence'}
                    </button>
                    {typeof done === 'string' && (
                      <p className="text-[11px] text-[var(--refused-rust)]">{done}</p>
                    )}
                  </>
                );
              })()}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono text-[var(--text-tertiary)]">
                {(() => {
                  // What this sentence did, next to what it says. A
                  // sentence with nothing behind it yet says so rather
                  // than showing a zero, because untested and disciplined
                  // are different things.
                  const h = heldBy.get(m.owner);
                  return h && h.decisions > 0 ? (
                    <span className="text-[var(--verdigris)]">
                      held back {Math.round(h.heldPct)}% of {h.decisions}
                    </span>
                  ) : (
                    <span>nothing asked of it yet</span>
                  );
                })()}
                <span>unchanged {m.heldDays}d</span>
                <span>{m.adoptCount} adopted</span>
                {m.adoptedFrom && <span>forked</span>}
                <a
                  href={`https://explorer.solana.com/address/${m.address}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[var(--verdigris)] underline underline-offset-2"
                >
                  read it on chain
                </a>
              </div>
            </article>
          ))}
        </section>
      )}

      {published.length > 0 && (
        <section className="flex flex-col gap-2.5" id="standings">
          <div className="section-row-header">
            <h3 className="section-heading text-[16px] font-bold">
              Who held the most back
            </h3>
            <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
              <span className="section-hint text-[11px]">Not ranked on adoptions</span>
              <DataOrigin origin="chain" />
            </span>
          </div>

          {/* Where you are in it, before the table.
              A leaderboard you are not on is somebody else's scoreboard.
              This is also the one number in the product that can move on a
              day the market does nothing, which is the whole problem with
              a log you read once. */}
          {(() => {
            const me = keypair?.publicKey.toBase58();
            if (!me) return null;
            const at = standings.findIndex((r) => r.owner === me);
            if (at < 0) {
              return (
                <p className="text-[12px] text-[var(--text-secondary)]">
                  You are not ranked yet. It takes {MIN_DECISIONS_TO_RANK} decisions,
                  and they have to be real ones.
                </p>
              );
            }
            const me_ = standings[at];
            const above = at > 0 ? standings[at - 1] : null;
            return (
              <p className="text-[13px] text-[var(--text-primary)]">
                You are <strong>#{at + 1} of {standings.length}</strong>, holding back{' '}
                <strong>{Math.round(me_.heldPct)}%</strong> of {me_.decisions} decisions.
                {above && (
                  <span className="text-[var(--text-secondary)]">
                    {' '}#{at} is {Math.round(above.heldPct - me_.heldPct)} points ahead.
                  </span>
                )}
              </p>
            );
          })()}

          <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
            Ranked by the share of everything asked for that the sentence
            refused or trimmed. Adoptions would be the obvious number and it is
            the gameable one: a point of it costs one funded wallet. A point of
            this costs a real proposal that really got refused, which is the
            thing being measured rather than a way around it. Not Sybil proof,
            and saying so is cheaper than pretending.
          </p>

          <div className="flex flex-col gap-1.5">
            {standings.slice(0, 8).map((row, i) => {
              const ranked = row.decisions >= MIN_DECISIONS_TO_RANK;
              return (
                <div
                  key={row.logAddress}
                  className="flex items-baseline justify-between gap-3 px-2.5 py-2 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]"
                >
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)] w-4 shrink-0">
                      {ranked ? i + 1 : '—'}
                    </span>
                    <span className="font-mono text-[11.5px] text-[var(--text-primary)] truncate">
                      {row.owner.slice(0, 4)}…{row.owner.slice(-4)}
                    </span>
                    <span className="text-[10.5px] font-mono text-[var(--text-tertiary)] whitespace-nowrap">
                      {row.decisions} decision{row.decisions === 1 ? '' : 's'}
                      {ranked ? '' : ', too few to rank'}
                    </span>
                  </span>
                  <span
                    className="font-mono text-[12.5px] font-bold tabular-nums shrink-0"
                    style={{
                      color: ranked ? 'var(--verdigris)' : 'var(--text-tertiary)',
                    }}
                  >
                    {row.heldPct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="section-row-header">
        <h3 className="section-heading text-[16px] font-bold">
          What this looks like with people on it
        </h3>
        <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
          <span className="section-hint text-[11px]">Written, not read</span>
          <DataOrigin origin="sample" />
        </span>
      </div>

      <div className="flex flex-col gap-3.5">
        {mandates.map((m) => {
          const initials = m.author
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase();
          const isAdopted = adoptedId === m.id;

          return (
            <article key={m.id} className="glass-card" id={`community-mandate-${m.id}`}>
              <div className="card-topbar">
                <div className="flex items-center gap-2">
                  <div className="w-[30px] h-[30px] rounded-full bg-[var(--verdigris-chip-bg)] text-[var(--verdigris)] flex items-center justify-center text-[11px] font-bold font-mono">
                    {initials}
                  </div>
                  <div>
                    <div className="font-bold text-[13.5px] text-[var(--text-primary)]">
                      {m.handle}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
                      {m.origin}
                    </div>
                  </div>
                </div>
                <span className={`pill-status ${m.statusChip.type}`}>
                  {m.statusChip.label}
                </span>
              </div>

              <blockquote className="mandate-quote text-[16.5px] my-2.5">
                “{m.sentence}”
              </blockquote>

              <div className="mandate-metadata-row font-sans mb-3 text-[11px] text-[var(--text-secondary)] flex items-center flex-wrap gap-x-2 gap-y-1">
                <span className="font-sans whitespace-nowrap">
                  Held for <strong className="font-sans text-[var(--text-primary)] font-bold">{m.heldDays} consecutive days</strong>
                </span>
                <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[var(--text-tertiary)]">•</span>
                  <span>Version <strong className="font-sans text-[var(--text-primary)] font-bold">{m.version}</strong></span>
                </span>
                <span className="font-sans inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[var(--text-tertiary)]">•</span>
                  <span><strong className="font-sans text-[var(--text-primary)] font-bold">{m.peopleRunning.toLocaleString()}</strong> running</span>
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                  {m.activeEnforcers.toLocaleString()} active enforcers
                </span>
                <button
                  id={`btn-adopt-${m.id}`}
                  type="button"
                  className="btn-ember"
                  onClick={() => handleAdopt(m)}
                >
                  {isAdopted ? 'Sentence Adopted ✓' : 'Adopt Sentence'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
