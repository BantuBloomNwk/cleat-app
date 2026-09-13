import { useEffect, type RefObject } from 'react';
import { tactile } from './haptics';

/**
 * The behaviour a dialog has to have before it counts as one.
 *
 * Escape closes it, Tab stays inside it, the page behind cannot scroll
 * under it, and focus goes back to whatever opened it when it closes.
 * Four things, and a dialog missing any of them is a div that happens to
 * sit on top. They were written once for the pop out sheet and then the
 * older modals in this app were still missing all four, so they live here
 * now and every overlay calls this.
 *
 * @param isOpen   whether the dialog is mounted and showing
 * @param onClose  what Escape should call
 * @param panelRef the element that holds the focusable content
 */
export function useDialog(
  isOpen: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!isOpen) return;

    const restoreTo = document.activeElement as HTMLElement | null;
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

      // Without this the focus ring walks off into the page behind, which
      // for anyone on a keyboard or a screen reader means the dialog was
      // never really modal.
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const focusable = [...nodes].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
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
    // The panel rather than the close button, so a screen reader announces
    // the title instead of the word "close".
    const t = window.setTimeout(() => panelRef.current?.focus?.(), 30);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      window.clearTimeout(t);
      restoreTo?.focus?.();
    };
  }, [isOpen, onClose, panelRef]);
}
