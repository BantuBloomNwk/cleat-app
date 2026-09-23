import React, { useEffect, useRef, useState } from 'react';
import { PALETTES, buildIndex } from '../lib/agentBuilds';

/**
 * A face for the agent, and motion that means something.
 *
 * The argument against giving this product a character is that Cleat's
 * whole pitch is that you should not have to trust the agent, and a
 * likeable mascot is a device for building trust in exactly the thing you
 * are told not to trust. That argument is half right. It rules out a
 * character that is uniformly cheerful, and in particular one that is more
 * pleased when a trade clears than when one is refused, because that is the
 * character cheering the agent on.
 *
 * It does not rule out a character. A product nobody opens protects nobody,
 * and an interface with no warmth in it gives a person no reason to come
 * back however good its guarantees are. So the character is built, and the
 * refusal is its most expressive moment. The haptics already worked this
 * out: refused gets the harshest signature and cleared the smallest. The
 * motion here follows the same ranking, so the eye, the hand and the ear
 * all agree about which of the three just happened.
 *
 * This is the small one. It is a still of the same robot the vault turns,
 * rendered once per build and reused, because a live canvas per fingernail
 * sized avatar is absurd and a different drawing would mean two agents. The
 * colour is on screen in the first frame and the render arrives behind it,
 * so there is never a hole where the face goes.
 */

export type AgentMood =
  | 'idle'
  | 'thinking'
  | 'cleared'
  | 'trimmed'
  | 'refused'
  | 'sealed';

/** How long a reaction plays before falling back to idle. */
const REACTION_MS: Record<AgentMood, number> = {
  idle: 0,
  thinking: 0, // held until the caller changes it
  cleared: 900,
  trimmed: 1100,
  refused: 1600,
  sealed: 1400,
};

export const AgentAvatar: React.FC<{
  /** Anything stable. A wallet address gives the same robot forever. */
  seed: string;
  /** A second build for the same key, when somebody has chosen one. */
  variant?: number;
  mood?: AgentMood;
  size?: number;
  className?: string;
}> = ({ seed, variant = 0, mood = 'idle', size = 40, className = '' }) => {
  // A reaction should play and then stop. Holding the caller's prop would
  // leave the character stuck mid-flinch until something else happened.
  const [shown, setShown] = useState<AgentMood>(mood);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setShown(mood);
    if (timer.current) window.clearTimeout(timer.current);
    const ms = REACTION_MS[mood];
    if (ms > 0) {
      timer.current = window.setTimeout(() => setShown('idle'), ms);
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [mood]);

  const index = buildIndex(seed, variant);
  const palette = PALETTES[index];

  const [portrait, setPortrait] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // Behind the colour, never in front of it. A browser with no WebGL just
    // keeps the colour, which is still this agent and still nobody else's.
    import('../three/portrait')
      .then((m) => {
        if (live) setPortrait(m.portraitOf(index));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [index]);

  return (
    <span
      className={`agent-avatar agent-${shown} ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 34% 28%, ${palette.body}, ${palette.trim})`,
      }}
      // The mood is announced rather than only drawn, because somebody using
      // a screen reader should get the verdict too.
      role="img"
      aria-label={
        shown === 'refused' ? 'refused'
        : shown === 'trimmed' ? 'trimmed'
        : shown === 'cleared' ? 'cleared'
        : shown === 'sealed' ? 'sealed on chain'
        : shown === 'thinking' ? 'deciding'
        : 'watching'
      }
    >
      {portrait && <img src={portrait} alt="" aria-hidden="true" draggable={false} />}
    </span>
  );
};
