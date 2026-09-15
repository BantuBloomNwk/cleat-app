import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface RewriteModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSentence: string;
  onSaveSentence: (newSentence: string) => void;
}

export const RewriteModal: React.FC<RewriteModalProps> = ({
  isOpen,
  onClose,
  currentSentence,
  onSaveSentence,
}) => {
  const [text, setText] = useState(currentSentence);

  if (!isOpen) return null;

  const handleSave = () => {
    if (text.trim()) {
      onSaveSentence(text.trim());
    }
    onClose();
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
          >
            Mount Mandate
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
