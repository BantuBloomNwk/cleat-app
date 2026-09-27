import React, { useCallback, useEffect, useState } from 'react';
import type { PublicKey } from '@solana/web3.js';
import { connection } from '../lib/chain';
import { LOOP_AGENT, LOOP_DEMO_OWNER, grantLoop, revokeLoop, vaultPda } from '../lib/adopt';
import { tactile } from '../utils/haptics';
import type { useWallet } from '../hooks/useWallet';

type Wallet = ReturnType<typeof useWallet>;

interface Row { ticker: string; name: string; sector: string; bookBps: number; avgPrice: number; price: number | null; pnl: number; pnlPct: number }
interface BookView {
  demo: boolean;
  published?: boolean;
  token?: string;
  marked: { rows: Row[]; cash: number; value: number; unrealized: number; realized: number; total: number; pnl: number; pnlPct: number };
  moves: Record<string, number>;
  sources?: Record<string, string>;
  prices: Record<string, number>;
  activity: { at: number; line: string; signature?: string }[];
  fills: { at: number; ticker: string; side: 0 | 1; askedBps: number; allowedBps: number; price: number; outcome: number; reason: number; signature: string }[];
  lastTickAt: number | null;
  watching: { ticker: string; name: string; sector: string }[];
}

// Rounded before the sign is read, so a float that is a hair below zero
// does not print as a loss of nothing.
const cents = (n: number) => Math.round(n * 100) / 100 || 0;
const money = (n: number) => { const c = cents(n); return `${c < 0 ? '-' : ''}$${Math.abs(c).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const signed = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const message = (owner: string, index: number, ts: number) =>
  `Cleat: show me my paper book. ${owner} sleeve ${index} at ${ts}. This signature moves nothing.`;
const tokenKey = (owner: string, index: number) => `cleat_book_token_${owner}_${index}`;

/**
 * The agent running on its own, and what it has done with a paper book.
 *
 * Every proposal it makes is real and decided on chain by the owner's
 * sentence. The fills are not: a cleared proposal is filled on paper at the
 * live Pyth price, or Backpack's when Pyth is quiet. The panel says so at the top rather than in a footnote.
 */
export const AgentLoop: React.FC<{ wallet: Wallet }> = ({ wallet }) => {
  const signer = wallet.signer;
  const owner: PublicKey = signer?.publicKey ?? LOOP_DEMO_OWNER;
  const index = signer ? wallet.sleeve : 0;
  const ownerB58 = owner.toBase58();
  const [book, setBook] = useState<BookView | null>(null);
  const [locked, setLocked] = useState(false);
  const [grant, setGrant] = useState<{ vault: boolean; live: boolean; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const readGrant = useCallback(async (): Promise<boolean | undefined> => {
    const v = await connection.getAccountInfo(vaultPda(owner, index));
    if (!v) { setGrant({ vault: false, live: false, expiresAt: 0 }); return false; }
    const d = v.data;
    const agent = d.subarray(74, 106);
    const mine = LOOP_AGENT.toBytes().every((b, i) => b === agent[i]);
    const exp = Number(new DataView(d.buffer, d.byteOffset).getBigInt64(106, true));
    const live = mine && exp > Date.now() / 1000;
    setGrant({ vault: true, live, expiresAt: mine ? exp : 0 });
    return live;
  }, [ownerB58, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    let token = '';
    try { token = sessionStorage.getItem(tokenKey(ownerB58, index)) ?? ''; } catch { /* per session only */ }
    const res = await fetch(`/api/agent-book?owner=${ownerB58}&index=${index}&token=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    const body = await res.json();
    if (body.locked) { setLocked(true); setBook(null); return; }
    setLocked(false);
    setBook(body);
  }, [ownerB58, index]);

  useEffect(() => { void load(); void readGrant(); }, [load, readGrant]);

  const unlock = async () => {
    if (!signer) return;
    setBusy('unlock');
    setNote(null);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await signer.signMessage(new TextEncoder().encode(message(ownerB58, index, ts)));
      const res = await fetch('/api/agent-book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: ownerB58, index, ts, signature: btoa(String.fromCharCode(...sig)) }),
      });
      const body = await res.json();
      if (!res.ok) { setNote(body.error ?? 'That did not open.'); return; }
      try { sessionStorage.setItem(tokenKey(ownerB58, index), body.token); } catch { /* sign again next time */ }
      setLocked(false);
      setBook(body);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async () => {
    if (!signer || !grant) return;
    tactile.mandateAction();
    setBusy('grant');
    setNote(null);
    try {
      if (!(await signer.confirm())) { setNote('That was not confirmed, so nothing changed.'); return; }
      const want = !grant.live;
      if (want) await grantLoop(signer, index, 7);
      else await revokeLoop(signer, index);
      // The relay answers on send, so wait for the chain to show it.
      for (let i = 0; i < 20 && (await readGrant()) !== want; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      setNote(grant.live ? 'Stopped. The agent has no authority over this sleeve now.' : 'Running. It looks every ten minutes and asks when a price moves.');
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
      void readGrant();
    }
  };

  const m = book?.marked;
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [allTape, setAllTape] = useState(false);
  const lineFor = (sig: string) => book?.activity.find((a) => a.signature === sig)?.line;
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const STATUS = ['FILLED', 'PARTIAL', 'REJECTED'];
  const TONE = ['var(--verdigris)', 'var(--trimmed-amber)', 'var(--refused-rust)'];
  const maxBps = Math.max(1, ...(m?.rows.map((r) => r.bookBps) ?? [1]));
  const tape = (book?.fills ?? []).slice(0, allTape ? 20 : 6);

  return (
    <div className="vault-key ob" id="agent-loop">
      {/* One line of who and whether, and the honesty chip. */}
      <div className="ob-head">
        <span className="ob-title">{signer ? 'Your agent' : 'Demo agent'}</span>
        <span className={`ob-state${grant?.live ? ' on' : ''}`}>
          {grant?.live ? `running · until ${new Date(grant.expiresAt * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'not running'}
        </span>
        <span className="ob-chip" title="Every proposal is real and decided on chain by the sentence. Fills are on paper at live Pyth prices, or Backpack's when Pyth is quiet, against a 10,000 dollar book. Nothing is bought.">
          paper fills
        </span>
      </div>

      {signer && grant && (grant.vault ? (
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!!busy} aria-pressed={grant.live} onClick={toggle}>
            {busy === 'grant' ? 'Sending…' : grant.live ? 'Stop it running' : 'Let it run for 7 days'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--text-tertiary)]">Write a sentence first. The agent needs a vault to answer to.</p>
      ))}

      {locked && signer && (
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!!busy} onClick={unlock}>
            {busy === 'unlock' ? 'Waiting for your signature…' : 'Show my paper book'}
          </button>
        </div>
      )}

      {m && (
        <>
          {/* Opt in, per sentence, and withdrawable. A record is shown next
              to the sentence as simulated and never ranked. */}
          {signer && !book!.demo && (
            <div className="vault-buttons">
              <button
                type="button"
                className="mesh-chip"
                disabled={!!busy}
                aria-pressed={!!book!.published}
                onClick={async () => {
                  setBusy('publish');
                  try {
                    let token = '';
                    try { token = sessionStorage.getItem(tokenKey(ownerB58, index)) ?? ''; } catch { /* sign again */ }
                    const res = await fetch('/api/agent-book', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ owner: ownerB58, index, token, publish: !book!.published }),
                    });
                    const body = await res.json();
                    if (!res.ok) setNote(body.error ?? 'That did not save.');
                    else { setBook({ ...book!, published: body.published }); setNote(body.published ? 'Your paper record now shows on your sentence, marked simulated.' : 'Your paper record is private again.'); }
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === 'publish' ? 'Saving…' : book!.published ? 'Showing on my sentence' : 'Show this record on my sentence'}
              </button>
            </div>
          )}

          {/* Equity strip, the way every trading screen opens. */}
          <div className="ob-strip">
            <div><span>Equity</span><b>{money(m.total)}</b></div>
            <div><span>P&amp;L</span><b style={{ color: cents(m.pnl) >= 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}>{signed(m.pnlPct)}%</b></div>
            <div><span>Cash</span><b>{money(m.cash)}</b></div>
          </div>

          {/* Positions, dense and right aligned, with a bar for share of book. */}
          <div className="ob-table" role="table" aria-label="Positions">
            <div className="ob-row ob-th" role="row">
              <span>Name</span><span>Book</span><span>Avg</span><span>Mark</span><span>P&amp;L</span>
            </div>
            {m.rows.length === 0 && <div className="ob-empty">No positions.</div>}
            {m.rows.map((r) => (
              <div key={r.ticker} className="ob-row" role="row">
                <span className="ob-bar" style={{ width: `${(r.bookBps / maxBps) * 100}%` }} aria-hidden="true" />
                <span className="ob-name">{r.ticker}<i>{r.sector}</i></span>
                <span>{(r.bookBps / 100).toFixed(0)}%</span>
                <span>{r.avgPrice.toFixed(2)}</span>
                <span>{r.price !== null ? r.price.toFixed(2) : '–'}</span>
                <span style={{ color: cents(r.pnl) >= 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}>{money(r.pnl)}</span>
              </div>
            ))}
          </div>

          {/* The tape: one row per decision, newest first. Tap for why. */}
          <div className="ob-sub">
            <span>Tape</span>
            <span>
              {book!.watching.map((w) => `${w.ticker} ${book!.moves[w.ticker] !== undefined ? `${signed(book!.moves[w.ticker] / 100)}%` : '–'}`).join(' · ')}
              {(() => { const src = [...new Set(Object.values(book!.sources ?? {}))]; return src.length ? ` · via ${src.join(' + ')}` : ''; })()}
              {book!.lastTickAt ? ` · looked ${ago(book!.lastTickAt)}` : ''}
            </span>
          </div>
          <div className="ob-table" role="table" aria-label="Decisions">
            {tape.length === 0 && (
              <div className="ob-empty">Nothing yet. It asks only when a price moves, and US equities do not move at weekends.</div>
            )}
            {tape.map((f, i) => (
              <React.Fragment key={f.signature}>
                <button type="button" className="ob-row ob-tape" onClick={() => setOpenRow(openRow === i ? null : i)} aria-expanded={openRow === i}>
                  <span className="ob-time">{clock(f.at)}</span>
                  <span style={{ color: f.side === 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}>{f.side === 0 ? 'BUY' : 'SELL'}</span>
                  <span className="ob-name">{f.ticker}</span>
                  <span>{(f.allowedBps / 100).toFixed(0)}/{(f.askedBps / 100).toFixed(0)}%</span>
                  <span>{f.allowedBps > 0 && f.price > 0 ? f.price.toFixed(2) : '–'}</span>
                  <span className="ob-status" style={{ color: TONE[f.outcome], borderColor: TONE[f.outcome] }}>{STATUS[f.outcome]}</span>
                </button>
                {openRow === i && (
                  <p className="ob-why">
                    {lineFor(f.signature) ?? ''}{' '}
                    <a href={`https://explorer.solana.com/tx/${f.signature}?cluster=devnet`} target="_blank" rel="noreferrer noopener">on chain</a>
                  </p>
                )}
              </React.Fragment>
            ))}
          </div>
          {(book!.fills.length > 6) && (
            <button type="button" className="ob-more" onClick={() => setAllTape(!allTape)}>
              {allTape ? 'less' : `all ${Math.min(20, book!.fills.length)}`}
            </button>
          )}
        </>
      )}

      {note && <p className="text-[11.5px] text-[var(--text-secondary)]" role="status">{note}</p>}
    </div>
  );
};
