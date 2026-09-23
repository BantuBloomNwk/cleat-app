import React, { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { AgentModel } from './AgentModel';
import { AgentPicker } from './AgentPicker';
import type { AgentMood } from './AgentAvatar';
import { BUILD_NAMES, buildIndex } from '../lib/agentBuilds';
import { setVariant, useAgentVariant } from '../lib/agentLook';
import { agentLine, type TalkStats } from '../lib/agentTalk';
import { tactile } from '../utils/haptics';

/**
 * The agent, in the corner of its own card, saying something.
 *
 * The first version of this put it large and centred at the top of the
 * vault with a caption under it, which is a poster rather than a presence:
 * it took a third of the screen to say nothing and the rest of the card
 * arranged itself awkwardly around it. Now it stands in the corner at a
 * sensible size and the space beside it carries a line that changes, which
 * is a smaller card doing more.
 *
 * The argument for having a character at all is not decoration. A product
 * nobody opens protects nobody, and a screen of verdicts and percentages
 * gives a person no reason to come back however good its guarantees are.
 * The argument against is that making the agent likeable undermines a pitch
 * built on not having to trust it. Both are right, and the resolution is in
 * which moment gets the performance: the refusal is the biggest thing this
 * character does, and it is never more pleased to have cleared a trade than
 * to have stopped one.
 *
 * It is a real object, drawn with a renderer, and it can be turned with a
 * finger. That is worth the weight because "can I spin it" is the whole
 * difference between a picture of a robot and a robot, and because three
 * only loads on the screens that show one.
 */
export const AgentStage: React.FC<{
  /** The key this agent belongs to. Which of the eight it is comes from here. */
  seed: string;
  mood?: AgentMood;
  /** What has actually happened, so it has something true to say. */
  stats: TalkStats;
}> = ({ seed, mood = 'idle', stats }) => {
  const variant = useAgentVariant();
  const [picking, setPicking] = useState(false);
  const [turn, setTurn] = useState(0);
  const [visible, setVisible] = useState(true);

  const index = buildIndex(seed, variant);
  const name = BUILD_NAMES[index % BUILD_NAMES.length];

  // A line that changes on its own, and fades rather than cutting. Nobody
  // watches it change; the point is that it is different when they come
  // back to the tab.
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const tick = window.setInterval(() => {
      setVisible(false);
      const t = window.setTimeout(() => {
        setTurn((n) => n + 1);
        setVisible(true);
      }, 320);
      timers.current.push(t);
    }, 9000);
    return () => {
      window.clearInterval(tick);
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, []);

  // A verdict landing outranks whatever it was in the middle of saying.
  useEffect(() => {
    if (mood === 'idle') return;
    setVisible(false);
    const t = window.setTimeout(() => {
      setTurn((n) => n + 1);
      setVisible(true);
    }, 260);
    return () => window.clearTimeout(t);
  }, [mood]);

  const line = agentLine(turn, stats, index);

  return (
    <>
      <div className="agent-bay">
        <div
          className="agent-bay-model"
          onPointerUp={() => tactile.selectionTap()}
          title="Drag to turn it"
        >
          <AgentModel seed={seed} variant={variant} mood={mood} size={104} autoSpin />
        </div>

        <div className="agent-bay-talk">
          <div className="agent-bay-name">
            <span>{name}</span>
            <button
              type="button"
              className="agent-bay-gear"
              onClick={() => { tactile.selectionTap(); setPicking(true); }}
              aria-label="Choose your agent"
              title="Choose your agent"
            >
              <Settings2 size={13} strokeWidth={2.2} />
            </button>
          </div>

          {/* Announced politely rather than interrupting: somebody reading
              the page with a screen reader should not be dragged back here
              every nine seconds. */}
          <p
            className={`agent-bubble${visible ? ' is-in' : ''}`}
            aria-live="polite"
          >
            {line}
          </p>
        </div>
      </div>

      {picking && (
        <AgentPicker
          seed={seed}
          current={variant}
          onPick={(v) => setVariant(v)}
          onClose={() => {
            setPicking(false);
            // Back in the corner, and it opens its mouth with a hello.
            setTurn(0);
            setVisible(true);
          }}
        />
      )}
    </>
  );
};
