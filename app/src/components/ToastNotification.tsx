import React, { useEffect } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface ToastNotificationProps {
  isVisible: boolean;
  message: string;
  subtext?: string;
  onDismiss: () => void;
  duration?: number;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  isVisible,
  message,
  subtext,
  onDismiss,
  duration = 2800,
}) => {
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [isVisible, duration, onDismiss]);

  if (!isVisible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-[var(--card-surface-raised)]/95 border border-[var(--verdigris-chip-border)] shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all duration-300 ease-out animate-fadeIn max-w-[92vw] sm:max-w-md pointer-events-auto"
      id="cleat-subtle-toast"
    >
      <div className="w-6 h-6 rounded-full bg-[var(--verdigris-chip-bg)] border border-[var(--verdigris)]/30 flex items-center justify-center shrink-0">
        <Check size={13} className="text-[var(--verdigris)] animate-pulse" />
      </div>

      <div className="flex flex-col min-w-0 pr-1">
        <span className="text-[12.5px] font-sans font-bold text-[var(--text-primary)] leading-snug">
          {message}
        </span>
        {subtext && (
          <span className="text-[10.5px] font-mono text-[var(--text-tertiary)] truncate max-w-[240px] sm:max-w-[320px]">
            {subtext}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors ml-1"
        aria-label="Dismiss Notification"
      >
        <X size={13} />
      </button>
    </div>
  );
};
