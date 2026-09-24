/**
 * What the agent says while it is standing there.
 *
 * A mascot that only reacts is a widget. The thing that makes somebody look
 * at it twice is that it has something to say, and the thing that keeps it
 * honest is what it is allowed to say. So: nothing about a position, an
 * instrument or an amount, ever, because confidentiality is the product and
 * a chatty mascot is exactly how that leaks. Nothing that reads as advice,
 * because this is a self directed account and the agent is order entry, not
 * counsel. And nothing that congratulates itself for clearing a trade.
 *
 * What is left is plenty: what it has done, what it has been stopped from
 * doing, and the dry observations of something that spends all night asking
 * for things and being told no.
 */

export interface TalkStats {
  decisions: number;
  refused: number;
  trimmed: number;
  cleared: number;
  /** Share of what the agent asked for that the sentence held back. */
  heldPct: number | null;
}

const GREETINGS = [
  'Right. I am yours. Your sentence is the only thing I answer to.',
  'Reporting in. I have read your sentence, and I cannot see what you hold. Both of those are on purpose.',
  'Hello. I am going to ask for a great many things. You have already written down which ones I get.',
  'Here. Awake at the hours you are not, bounded by the line you wrote when you were.',
];

const WISDOM = [
  'A rule you wrote while calm outranks a decision you make while not.',
  'Size is the risk. Direction is only the argument.',
  'The spread is what it costs to change your mind in a hurry.',
  'A limit you can move at two in the morning was never a limit.',
  'Anything that cannot refuse you is not a boundary, it is a suggestion.',
  'Liquidity is the thing you only notice on the way out.',
  'The cheapest trade of the year is usually one that never opened.',
  'Nothing about a quiet night is a failure. It just does not photograph well.',
];

const JOKES = [
  'I asked for Energy again. I always ask for Energy. It has become a hobby.',
  'Someone online says this one only goes up. Your sentence has not read the internet.',
  'I had a brilliant idea at three in the morning. Your sentence had a better one.',
  'My best work this week was a trade I did not get to make.',
  'There is a rumour. There is always a rumour.',
  'I tried to buy the dip. On closer inspection it was a slope.',
  'Nine boundaries, and I have walked into all nine at least once. For science.',
];

const QUIET = [
  'Watching. Nothing has been proposed yet, and your sentence is already standing.',
  'Nothing to answer for. The night is doing its own thing.',
];

const pick = <T,>(xs: T[], n: number) => xs[Math.abs(n) % xs.length];

/** Everything it can currently truthfully say, most interesting first. */
function updates(s: TalkStats): string[] {
  const out: string[] = [];
  if (s.decisions === 0) return out;
  out.push(
    `${s.decisions} decision${s.decisions === 1 ? '' : 's'} on the record, every one of them readable by anybody.`,
  );
  if (s.refused > 0) {
    out.push(
      `I have been turned down ${s.refused} time${s.refused === 1 ? '' : 's'}. I am not sulking about it.`,
    );
  }
  if (s.trimmed > 0) {
    out.push(
      `${s.trimmed} of my asks came back smaller than I wanted. That is the sentence doing arithmetic, not me.`,
    );
  }
  if (s.cleared > 0) {
    out.push(`${s.cleared} got through. They were inside every line you set.`);
  }
  if (s.heldPct !== null && s.heldPct > 0) {
    out.push(`Across everything I asked for, ${Math.round(s.heldPct)}% of it was held back.`);
  }
  return out;
}

/**
 * The next thing it says.
 *
 * `turn` counts up every time the bubble changes, so the order is a rotation
 * rather than a random draw: a greeting to open, then it alternates between
 * what has actually happened and what it thinks about, which keeps it from
 * saying three jokes in a row and from repeating the same count all evening.
 */
export function agentLine(turn: number, s: TalkStats, seed: number): string {
  if (turn === 0) return pick(GREETINGS, seed);

  const live = updates(s);
  if (live.length === 0) {
    return turn % 3 === 1 ? pick(QUIET, seed + turn) : pick(WISDOM, seed + turn);
  }

  switch (turn % 3) {
    case 1:
      return pick(live, seed + turn);
    case 2:
      return pick(WISDOM, seed + turn);
    default:
      return pick(JOKES, seed + turn);
  }
}
