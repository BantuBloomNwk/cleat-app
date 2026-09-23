import { useEffect, useState } from 'react';

/**
 * Which robot this person's agent is, in one place.
 *
 * There is one agent. It was drawn in four places with its appearance
 * written into three of them, so changing it on the vault changed it on the
 * vault and nowhere else, and the thing in the header stayed a different
 * character with the same name. That is not an identity, it is four
 * pictures.
 *
 * The choice lives in this browser rather than on chain, for the same
 * reason the reading position does: which one somebody picked is a fact
 * about the person, not about the account, and the account is public. The
 * key still decides the default, so two people never start the same.
 *
 * Other people keep their own. A copier's agent is derived from their key
 * and is theirs, and it would be a lie for it to follow this person's taste.
 */

const KEY = 'cleat_agent_variant';
const EVENT = 'cleat:agent-look';

export function readVariant(): number {
  try {
    const n = Number(localStorage.getItem(KEY) ?? '0');
    return Number.isFinite(n) ? ((n % 8) + 8) % 8 : 0;
  } catch {
    return 0;
  }
}

export function setVariant(next: number) {
  try {
    localStorage.setItem(KEY, String(((next % 8) + 8) % 8));
  } catch {
    /* a browser that will not remember still shows the one the key picked */
  }
  // Same tab: storage events do not fire on the window that wrote them, and
  // every copy of the agent is in this tab.
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useAgentVariant(): number {
  const [v, setState] = useState<number>(readVariant);
  useEffect(() => {
    const sync = () => setState(readVariant());
    window.addEventListener(EVENT, sync);
    // Another tab, which somebody on a desktop will have open.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return v;
}
