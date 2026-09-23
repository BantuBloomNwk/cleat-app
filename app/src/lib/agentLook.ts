import { useEffect, useState } from 'react';

/**
 * How this person's agent looks, in one place.
 *
 * There is one agent. It was drawn in four places with the style hardcoded
 * in three of them, so changing it on the vault changed it on the vault and
 * nowhere else, and the thing in the header stayed a different character
 * with the same name. That is not an identity, it is four pictures.
 *
 * The choice lives in this browser rather than on chain, for the same
 * reason the reading position does: which face somebody picked is a fact
 * about the person, not about the account, and the account is public.
 *
 * Other people keep their own faces. A copier's avatar is drawn from their
 * key and is theirs, and it would be a lie for it to follow this person's
 * taste. Only the owner's agent reads from here.
 */

export const AGENT_STYLES = ['voxel-bot', 'voxel-art', 'bottts', 'thumbs'] as const;
export type AgentStyle = (typeof AGENT_STYLES)[number];

export interface AgentLook {
  style: AgentStyle;
  /** A second face for the same key, so a person can change it and keep it. */
  variant: number;
}

const STYLE_KEY = 'cleat_agent_style';
const VARIANT_KEY = 'cleat_agent_variant';
const EVENT = 'cleat:agent-look';

const DEFAULT: AgentLook = { style: 'voxel-bot', variant: 0 };

export function readLook(): AgentLook {
  try {
    const style = localStorage.getItem(STYLE_KEY) as AgentStyle | null;
    const variant = Number(localStorage.getItem(VARIANT_KEY) ?? '0') || 0;
    return {
      style: style && (AGENT_STYLES as readonly string[]).includes(style) ? style : DEFAULT.style,
      variant,
    };
  } catch {
    return DEFAULT;
  }
}

export function setLook(next: AgentLook) {
  try {
    localStorage.setItem(STYLE_KEY, next.style);
    localStorage.setItem(VARIANT_KEY, String(next.variant));
  } catch {
    /* a browser that will not remember still draws the default */
  }
  // Same tab: storage events do not fire on the window that wrote them, and
  // every copy of the agent is in this tab.
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useAgentLook(): AgentLook {
  const [look, setState] = useState<AgentLook>(readLook);
  useEffect(() => {
    const sync = () => setState(readLook());
    window.addEventListener(EVENT, sync);
    // Another tab, which a person on a desktop will have open.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return look;
}

/** The seed a face is drawn from: the key, and the variant if there is one. */
export const faceSeed = (owner: string, variant: number) =>
  variant > 0 ? `${owner}#${variant}` : owner;
