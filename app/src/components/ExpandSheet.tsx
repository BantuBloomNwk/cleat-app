import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tactile } from '../utils/haptics';

interface ExpandSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  kicker?: string;
  children: React.ReactNode;
  /** Charts want the room; a list of figures does not. */
  wide?: boolean;
}

/**
 * The pop out used by every card and chart that has more to say than fits
 * in a phone column.
 *
 * Deliberately one component rather than a modal per card. A card and its
 * expanded view showing different things is how the two drift apart, so
 * the caller passes the same children it renders inline and they simply
 * get more room here. The d3 charts scale to whatever room they are
 * given, because they draw into a viewBox rather than measuring pixels,
 * so they need nothing from this component to fill the extra width.
 *
 * Carries the things the existing modals in this app do not: escape to
 * close, focus moved in and then restored to whatever opened it, and the
 * page behind locked so it cannot scroll under the sheet.
 */
export const ExpandSheet: React.FC<ExpandSheetProps> = ({
  isOpen,
  onClose,
  title,
  kicker,
  children,
  wide = false,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tactile.modalDismiss();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Keep tabbing inside the sheet. Without this the focus ring walks
      // off into the page behind, which for a screen reader means the
      // dialog was never really a dialog.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    // Focus the panel itself rather than the close button, so a screen
    // reader announces the title instead of the word "close".
    const t = window.setTimeout(() => panelRef.current?.focus(), 30);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      window.clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="expand-sheet-backdrop z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          tactile.modalDismiss();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`expand-sheet-panel w-full ${wide ? 'is-wide' : ''} flex flex-col gap-3.5 outline-none`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col min-w-0">
            {kicker && (
              <span className="text-[10px] font-mono uppercase tracking-[0.09em] text-[var(--text-tertiary)] whitespace-nowrap">
                {kicker}
              </span>
            )}
            <h2 className="font-sans font-bold text-[16px] text-[var(--text-primary)] leading-tight">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              tactile.modalDismiss();
              onClose();
            }}
            aria-label="Close"
            className="expand-sheet-close shrink-0 grid place-items-center rounded-xl border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="expand-sheet-body flex flex-col gap-3.5">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * The affordance that opens one.
 *
 * Two sizes. The default carries the word and a real 44px box, for a card
 * header where there is room for it. The compact one is the arrows alone in
 * a 26px box with the hit area pushed out past its edges, for a tile where
 * a 44px button would take the height the chart needs and shove the chart
 * out of the card. Both reach 44px to a finger.
 */
export const ExpandButton: React.FC<{
  onClick: () => void;
  label: string;
  compact?: boolean;
}> = ({ onClick, label, compact = false }) => (
  <button
    type="button"
    onClick={() => {
      tactile.selectionTap();
      onClick();
    }}
    aria-label={label}
    title={compact ? label : undefined}
    className={`expand-open-btn ${compact ? 'is-compact justify-center' : ''} shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--verdigris)] hover:border-[var(--verdigris)]`}
  >
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
    {!compact && (
      <span className="text-[10px] font-mono uppercase tracking-wider whitespace-nowrap">Expand</span>
    )}
  </button>
);
