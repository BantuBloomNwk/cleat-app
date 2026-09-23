import { useEffect, useRef, useState } from 'react';
import type { AgentMood } from '../components/AgentAvatar';
import { tactile } from '../utils/haptics';

/**
 * One agent, reacting in one place.
 *
 * The flinch used to live inside the log, which is where verdicts are
 * listed, so the character on the vault would sit still through the exact
 * moment it was built for. There is only one agent, so there is only one
 * mood, and it belongs above both screens rather than inside either of
 * them.
 *
 * The ranking is the same one the haptics use. Two verdicts landing in the
 * same poll should read as the more serious of the two, not as a rattle,
 * and the serious one is always the refusal.
 */

export interface Pulse {
  mood: AgentMood;
  /** Rows that landed in the last couple of seconds, so they can announce. */
  arrived: Set<string>;
  /** What the agent is doing, in the fewest words that are true. */
  status: string;
}

interface Entry {
  id: string;
  status: 'refused' | 'trimmed' | 'cleared';
}

const RANK: Record<string, number> = { refused: 2, trimmed: 1, cleared: 0 };

const SAID: Record<string, string> = {
  refused: 'Refused one. It broke the sentence you wrote.',
  trimmed: 'Trimmed one down to what your sentence allows.',
  cleared: 'Cleared one. It was inside every line.',
};

export function useAgentPulse(entries: Entry[]): Pulse {
  const seen = useRef<Set<string> | null>(null);
  const [mood, setMood] = useState<AgentMood>('idle');
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('Watching. Nothing to answer for yet.');

  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id));
    // The first poll is not an arrival. Without this every row in the log
    // would land at once on open and the thing would convulse.
    if (seen.current === null) {
      seen.current = ids;
      if (entries.length > 0) setStatus(`${entries.length} decisions on the record.`);
      return;
    }
    const fresh = entries.filter((e) => !seen.current!.has(e.id));
    const had = seen.current.size;
    seen.current = ids;
    if (fresh.length === 0) return;
    // The seed rows are replaced wholesale the first time the chain answers,
    // and every row in that replacement looks new. Flinching at it would
    // mean the agent recoils on load at a refusal from last Tuesday. A real
    // arrival is a handful of rows on top of the ones already there.
    if (had === 0 || fresh.length === entries.length) return;

    const loudest = fresh.reduce((a, b) =>
      (RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a);
    tactile.ledgerTrigger(loudest.status);
    setMood(loudest.status as AgentMood);
    setStatus(SAID[loudest.status] ?? 'Something landed.');
    setArrived(new Set(fresh.map((e) => e.id)));

    const t = setTimeout(() => setArrived(new Set()), 2200);
    return () => clearTimeout(t);
  }, [entries]);

  return { mood, arrived, status };
}
