import React, { useEffect, useState } from 'react';
import { ExpandSheet } from './ExpandSheet';

/**
 * The privacy policy, as a sheet over the app like everything else.
 *
 * The words live once, in public/privacy.html, which is also the page the
 * store links to. This reads that file and shows its body, so the policy in
 * the app and the policy on the web can never say different things.
 */
export const PrivacySheet: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || html) return;
    fetch('/privacy.html')
      .then((r) => r.text())
      .then((t) => {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        const main = doc.querySelector('main');
        main?.querySelector('h1')?.remove(); // the sheet has its own title
        setHtml(main?.innerHTML ?? null);
      })
      .catch(() => setHtml(''));
  }, [isOpen, html]);

  return (
    <ExpandSheet isOpen={isOpen} onClose={onClose} kicker="Cleat" title="Privacy policy">
      {html === null ? (
        <p className="text-[12px] font-mono text-[var(--text-tertiary)]">Loading…</p>
      ) : html === '' ? (
        <p className="text-[12px] text-[var(--text-secondary)]">
          It did not load. It is also at <a className="underline" href="/privacy.html">/privacy.html</a>.
        </p>
      ) : (
        // Our own static file, same origin, no script in it.
        <div className="privacy-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </ExpandSheet>
  );
};
