import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Keypair } from '@solana/web3.js';
import { compileSentence, createMandate } from '../lib/adopt';
import { confirmPresence } from '../lib/passkey';

interface RewriteModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSentence: string;
  onSaveSentence: (newSentence: string) => void;
  /** Needed to sign. Without one this can only change what is on screen. */
  keypair: Keypair | null;
  /** Which of that key's sleeves is being rewritten. */
  sleeve: number;
  /** True when a mandate already exists on chain for this sleeve. */
  hasMandate: boolean;
}

export const RewriteModal: React.FC<RewriteModalProps> = ({
  isOpen,
  onClose,
  currentSentence,
  onSaveSentence,
  keypair,
  sleeve,
  hasMandate,
}) => {
  const [text, setText] = useState(currentSentence);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ explorer: string } | null>(null);

  /* Open it on whatever the sentence is now, not on whatever it was the first
     time this component mounted. Adopting somebody else's rule and then
     opening this showed the old one, because the initial state was captured
     once and never refreshed. */
  useEffect(() => {
    if (isOpen) { setText(currentSentence); setErr(null); setDone(null); }
  }, [isOpen, currentSentence]);

  if (!isOpen) return null;

  const handleSave = async () => {
    const next = text.trim();
    if (!next) return;
    if (done) { onClose(); return; }

    // No key means this can only change what is on screen, and it says so
    // rather than looking like it did more.
    if (!keypair) {
      setErr('There is no key unlocked, so this can only change what you see here. Unlock in the vault to write it.');
      onSaveSentence(next);
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      if (!(await confirmPresence())) {
        setErr('That was not confirmed, so nothing was written.');
        return;
      }
      /* The same call that sets up. It rewrites the sentence when one is
         already there and builds anything still missing, so a rewrite also
         repairs a half finished setup instead of failing on it. */
      const r = await createMandate(keypair, next, compileSentence(next), {}, sleeve);
      onSaveSentence(next);
      setDone({ explorer: r.explorer });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="modal-backdrop"
      id="rewriteMandateModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="onboarding-card max-w-[420px] w-full">
        <div className="flex items-center justify-between border-b border-[var(--card-border-subtle)] pb-2.5">
          <div>
            <h3 className="font-wordmark text-[16px] font-bold text-[var(--text-primary)]">
              Mount Mandate
            </h3>
            <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
              The sentence the agent cannot exceed, enforced on chain
            </span>
          </div>
          <button
            type="button"
            className="text-[var(--text-tertiary)] text-[18px] cursor-pointer hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="tactile-paper-sheet mt-2">
          <textarea
            aria-label="Edit plain English boundary sentence"
            className="tactile-textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your mandate in plain English..."
          />
        </div>

        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="live-cap-chip">Adaptive Syntax Engine</span>
          <span className="live-cap-chip">Zero Leakage</span>
          <span className="live-cap-chip">ECDSA Enforced</span>
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn-ember flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            id="btn-save-rewrite-mandate"
            type="button"
            className="btn-inject flex-[1.4] justify-center"
            onClick={handleSave}
            disabled={busy || !text.trim()}
          >
            {busy
              ? 'Signing…'
              : done
                ? 'Done'
                : hasMandate
                  ? 'Rewrite it on chain'
                  : 'Mount Mandate'}
          </button>
        </div>
        {err && <p className="text-[11px] text-[var(--refused-rust)] mt-2">{err}</p>}
        {done && (
          <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)] mt-2">
            Rewritten. The version on the mandate moved, which means any agent
            grant issued against the old one stops working until you grant
            again.{' '}
            <a href={done.explorer} target="_blank" rel="noreferrer noopener"
               className="text-[var(--verdigris)] underline underline-offset-2">
              check the transaction
            </a>
          </p>
        )}
      </div>
    </div>,
    document.body
  );
};
