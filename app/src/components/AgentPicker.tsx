import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgentModel } from './AgentModel';
import { AgentAvatar } from './AgentAvatar';
import { BUILD_COUNT, BUILD_NAMES, buildIndex, personaOf } from '../lib/agentBuilds';
import { tactile } from '../utils/haptics';

/**
 * Picking which one it is.
 *
 * A grid of thumbnails would have been half the code and it would have been
 * a settings screen. This is a line up: one of them is in front of you,
 * turned to face you, alive and blinking, and the others are waiting their
 * turn on either side. Which one is being considered is never in doubt,
 * because it is the one that is moving.
 *
 * Choosing it does not just close the sheet. The one picked steps forward
 * and says something, which is the entire point of building a character
 * instead of a colour swatch. Then it goes back to the corner of the card
 * and gets on with the job.
 *
 * It goes through a portal because the card it is launched from has a
 * backdrop filter on it, and a filtered ancestor becomes the containing
 * block for anything fixed inside it. The sheet was correctly written as
 * fixed to the viewport and was landing halfway down the vault.
 */
export const AgentPicker: React.FC<{
  seed: string;
  /** Where it opens, which is wherever they already are. */
  current: number;
  onPick: (variant: number) => void;
  onClose: () => void;
}> = ({ seed, current, onPick, onClose }) => {
  const [at, setAt] = useState(current);
  const [chosen, setChosen] = useState<number | null>(null);

  // Escape closes it, because a sheet that traps somebody is a bad sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (chosen !== null) return;
      if (e.key === 'ArrowRight') setAt((v) => (v + 1) % BUILD_COUNT);
      if (e.key === 'ArrowLeft') setAt((v) => (v - 1 + BUILD_COUNT) % BUILD_COUNT);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, chosen]);

  const step = (d: 1 | -1) => {
    tactile.selectionTap();
    setAt((v) => (v + d + BUILD_COUNT) % BUILD_COUNT);
  };

  const name = BUILD_NAMES[buildIndex(seed, at) % BUILD_NAMES.length];

  // The reveal. Picked, stepped forward, mid wave.
  if (chosen !== null) {
    const chosenName = BUILD_NAMES[buildIndex(seed, chosen) % BUILD_NAMES.length];
    return createPortal(
      <div className="agent-sheet-scrim" onClick={onClose}>
        <div className="agent-sheet agent-sheet-reveal" onClick={(e) => e.stopPropagation()}>
          {/* Not spinning here. The line up turns them so you can see what
              you are choosing; the reveal is the one moment the move itself
              has to read, and a camera orbit during a kick hides the kick. */}
          <AgentModel seed={seed} variant={chosen} mood="greet" size={230} />
          <h3 className="agent-reveal-name">{chosenName}</h3>
          <p className="agent-reveal-line">{personaOf(buildIndex(seed, chosen)).line}</p>
          <button
            type="button"
            className="btn-inject"
            onClick={() => { tactile.mandateAction(); onClose(); }}
          >
            Put it to work
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="agent-sheet-scrim" onClick={onClose}>
      <div
        className="agent-sheet"
        role="dialog"
        aria-label="Choose your agent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-sheet-head">
          <span className="meta-kicker">Choose your agent</span>
          <button type="button" className="agent-sheet-x" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <p className="agent-sheet-note">
          Eight of them, each with its own temper and its own way of showing
          off. Your key picked the one you started with. None of this touches
          the account: it is a face, and it is only stored in this browser.
        </p>

        {/* The line up. The one in the middle is a live render and the ones
            beside it are stills, because eight canvases is eight canvases. */}
        <div className="agent-lineup">
          <button type="button" className="shelf-arrow" onClick={() => step(-1)} aria-label="previous">
            &#8249;
          </button>

          <div className="agent-lineup-rail">
            {[-1, 0, 1].map((off) => {
              const v = (at + off + BUILD_COUNT * 2) % BUILD_COUNT;
              if (off === 0) {
                return (
                  <div key="live" className="agent-lineup-live">
                    <AgentModel seed={seed} variant={v} size={168} autoSpin />
                  </div>
                );
              }
              return (
                <button
                  key={off}
                  type="button"
                  className={`agent-lineup-side off${Math.abs(off)}`}
                  onClick={() => { tactile.selectionTap(); setAt(v); }}
                  aria-label={`show ${BUILD_NAMES[buildIndex(seed, v) % BUILD_NAMES.length]}`}
                >
                  <AgentAvatar seed={seed} variant={v} size={58} />
                </button>
              );
            })}
          </div>

          <button type="button" className="shelf-arrow" onClick={() => step(1)} aria-label="next">
            &#8250;
          </button>
        </div>

        <p className="agent-lineup-name">
          {name}
          {/* What this one is like, because the eight are no longer the same
              robot in eight colours and the picker should say so. */}
          <span className="agent-lineup-mood">{personaOf(buildIndex(seed, at)).mood}</span>
        </p>

        <div className="agent-lineup-dots" aria-hidden="true">
          {Array.from({ length: BUILD_COUNT }, (_, i) => (
            <span key={i} className={i === at ? 'on' : ''} />
          ))}
        </div>

        <button
          type="button"
          className="btn-inject"
          onClick={() => {
            tactile.mandateAction();
            onPick(at);
            setChosen(at);
          }}
        >
          {at === current ? 'Keep this one' : 'This one'}
        </button>

        <p className="agent-sheet-hint">Drag it to turn it around.</p>
      </div>
    </div>,
    document.body,
  );
};
