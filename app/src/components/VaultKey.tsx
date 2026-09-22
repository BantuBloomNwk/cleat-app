import React, { useEffect, useState } from 'react';
import { PublicKey, type Keypair } from '@solana/web3.js';
import { connection } from '../lib/chain';
import { tactile } from '../utils/haptics';
import { delegateVault, moveVault, sendFromKey, vaultPda, type VaultAction } from '../lib/adopt';
import { confirmPresence, walletSyncMode } from '../lib/passkey';

/**
 * The key, its balance, and how to put something in it.
 *
 * There was no way to find out what address this app had made for you, which
 * meant there was no way to fund it either. A wallet you cannot see the
 * address of is not a wallet, it is a secret the app is keeping from the
 * person it belongs to.
 *
 * It moves value too. A vault that can be paid into and never out of is not a
 * vault, and the reason to have one is that an agent trading inside your
 * sentence eventually makes something you want to take home. Withdraw is owner
 * only in the program, which is the actual guarantee: the agent has no path to
 * it at any point, live grant or not.
 */
type WalletApi = ReturnType<typeof import('../hooks/useWallet').useWallet>;

export const VaultKey: React.FC<{ wallet: WalletApi }> = ({ wallet }) => {
  const keypair = wallet.keypair;
  const address = wallet.state.status === 'ready' ? wallet.state.address : null;
  const [lamports, setLamports] = useState<number | null>(null);
  const [vaultLamports, setVaultLamports] = useState<number | null>(null);
  /** The vault's owner moves away from our program once it is delegated. */
  const [delegated, setDelegated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [amount, setAmount] = useState('0.05');
  const [to, setTo] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) { setLamports(null); return; }
    let live = true;
    const vault = vaultPda(address, wallet.sleeve);
    const read = () => {
      connection.getBalance(address)
        .then((b) => { if (live) setLamports(b); }).catch(() => {});
      connection.getAccountInfo(vault)
        .then((a) => {
          if (!live) return;
          setVaultLamports(a ? a.lamports : null);
          setDelegated(!!a && a.owner.toBase58() !== '2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL');
        }).catch(() => {});
    };
    read();
    // Slow on purpose. A balance that updates every second is a balance being
    // watched, and the proxy behind it is not a subscription.
    const t = setInterval(read, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [address, nonce, wallet.sleeve]);

  /* Locked is not the same as absent, and neither is a dead end.
     A refresh leaves a key locked, and the old version of this panel answered
     that with a sentence and no way forward, which is how the vault came to
     look like it had nothing in it. */
  if (!address) {
    const st = wallet.state.status;
    const locked = st === 'locked';
    const busy = st === 'unlocking';
    return (
      <div className="vault-key">
        <div className="vault-key-row">
          <span className="vault-key-label">Your key</span>
          <span className="vault-key-balance">
            {st === 'unsupported' ? 'unavailable here' : locked ? 'locked' : busy ? 'unlocking…' : 'not made yet'}
          </span>
        </div>
        <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
          {st === 'unsupported'
            ? wallet.state.reason
            : locked
              ? 'There is a key on this device and it is locked. Unlocking asks the hardware, not us, and nothing leaves the device.'
              : st === 'error'
                ? wallet.state.message
                : 'No key here yet. One is made by the hardware, never written down as a phrase and never sent anywhere.'}
        </p>
        {st !== 'unsupported' && !locked && (
          <p className="text-[11px] leading-[1.6] text-[var(--trimmed-amber)]">
            If you have used Cleat before on any device, choose the second
            option. Making a new key makes a different wallet with a different
            address, and anything you sent to the old one stays there.
          </p>
        )}
        {st !== 'unsupported' && (
          <div className="vault-buttons">
            <button
              type="button"
              className="mesh-chip"
              disabled={busy}
              onClick={() => (locked ? wallet.unlock() : wallet.create())}
            >
              {busy ? 'Asking the hardware…' : locked ? 'Unlock this key' : 'Make a new key'}
            </button>
            {!locked && (
              <button type="button" className="mesh-chip" onClick={() => wallet.restore()}>
                Use a key I already have
              </button>
            )}
            {locked && (
              <button type="button" className="mesh-chip" onClick={() => wallet.restore()}>
                Use a different device
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const b58 = address.toBase58();
  const sol = lamports === null ? null : lamports / 1e9;
  const vaultSol = vaultLamports === null ? null : vaultLamports / 1e9;

  const run = async (label: string, fn: () => Promise<{ explorer: string }>) => {
    if (!keypair) return;
    tactile.mandateAction();
    setBusy(label);
    setNote(null);
    try {
      if (!(await confirmPresence())) {
        setNote({ ok: false, text: 'That was not confirmed, so nothing moved.' });
        return;
      }
      const r = await fn();
      setNote({ ok: true, text: `${label} sent.`, url: r.explorer });
      setTimeout(() => setNonce((n) => n + 1), 3500);
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const lamportsFromInput = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('That is not an amount.');
    return BigInt(Math.round(n * 1e9));
  };

  const move = (action: VaultAction) =>
    run(action === 'deposit' ? 'Deposit' : 'Withdrawal', async () =>
      moveVault(keypair!, action, lamportsFromInput(),
        { needsOpen: vaultLamports === null }, wallet.sleeve));

  const send = () =>
    run('Send', async () => {
      let dest: PublicKey;
      try { dest = new PublicKey(to.trim()); }
      catch { throw new Error('That is not a Solana address.'); }
      return sendFromKey(keypair!, dest, lamportsFromInput());
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b58);
      tactile.selectionTap();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* a browser that will not copy is not worth an error message */ }
  };

  return (
    <div className="vault-key">
      {/* Sleeves.
          One sentence for a whole person was the wrong shape. Nobody holds a
          single position: there is money you would not touch and money you are
          playing with, and they do not want the same rule. A sleeve is not a
          second wallet: the key and the address below stay the same, and the
          sleeve number goes into the seeds of the mandate, the vault and the
          log, so one key holds several accounts that cannot reach into each
          other. */}
      <div className="sleeve-bar">
        <span className="vault-key-label">Sleeves</span>
        <div className="sleeve-chips">
          {wallet.sleeves.map((s) => (
            <button
              key={s.index}
              type="button"
              className={`sleeve-chip${s.index === wallet.sleeve ? ' is-on' : ''}`}
              onClick={() => { tactile.selectionTap(); void wallet.select(s.index); }}
              onDoubleClick={() => {
                const name = prompt('Call this sleeve', s.name);
                if (name !== null) wallet.rename(s.index, name);
              }}
              title={s.index === wallet.sleeve ? 'Showing this one' : 'Switch to this sleeve'}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            className="sleeve-chip sleeve-chip-add"
            onClick={() => {
              const name = prompt('Call the new sleeve', `Sleeve ${wallet.sleeves.length}`);
              if (name === null) return;
              tactile.selectionTap();
              void wallet.addSleeve(name);
            }}
            title="Another key, another mandate, another vault"
          >
            + new
          </button>
        </div>
      </div>
      <p className="sleeve-note">
        One key, one address, several accounts. Each sleeve has its own
        sentence, its own vault and its own record, and the balance shown
        below is the one belonging to the sleeve you are on.
      </p>

      <div className="vault-key-row">
        <span className="vault-key-label">Your key</span>
        <span className="vault-key-balance">
          {sol === null ? 'reading…' : `${sol.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL`}
          {' '}
          <button
            type="button"
            className="vault-key-refresh"
            onClick={() => { tactile.selectionTap(); setNonce((n) => n + 1); }}
            title="Read it again now"
          >
            refresh
          </button>
        </span>
      </div>

      {walletSyncMode() === 'stored' && (
        <p className="text-[11px] leading-[1.6] text-[var(--trimmed-amber)]">
          This authenticator would not derive the key from the passkey itself,
          so the seed is kept in this browser. It will not follow you to another
          device, and a browser that clears its storage takes it with it. Use
          the same passkey on a device that supports it and you get the same key
          back.
        </p>
      )}

      <button type="button" className="vault-key-address" onClick={copy} title="Copy the address">
        <span>{b58}</span>
        <span className="vault-key-copy">{copied ? 'copied' : 'copy'}</span>
      </button>

      {/* Do not take our word for the number. If what this says and what an
          explorer says disagree, the explorer is right and we have a bug. */}
      <a
        href={`https://explorer.solana.com/address/${b58}?cluster=devnet`}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[10.5px] font-mono text-[var(--verdigris)] underline underline-offset-2"
      >
        check this address on an explorer
      </a>

      {sol !== null && sol < 0.01 && (
        <p className="text-[11px] leading-[1.6] text-[var(--text-secondary)]">
          Nothing in it yet. Writing a sentence costs rent, and on devnet that
          is free to get: paste the address into{' '}
          <a
            href="https://faucet.solana.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--verdigris)] underline underline-offset-2"
          >
            faucet.solana.com
          </a>
          . If you would rather not, the demo covers it and says so when it does.
        </p>
      )}

      <div className="vault-key-row">
        <span className="vault-key-label">Your vault</span>
        <span className="vault-key-balance">
          {delegated ? 'on the rollup · ' : ''}
          {vaultSol === null
            ? 'not open yet'
            : `${vaultSol.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL`}
        </span>
      </div>

      <div className="vault-actions">
        <label className="vault-field">
          <span>Amount</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount in SOL"
          />
          <span className="unit">SOL</span>
        </label>
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!keypair || !!busy}
            onClick={() => move('deposit')}>
            {busy === 'Deposit' ? 'Signing…' : vaultLamports === null ? 'Open and deposit' : 'Deposit'}
          </button>
          <button type="button" className="mesh-chip" disabled={!keypair || !!busy || vaultLamports === null}
            onClick={() => move('withdraw')}>
            {busy === 'Withdrawal' ? 'Signing…' : 'Withdraw'}
          </button>
        </div>
        <label className="vault-field">
          <span>Send to</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="a Solana address"
            aria-label="Destination address"
          />
        </label>
        <div className="vault-buttons">
          <button type="button" className="mesh-chip" disabled={!keypair || !!busy || !to.trim()}
            onClick={send}>
            {busy === 'Send' ? 'Signing…' : 'Send from your key'}
          </button>
        </div>

        {/* Delegation, for real rather than as a badge.
            This hands the vault to MagicBlock's rollup so decisions settle in
            milliseconds instead of slots. The app knows it happened because
            the account's owner changes, which it reads rather than is told. */}
        <div className="vault-buttons">
          <button
            type="button"
            className="mesh-chip"
            disabled={!keypair || !!busy || vaultLamports === null || delegated}
            onClick={() => run('Delegation', () => delegateVault(keypair!, wallet.sleeve))}
            title={delegated ? 'Already running on the rollup' : 'Hand the vault to the attested rollup'}
          >
            {busy === 'Delegation' ? 'Signing…' : delegated ? 'Running fast' : 'Make it fast'}
          </button>
        </div>
      </div>

      {note && (
        <p className={`text-[11px] leading-[1.6] ${note.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--refused-rust)]'}`}>
          {note.text}{' '}
          {note.url && (
            <a href={note.url} target="_blank" rel="noreferrer noopener"
               className="text-[var(--verdigris)] underline underline-offset-2">
              check the transaction
            </a>
          )}
        </p>
      )}

      <p className="text-[10.5px] leading-[1.6] text-[var(--text-tertiary)]">
        Withdrawing is owner only in the program. An agent cannot reach this
        whatever its grant says, which is the part that matters rather than the
        button being here.
      </p>
    </div>
  );
};
