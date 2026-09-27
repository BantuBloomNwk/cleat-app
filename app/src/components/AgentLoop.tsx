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
  token?: string;
  marked: { rows: Row[]; cash: number; value: number; unrealized: number; realized: number; total: number; pnl: number; pnlPct: number };
  moves: Record<string, number>;
  prices: Record<string, number>;
  activity: { at: number; line: string; signature?: string }[];
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
 * live Pyth price. The panel says so at the top rather than in a footnote.
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

  return (
    <div className="vault-key" id="agent-loop">
      <div className="vault-key-row">
        <span className="vault-key-label">{signer ? 'Your agent, on its own' : 'The demo agent, on its own'}</span>
        <span className="vault-key-balance">
          {grant?.live ? `running, until ${new Date(grant.expiresAt * 1000).toLocaleDateString()}` : signer ? 'not running' : ''}
        </span>
      </div>

      <p className="text-[11.5px] leading-[1.6] text-[var(--trimmed-amber)]">
        Simulated. Every proposal is real and decided on chain by the sentence. The fills are on paper,
        at live Pyth prices, against a 10,000 dollar book. Nothing is bought.
      </p>

      {signer && grant && (
        grant.vault ? (
          <div className="vault-buttons">
            <button type="button" className="mesh-chip" disabled={!!busy} aria-pressed={grant.live} onClick={toggle}>
              {busy === 'grant' ? 'Sending…' : grant.live ? 'Stop it running' : 'Let it run for 7 days'}
            </button>
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--text-tertiary)]">Write a sentence first. The agent needs a vault to answer to.</p>
        )
      )}

      {locked && signer && (
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!!busy} onClick={unlock}>
            {busy === 'unlock' ? 'Waiting for your signature…' : 'Show my paper book'}
          </button>
        </div>
      )}

      {m && (
        <>
          <div className="vault-key-row">
            <span className="vault-key-label">Book</span>
            <span className="vault-key-balance">
              {money(m.total)}{' '}
              <span style={{ color: cents(m.pnl) >= 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}>
                {signed(m.pnlPct)}%
              </span>
            </span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
            cash {money(m.cash)} · open {money(m.unrealized)} · locked in {money(m.realized)}
          </p>

          {m.rows.length > 0 && (
            <div className="flex flex-col gap-1">
              {m.rows.map((r) => (
                <div key={r.ticker} className="flex items-center justify-between text-[12px] font-mono">
                  <span className="text-[var(--text-primary)]">{r.ticker} <span className="text-[var(--text-tertiary)]">{(r.bookBps / 100).toFixed(0)}% · {r.sector}</span></span>
                  <span style={{ color: cents(r.pnl) >= 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}>{money(r.pnl)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
            watching {book!.watching.map((w) => `${w.ticker} ${book!.moves[w.ticker] !== undefined ? `${signed(book!.moves[w.ticker] / 100)}%` : 'no price'}`).join(' · ')}
            {book!.lastTickAt ? ` · last looked ${ago(book!.lastTickAt)}` : ''}
          </p>

          {book!.activity.length === 0 ? (
            <p className="text-[11.5px] text-[var(--text-tertiary)]">
              Nothing yet. It only asks when a price moves, and US equities do not move at weekends.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {book!.activity.slice(0, 8).map((a, i) => (
                <p key={i} className="text-[11.5px] leading-[1.55] text-[var(--text-secondary)]">
                  <span className="font-mono text-[var(--text-tertiary)]">{ago(a.at)} </span>
                  {a.line}{' '}
                  {a.signature && (
                    <a href={`https://explorer.solana.com/tx/${a.signature}?cluster=devnet`} target="_blank" rel="noreferrer noopener" className="text-[var(--verdigris)] underline underline-offset-2">on chain</a>
                  )}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {note && <p className="text-[11.5px] text-[var(--text-secondary)]" role="status">{note}</p>}
    </div>
  );
};
