import React, { useEffect, useRef, useState } from 'react';
import { AgentAvatar, type AgentMood } from './AgentAvatar';
import { tactile } from '../utils/haptics';

/**
 * The agent, large, at the top of the vault.
 *
 * The small face beside a line of text is an indicator. This is the thing
 * itself: it has depth, it holds your gaze, it moves when the agent does
 * something, and it is the one part of the screen a person will look at
 * before they read anything.
 *
 * The argument for having it at all is not decoration. A product nobody
 * opens protects nobody, and a screen of verdicts and percentages gives a
 * person no reason to come back however good its guarantees are. The
 * argument against is that making the agent likeable undermines a pitch
 * built on not having to trust it. Both are right, and the resolution is
 * in which moment gets the performance: the refusal is the biggest thing
 * this character does. It is never more pleased to have cleared a trade
 * than to have stopped one.
 *
 * The depth is CSS rather than a 3D engine. A rigged model would mean a
 * renderer, an asset pipeline and a battery cost on a phone, to move a
 * thing forty millimetres across. Perspective, a tilt that follows the
 * pointer, a floating idle and a shadow that reacts to the float get the
 * same read for nothing.
 */

const STYLES = ['voxel-bot', 'voxel-art', 'bottts', 'thumbs'] as const;
type Style = (typeof STYLES)[number];

const STYLE_KEY = 'cleat_agent_style';
const VARIANT_KEY = 'cleat_agent_variant';

const readStored = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};

export const AgentStage: React.FC<{
  /** The key this agent belongs to. Its face is derived from this. */
  seed: string;
  mood?: AgentMood;
  /** What the agent is doing, in the fewest words that are true. */
  status?: string;
}> = ({ seed, mood = 'idle', status }) => {
  const [style, setStyle] = useState<Style>(
    () => readStored(STYLE_KEY, 'voxel-bot') as Style,
  );
  // A variant lets somebody change the face without changing the key. The
  // key still decides the default, so two people never start the same.
  const [variant, setVariant] = useState(() => Number(readStored(VARIANT_KEY, '0')) || 0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [dressing, setDressing] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STYLE_KEY, style);
      localStorage.setItem(VARIANT_KEY, String(variant));
    } catch {
      /* a browser that will not remember still shows the default */
    }
  }, [style, variant]);

  /** Follow the pointer, gently, so it reads as an object with a front. */
  const onMove = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setTilt({ x: Math.max(-1, Math.min(1, dy)) * -9, y: Math.max(-1, Math.min(1, dx)) * 14 });
  };

  const faceSeed = variant > 0 ? `${seed}#${variant}` : seed;

  return (
    <div className="agent-stage-wrap">
      <div
        ref={stage}
        className="agent-stage"
        onPointerMove={onMove}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
        onClick={() => {
          // A poke does nothing to the account and is allowed to be fun.
          tactile.selectionTap();
          setTilt((t) => ({ ...t, y: t.y + 24 }));
          setTimeout(() => setTilt({ x: 0, y: 0 }), 260);
        }}
      >
        <div
          className="agent-stage-inner"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <AgentAvatar seed={faceSeed} mood={mood} size={124} style={style} bare />
        </div>
        <span className="agent-stage-shadow" aria-hidden="true" />
      </div>

      <p className="agent-stage-status">{status ?? 'Watching. Nothing to answer for yet.'}</p>

      <button
        type="button"
        className="mesh-chip agent-stage-dress"
        onClick={() => { tactile.selectionTap(); setDressing((d) => !d); }}
        aria-expanded={dressing}
      >
        {dressing ? 'done' : 'change how it looks'}
      </button>

      {dressing && (
        <div className="agent-stage-picker">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className={`agent-style-chip${s === style ? ' is-on' : ''}`}
              onClick={() => { tactile.selectionTap(); setStyle(s); }}
              title={s}
            >
              <AgentAvatar seed={faceSeed} size={34} style={s} />
            </button>
          ))}
          <button
            type="button"
            className="mesh-chip"
            onClick={() => { tactile.mandateAction(); setVariant((v) => (v + 1) % 8); }}
          >
            another face
          </button>
        </div>
      )}
    </div>
  );
};
