import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { tactile } from '../utils/haptics';
import emblemDark from '../assets/emblem-dark.png';
import emblemLight from '../assets/emblem-light.png';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSealMandate: (sentence: string) => void;
  initialSentence: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  onSealMandate,
  initialSentence,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isVerifying, setIsVerifying] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('Authenticate with Passkey');
  const [mandateText, setMandateText] = useState(initialSentence);

  if (!isOpen) return null;

  const handleSimulatePasskey = () => {
    tactile.mandateAction();
    setIsVerifying(true);
    setPasskeyLabel('Scanning Biometrics...');
    setTimeout(() => {
      setPasskeyLabel('Passkey Verified ✓');
      tactile.selectionTap();
      setTimeout(() => {
        setIsVerifying(false);
        setStep(3);
      }, 500);
    }, 800);
  };

  const handleSeal = () => {
    tactile.mandateAction();
    if (mandateText.trim()) {
      onSealMandate(mandateText.trim());
    }
    onClose();
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
              Intro Walkthrough • Step {step} of 3
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
              Skip to Diary →
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
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-6 max-w-[320px]">
              Autonomous speed governed by what you actually told it to do.
            </p>
            <button
              id="btn-onboarding-continue"
              type="button"
              className="btn-passkey-auth w-full"
              onClick={() => {
                tactile.selectionTap();
                setStep(2);
              }}
            >
              <span>Continue to Passkey Setup</span>
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
              Biometric passkey verified on device hardware. <strong className="text-[var(--text-primary)]">No password, no seed phrase.</strong>
            </p>
            <button
              id="btn-passkey-verify"
              type="button"
              disabled={isVerifying}
              className="btn-passkey-auth w-full"
              onClick={handleSimulatePasskey}
            >
              <svg className="w-[18px] h-[18px] stroke-2 fill-none stroke-current" viewBox="0 0 24 24">
                <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z" />
              </svg>
              <span>{passkeyLabel}</span>
            </button>

            <button
              type="button"
              className="font-mono text-[11px] text-[var(--text-tertiary)] mt-3.5 hover:underline"
              onClick={() => {
                tactile.selectionTap();
                setStep(1);
              }}
            >
              ← Back to Overview
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
              <span className="live-cap-chip whitespace-nowrap">15% Max Single Name</span>
              <span className="live-cap-chip whitespace-nowrap">Fossil Fuels: 0%</span>
              <span className="live-cap-chip whitespace-nowrap">Risk Band: Moderate</span>
            </div>
            <button
              id="btn-seal-onboarding-mandate"
              type="button"
              className="btn-inject w-full rounded-2xl p-3.5 mt-3.5 justify-center whitespace-nowrap"
              onClick={handleSeal}
            >
              <span>Seal Mandate on Solana</span>
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
