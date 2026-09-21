import React, { useEffect, useState } from 'react';
import { PublicKey, type Keypair } from '@solana/web3.js';
import { connection } from '../lib/chain';
import { tactile } from '../utils/haptics';
import { moveVault, sendFromKey, vaultPda, type VaultAction } from '../lib/adopt';

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
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [amount, setAmount] = useState('0.05');
  const [to, setTo] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) { setLamports(null); return; }
    let live = true;
    const vault = vaultPda(address);
    const read = () => {
      connection.getBalance(address)
        .then((b) => { if (live) setLamports(b); }).catch(() => {});
      connection.getAccountInfo(vault)
        .then((a) => { if (live) setVaultLamports(a ? a.lamports : null); }).catch(() => {});
    };
    read();
    // Slow on purpose. A balance that updates every second is a balance being
    // watched, and the proxy behind it is not a subscription.
    const t = setInterval(read, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [address, nonce]);

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
        {st !== 'unsupported' && (
          <div className="vault-buttons">
            <button
              type="button"
              className="mesh-chip"
              disabled={busy}
              onClick={() => (locked ? wallet.unlock() : wallet.create())}
            >
              {busy ? 'Asking the hardware…' : locked ? 'Unlock this key' : 'Make a key'}
            </button>
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
      moveVault(keypair!, action, lamportsFromInput(), { needsOpen: vaultLamports === null }));

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
      <div className="vault-key-row">
        <span className="vault-key-label">Your key</span>
        <span className="vault-key-balance">
          {sol === null ? 'reading…' : `${sol.toFixed(4)} SOL`}
        </span>
      </div>

      <button type="button" className="vault-key-address" onClick={copy} title="Copy the address">
        <span>{b58}</span>
        <span className="vault-key-copy">{copied ? 'copied' : 'copy'}</span>
      </button>

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
          {vaultSol === null ? 'not open yet' : `${vaultSol.toFixed(4)} SOL`}
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
