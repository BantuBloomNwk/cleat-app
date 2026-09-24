import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tactile } from '../utils/haptics';

/**
 * The reasoning, one tap away.
 *
 * Nearly every card in this app had a paragraph under its heading
 * explaining why the numbers below it mean anything. Each of those
 * paragraphs is worth reading once and worth reading never again, and
 * together they made the tabs four thousand pixels of prose with some
 * figures embedded in it. A person who opens a tab to check on something
 * should meet the something, not an essay about it.
 *
 * So the explanation moves behind a word. The trigger is small and quiet
 * and sits next to the heading it belongs to, and what comes up is the same
 * sheet the character picker and the agent brief already use, so there is
 * one way to be shown more rather than three.
 *
 * Nothing is deleted on the way. The writing was the point and it is all
 * still here; it is simply no longer in front of the answer.
 */
export const Aside: React.FC<{
  /** What the sheet is about, shown as its heading and read to a screen reader. */
  title: string;
  /** The word on the trigger. One word if at all possible. */
  label?: string;
  children: React.ReactNode;
}> = ({ title, label = 'why', children }) => {
  const [open, setOpen] = useState(false);

  // Escape closes it, and while it is up the page behind should not scroll
  // under it, which on a phone is the difference between a sheet and a
  // surprise.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="aside-trigger"
        aria-haspopup="dialog"
        onClick={() => { tactile.selectionTap(); setOpen(true); }}
      >
        {label}
      </button>

      {open && createPortal(
        <div className="agent-sheet-scrim" onClick={() => setOpen(false)}>
          <div
            className="agent-sheet brief-sheet aside-sheet"
            role="dialog"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="agent-sheet-head">
              <span className="meta-kicker">{title}</span>
              <button
                type="button"
                className="agent-sheet-x"
                onClick={() => setOpen(false)}
                aria-label="close"
              >
                ✕
              </button>
            </div>
            <div className="aside-body">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
