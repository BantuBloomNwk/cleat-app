import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { tactile } from '../utils/haptics';
import { compileSentence, createMandate } from '../lib/adopt';
import { confirmPresence } from '../lib/passkey';
import { hasWallet } from '../lib/passkey';
import emblemDark from '../assets/emblem-dark.png';
import emblemLight from '../assets/emblem-light.png';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSealMandate: (sentence: string) => void;
  /** The one wallet, owned by the app. */
  wallet: ReturnType<typeof import('../hooks/useWallet').useWallet>;
  /** Fired only when a sentence actually reached the chain. */
  onSealed?: (r: { signature: string; explorer: string; sponsored: boolean }) => void;
  initialSentence: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  wallet,
  onSealMandate,
  onSealed,
  initialSentence,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mandateText, setMandateText] = useState(initialSentence);
  // The wallet comes from above rather than from another useWallet() here.
  //
  // This was the bug, and it was the whole bug. Calling the hook again made a
  // second, independent state machine with its own keypair. Unlocking a
  // passkey in this modal filled that one, and the Vault tab was reading the
  // other one, which was still empty. So the address never appeared, there was
  // nothing to put controls next to, and sealing a mandate found no key and
  // quietly fell back to setting a string.

  // Whether a wallet already exists is read once, when the sheet opens, so
  // the button does not change its mind under the user's finger mid flow.
  const [existed] = useState(() => hasWallet());

  /* What the sentence turns into, recomputed as it is typed, so the caps on
     screen are the caps that will be written rather than three fixed chips
     that never corresponded to anything. */
  const compiled = React.useMemo(() => compileSentence(mandateText), [mandateText]);
  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ signature: string; explorer: string } | null>(null);

  // Every hook has to run on every render, so they all live above this. The
  // three above were added below it and the modal then rendered four hooks
  // closed and seven open, which is React error 300 and a white screen the
  // moment anybody opened it twice.
  if (!isOpen) return null;

  const isVerifying = wallet.state.status === 'unlocking';
  const ready = wallet.state.status === 'ready';

  /**
   * One wallet, ever.
   *
   * Creating a second passkey wallet would strand whatever the first one
   * holds behind a credential the app has stopped pointing at, which is
   * the same way round as losing a seed phrase and worse because it looks
   * like success. So if this browser already knows about a wallet the only
   * thing this button does is unlock it, and creating is not reachable
   * from here at all.
   */
  const handlePasskey = async () => {
    tactile.mandateAction();
    const kp = existed ? await wallet.unlock() : await wallet.create();
    if (kp) {
      tactile.selectionTap();
      setStep(3);
    }
  };

  const passkeyLabel = (() => {
    if (isVerifying) return existed ? 'Waiting for you…' : 'Creating your vault…';
    if (ready) return 'Verified';
    if (wallet.state.status === 'error') return 'Try again';
    // "existed" is read once when the sheet opens and only reflects this
    // browser's storage. Storage cleared, or a different browser, and this
    // says Create to somebody who already has a key, which mints a second
    // passkey and therefore a second wallet with a different address and a
    // different balance. That is a real way to lose track of funds, so the
    // recovery route is not a footnote below the button.
    return existed ? 'Unlock with Face ID' : 'Create a new key';
  })();

  /**
   * Seal used to set a string in React state and close.
   *
   * The button said "Seal Mandate on Solana" and nothing went to Solana. It
   * writes the mandate to an account under the person's own key now, which
   * means the passkey is asked to sign, which is the first time in this app
   * that a key belonging to the person has ever been used for anything.
   */
  const handleSeal = async () => {
    if (sealed) { onClose(); return; }
    const text = mandateText.trim();
    if (!text) return;
    tactile.mandateAction();
    setSealError(null);

    // No key, no signature, and it says so. Quietly writing the sentence into
    // local state and closing is how "seal it on chain" came to mean nothing,
    // and in a product whose argument is that you should not have to trust it,
    // a UI that pretends is the worst failure available.
    if (!wallet.keypair) {
      setSealError(
        wallet.state.status === 'locked'
          ? 'Your key is locked. Go back a step and unlock it, then this can be signed.'
          : 'There is no key on this device yet. Go back a step and make one, then this can be signed.',
      );
      setStep(2);
      return;
    }

    setSealing(true);
    try {
      if (!(await confirmPresence())) {
        setSealError('That was not confirmed, so nothing was written.');
        return;
      }
      // Writing the first one sets up all three accounts. If this key already
      // speaks for a sentence, the same button rewrites it rather than failing
      // or, as it did until now, silently closing and looking like it worked.
      let r;
      try {
        r = await createMandate(wallet.keypair, text, compiled, {}, wallet.sleeve);
      } catch (e) {
        if (!/already speaks/i.test((e as Error).message)) throw e;
        r = await createMandate(wallet.keypair, text, compiled, { replace: true }, wallet.sleeve);
      }
      onSealMandate(text);
      onSealed?.(r);
      setSealed(r);
    } catch (e) {
      setSealError((e as Error).message);
    } finally {
      setSealing(false);
    }
  };

  return createPortal(
    <div
      className="onboarding-overlay active flex flex-col justify-center items-center"
      id="onboardingOverlay"
      data-theme={theme}
    >
      <div className="onboarding-card" data-theme={theme}>
        {/* Step Indicators & Top Bar with Theme Toggle */}
        <div className="onboarding-step-indicators">
          <div className="flex flex-col">
            <span className="font-mono text-[9.5px] font-bold text-[var(--verdigris)] tracking-widest uppercase mb-1">
              {existed ? "Unlock" : "Set up"} • Step {step} of 3
            </span>
            <div className="onboarding-step-dots">
              <button
                type="button"
                aria-label="Step 1"
                className={`step-dot ${step === 1 ? 'active' : ''}`}
                onClick={() => {
                  tactile.selectionTap();
                  setStep(1);
                }}
              />
              <button
                type="button"
                aria-label="Step 2"
                className={`step-dot ${step === 2 ? 'active' : ''}`}
                onClick={() => {
                  tactile.selectionTap();
                  setStep(2);
                }}
              />
              <button
                type="button"
                aria-label="Step 3"
                className={`step-dot ${step === 3 ? 'active' : ''}`}
                onClick={() => {
                  tactile.selectionTap();
                  setStep(3);
                }}
              />
            </div>
          </div>

          {/* Top Actions: Theme Switcher & Skip */}
          <div className="flex items-center gap-2">
            <button
              id="btn-onboarding-theme-toggle"
              type="button"
              className="w-8 h-8 rounded-full border border-[var(--card-border)] bg-[var(--card-surface-raised)] text-[var(--text-primary)] hover:border-[var(--verdigris)] flex items-center justify-center transition-all cursor-pointer shadow-sm"
              onClick={() => {
                tactile.selectionTap();
                onToggleTheme();
              }}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <svg className="w-4 h-4 text-[var(--ember)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[var(--verdigris)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="step-skip-btn hover:text-[var(--text-primary)] transition-colors"
              onClick={() => {
                tactile.modalDismiss();
                onClose();
              }}
            >
              Look around first
            </button>
          </div>
        </div>

        {/* Step 1: Cinematic Vision & Emblem */}
        {step === 1 && (
          <div className="onboarding-step-content active flex flex-col items-center text-center">
            {/* The emblem ships cropped to its own artwork now, so the zoom
                that used to hide a white margin crops into it instead and
                chips the corners off. */}
            <div className="cinematic-emblem">
              <img
                src={theme === 'light' ? emblemLight : emblemDark}
                alt="Cleat Emblem"
                className="w-full h-full object-contain object-center"
              />
            </div>
            <div className="splash-claim-sentence">
              “An agent you don’t have to trust.”
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-2 max-w-[320px]">
              Autonomous speed governed by what you actually told it to do.
            </p>
            {/* A cleat is the fitting on a dock that a line is made fast to.
                It does not move the boat. It stops it leaving. */}
            <p className="splash-tagline mb-6">Markets drift. Cleat holds.</p>
            <button
              id="btn-onboarding-continue"
              type="button"
              className="btn-passkey-auth w-full"
              onClick={() => {
                tactile.selectionTap();
                setStep(2);
              }}
            >
              <span>{existed ? 'Unlock your vault' : 'Set up your vault'}</span>
              <svg className="w-4 h-4 stroke-[2.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Step 2: Passkey Biometric Auth */}
        {step === 2 && (
          <div className="onboarding-step-content active flex flex-col items-center text-center">
            <div className="passkey-biometric-icon">
              <svg viewBox="0 0 24 24" className="w-9 h-9 stroke-current fill-none stroke-[1.8]">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                <circle cx="9" cy="9" r="1" />
                <circle cx="15" cy="9" r="1" />
                <path d="M10 15c.5.5 1.5 1 2 1s1.5-.5 2-1" />
              </svg>
            </div>
            <h3 className="font-wordmark text-[18px] font-bold mb-1.5 text-[var(--text-primary)]">
              Sign In with Passkey
            </h3>
            <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed mb-5 max-w-[310px]">
              {existed
                ? 'Your vault is already set up on this device. Your face opens it.'
                : 'Your face makes the key, and the key never leaves your device.'}{' '}
              <strong className="text-[var(--text-primary)]">
                No password, no seed phrase, nothing to write down.
              </strong>
            </p>

            {wallet.state.status === 'unsupported' && (
              <p className="text-[11.5px] text-[var(--ember)] leading-relaxed mb-4 max-w-[310px]">
                {wallet.state.reason}
              </p>
            )}
            {wallet.state.status === 'error' && (
              <p className="text-[11.5px] text-[var(--refused-rust)] leading-relaxed mb-4 max-w-[310px]">
                {wallet.state.message}
              </p>
            )}
            <button
              id="btn-passkey-verify"
              type="button"
              disabled={isVerifying || wallet.state.status === 'unsupported'}
              className="btn-passkey-auth w-full"
              onClick={handlePasskey}
            >
              <svg className="w-[18px] h-[18px] stroke-2 fill-none stroke-current" viewBox="0 0 24 24">
                <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z" />
              </svg>
              <span>{passkeyLabel}</span>
            </button>

            {/* The recovery path, for a device that has never seen this app.
                Nothing local is consulted: the platform offers whatever Cleat
                passkeys the user has and the same wallet comes back. */}
            {!existed && (
              <button
                type="button"
                disabled={isVerifying}
                className="font-mono text-[11px] text-[var(--verdigris)] mt-3 hover:underline"
                onClick={async () => {
                  tactile.selectionTap();
                  const kp = await wallet.restore();
                  if (kp) setStep(3);
                }}
              >
                I already have a key, use that one
              </button>
            )}

            <button
              type="button"
              className="font-mono text-[11px] text-[var(--text-tertiary)] mt-3.5 hover:underline"
              onClick={() => {
                tactile.selectionTap();
                setStep(1);
              }}
            >
              Back to overview
            </button>
          </div>
        )}

        {/* Step 3: Write First Mandate */}
        {step === 3 && (
          <div className="onboarding-step-content active flex flex-col items-center text-center">
            <div className="w-full text-left mb-2.5">
              <h3 className="font-wordmark text-[17px] font-bold text-[var(--text-primary)]">
                Write your first mandate
              </h3>
              <p className="text-[11.5px] text-[var(--text-tertiary)]">
                Direct boundaries enforced on Solana via PER &amp; MPC (Magicblock &amp; Arcium).
              </p>
              {/* Which vault this is about to be sealed to. Showing the
                  address here rather than after is the point: the sentence
                  and the key it binds to should be on screen together. */}
              {wallet.state.status === 'ready' && (
                <p className="font-mono text-[10px] text-[var(--verdigris)] mt-1.5 break-all">
                  Writing to {wallet.state.address.toBase58().slice(0, 8)}…
                  {wallet.state.address.toBase58().slice(-6)}
                </p>
              )}
            </div>
            <div className="tactile-paper-sheet">
              <textarea
                aria-label="First mandate input"
                className="tactile-textarea"
                rows={3}
                value={mandateText}
                onChange={(e) => setMandateText(e.target.value)}
                placeholder="Write your mandate in plain English..."
              />
            </div>
            <div className="live-caps-row mt-2.5">
              <span className="live-cap-chip whitespace-nowrap">
                {(compiled.maxPositionBps / 100).toFixed(0)}% max single name
              </span>
              <span className="live-cap-chip whitespace-nowrap">
                {(compiled.maxTradeBps / 100).toFixed(0)}% one trade
              </span>
              <span className="live-cap-chip whitespace-nowrap">
                {compiled.denied.length} ruled out by name
              </span>
            </div>
            <p className="text-[10.5px] leading-[1.6] text-[var(--text-tertiary)] mt-1.5">
              What it compiles to: {compiled.notes.join(', ')}. The program cannot
              read English, so this is the part it enforces.
            </p>
            {sealError && (
              <p className="text-[11px] text-[var(--refused-rust)] mt-1.5">{sealError}</p>
            )}
            {sealed && (
              <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)] mt-1.5">
                Written. Your mandate, your vault and the log that records
                decisions about it are all on chain under your own key.{' '}
                <a
                  href={sealed.explorer}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[var(--verdigris)] underline underline-offset-2"
                >
                  check the transaction
                </a>
              </p>
            )}
            <button
              id="btn-seal-onboarding-mandate"
              type="button"
              className="btn-inject w-full rounded-2xl p-3.5 mt-3.5 justify-center whitespace-nowrap"
              onClick={handleSeal}
              disabled={sealing || !mandateText.trim()}
            >
              <span>
                {sealing
                  ? 'Signing and sending…'
                  : sealed
                    ? 'Done, take me in'
                    : wallet.keypair
                      ? 'Write it on chain'
                      : 'Write it down'}
              </span>
              <svg className="w-4 h-4 stroke-[2.2] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>

            <button
              type="button"
              className="font-mono text-[11px] text-[var(--text-tertiary)] mt-2.5 hover:underline"
              onClick={() => {
                tactile.selectionTap();
                setStep(2);
              }}
            >
              ← Back to Passkey
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
