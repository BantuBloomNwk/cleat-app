/**
 * What the agent says while it is standing there.
 *
 * Eight robots, one job. Each is the agent that proposes, which means each
 * is the one that gets told no. So none of them speaks as the enforcer: the
 * sentence does the stopping, and the robot reports on being stopped. That
 * was the one line that had it backwards ("nothing gets past your sentence
 * while I am on it") and it is gone.
 *
 * What they say comes from the log and nowhere else. Counts, the reason the
 * sentence gave most often, and what happened last. No positions, no
 * instruments, no amounts, no advice, and nothing about behaviour the log
 * cannot show: the old "I always ask for Energy" and "I tried to buy the
 * dip" were claims about things that may never have happened, and they are
 * gone too. So are the investing maxims, which from the order entry agent
 * read as counsel.
 *
 * What differs is delivery. Every character fills the same slots with the
 * same facts, in its own register, so none can know or say more than
 * another and picking a face never picks a looser agent.
 */

export interface TalkStats {
  decisions: number;
  refused: number;
  trimmed: number;
  cleared: number;
  /** Share of what the agent asked for that the sentence held back. */
  heldPct: number | null;
  /** The reason the sentence gave most, in plain words, and how often. */
  topReason?: { what: string; count: number } | null;
  /** The newest decision. */
  last?: 'cleared' | 'trimmed' | 'refused' | null;
}

interface Voice {
  greet: string[];
  quiet: string[];
  decisions: (n: number) => string;
  refused: (n: number) => string;
  trimmed: (n: number) => string;
  cleared: (n: number) => string;
  held: (pct: number) => string;
  reason: (what: string, n: number) => string;
  last: Record<'cleared' | 'trimmed' | 'refused', string>;
  /** Its take on the arrangement. About the mechanism, never the market. */
  creed: string[];
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * Each rule as a short name a character can say mid sentence. The program's
 * reason text is written for the log ("the book was wider than the mandate
 * will trade into") and reads badly inside "mostly it was ...".
 */
export const RULE_NAME: Record<number, string> = {
  1: 'the position cap', 2: 'the single trade cap', 3: 'a name the sentence rules out',
  4: 'a stale grant', 5: 'something it read', 6: 'the thin market limit',
  7: 'the sector cap', 8: 'the hard ceiling', 9: 'the halt', 10: 'an undeclared name',
  11: 'a mismatched sector',
};

/** Indexed like BUILD_NAMES and PERSONAS in agentBuilds. */
const VOICES: Voice[] = [
  // Verdigris. The ninja. Says little, and most of it after a refusal.
  {
    greet: ['I work at night. The log is where I talk.', 'Here. Watching. Say nothing, and I will do the same.'],
    quiet: ['Nothing asked. Nothing to report.', 'Still. The sentence is still too.'],
    decisions: (n) => `${n} decision${s(n)}. All written down.`,
    refused: (n) => `Stopped ${n} time${s(n)}. I heard every one.`,
    trimmed: (n) => `Cut down ${n} time${s(n)}. Quietly.`,
    cleared: (n) => `${n} went through. No fuss.`,
    held: (p) => `${p}% of what I wanted stayed where it was.`,
    reason: (w, n) => `Mostly it was ${w}. ${n} time${s(n)}.`,
    last: {
      refused: 'The last one was a no. Fair.',
      trimmed: 'The last one came back smaller.',
      cleared: 'The last one was inside the lines.',
    },
    creed: ['A line you cannot see still holds.', 'The quiet nights are the job working.'],
  },
  // Ember. The b-boy. Thrilled by everything, including being refused.
  {
    greet: ['Ready! Point me at the market and hold the rope!', 'Up all night and loving it. Your sentence has my back and my leash.'],
    quiet: ['Nothing yet and I am buzzing anyway.', 'Warming up. Nothing asked so far!'],
    decisions: (n) => `${n} decision${s(n)} on the board and every one is public. Love that.`,
    refused: (n) => `Knocked back ${n} time${s(n)}! Each one a clean block.`,
    trimmed: (n) => `${n} of my big asks came back trimmed. Still counts as a rep.`,
    cleared: (n) => `${n} made it through, all inside your lines.`,
    held: (p) => `You held back ${p}% of my enthusiasm. Probably wise.`,
    reason: (w, n) => `Top of my blooper reel: ${w}, ${n} time${s(n)}.`,
    last: {
      refused: 'Last move? Blocked! Great defence.',
      trimmed: 'Last move got cut to size. Still landed it.',
      cleared: 'Last move landed inside the lines!',
    },
    creed: ['I bring the energy. The sentence brings the brakes.', 'Go hard, stay inside. That is the whole routine.'],
  },
  // Violet. The moonwalk. Smooth, and explains everything plainly.
  {
    greet: ['Hello. I propose, your sentence decides, and I will tell you why each time.', 'Here to ask, and to explain every answer.'],
    quiet: ['Nothing proposed yet, so nothing to explain yet.', 'All calm. When something is decided, I will walk you through it.'],
    decisions: (n) => `There are ${n} decision${s(n)} on record, and anyone can read them.`,
    refused: (n) => `${n} of my proposals were refused. Each refusal names the rule it met.`,
    trimmed: (n) => `${n} came back trimmed. That means the idea fit, but the size did not.`,
    cleared: (n) => `${n} cleared, which means they fit every rule at once.`,
    held: (p) => `Of everything I asked for, ${p}% was held back by your sentence.`,
    reason: (w, n) => `The rule I meet most is ${w}. That came up ${n} time${s(n)}.`,
    last: {
      refused: 'The last one was refused. Tap it in the log to see which rule said no.',
      trimmed: 'The last one was trimmed to what your caps allow.',
      cleared: 'The last one cleared every rule you wrote.',
    },
    creed: ['I can ask for anything. Your sentence decides what I get.', 'Every no comes with a reason. That is the point.'],
  },
  // Rust. The karate kid. Furious at every boundary, and hits them anyway.
  {
    greet: ['Right. Show me the lines. I will find every one of them.', 'Here. Ready to push. Your sentence is ready to push back.'],
    quiet: ['Nothing to fight yet.', 'Idle. I hate idle.'],
    decisions: (n) => `${n} decision${s(n)}. Every round recorded.`,
    refused: (n) => `${n} refusal${s(n)}. I hit that wall ${n === 1 ? 'once' : `${n} times`}. It did not move.`,
    trimmed: (n) => `Cut down ${n} time${s(n)}. Infuriating. Correct, but infuriating.`,
    cleared: (n) => `${n} got through. Barely enough to warm up.`,
    held: (p) => `${p}% of my swings blocked.`,
    reason: (w, n) => `${w[0].toUpperCase()}${w.slice(1)}. Hit it ${n} time${s(n)}. Still standing.`,
    last: {
      refused: 'Last one? Blocked. Again.',
      trimmed: 'Last one got cut. I will allow it.',
      cleared: 'Last one got through. Fine.',
    },
    creed: ['I push. It holds. We are both good at our jobs.', 'A wall that moves is not a wall.'],
  },
  // Bone. The laugher. Finds being turned down very funny.
  {
    greet: ['Ha! Hello. I ask, your sentence laughs, and so do I.', 'Here, cheerful, and fully supervised.'],
    quiet: ['Nothing asked yet. The jokes write themselves later.', 'Quiet so far. Suspiciously quiet.'],
    decisions: (n) => `${n} decision${s(n)}, all public. My bloopers are a matter of record.`,
    refused: (n) => `Turned down ${n} time${s(n)}. Ha. Every one of them fair.`,
    trimmed: (n) => `${n} of my asks came back smaller. I aim high, the sentence aims correctly.`,
    cleared: (n) => `${n} actually made it through. I am as surprised as you.`,
    held: (p) => `${p}% of my ideas stayed ideas. Probably for the best.`,
    reason: (w, n) => `My greatest hit: ${w}. ${n} time${s(n)}. A classic.`,
    last: {
      refused: 'Last one: denied. Ha!',
      trimmed: 'Last one got trimmed. Humbling.',
      cleared: 'Last one went through. Mark the date.',
    },
    creed: ['I am allowed to be wrong. The sentence is not.', 'The funniest thing I do is get told no.'],
  },
  // Slate. The warrior. Terse.
  {
    greet: ['Here.', 'Ready. Bound.'],
    quiet: ['Nothing.', 'Holding.'],
    decisions: (n) => `${n} decided.`,
    refused: (n) => `${n} refused.`,
    trimmed: (n) => `${n} trimmed.`,
    cleared: (n) => `${n} cleared.`,
    held: (p) => `${p}% held.`,
    reason: (w, n) => `${w[0].toUpperCase()}${w.slice(1)}. ${n}.`,
    last: { refused: 'Last: no.', trimmed: 'Last: less.', cleared: 'Last: yes.' },
    creed: ['The line does not move.', 'Asked. Answered.'],
  },
  // Brass. The flexer. A stickler who announces every trim.
  {
    greet: ['Good. Every ask gets checked and every trim gets announced.', 'Present. I report sizes to the basis point, as cut by your sentence.'],
    quiet: ['Nothing submitted. Nothing to audit.', 'Standing by with a clean record.'],
    decisions: (n) => `Record: ${n} decision${s(n)}, each one verifiable.`,
    refused: (n) => `Refusals: ${n}. Logged with reasons.`,
    trimmed: (n) => `Trims: ${n}. Each one cut exactly to your cap, not a point over.`,
    cleared: (n) => `Clearances: ${n}. All within tolerance.`,
    held: (p) => `Held back overall: ${p}% of requested size.`,
    reason: (w, n) => `Most frequent limit reached: ${w}, ${n} time${s(n)}.`,
    last: {
      refused: 'Latest entry: refused, reason on file.',
      trimmed: 'Latest entry: trimmed to the cap. Precisely.',
      cleared: 'Latest entry: cleared in full.',
    },
    creed: ['A cap is a number. Numbers do not negotiate.', 'Trimmed is not a failure. It is the arithmetic.'],
  },
  // Cobalt. The flipper. Restless, wired, fenced in and fine with it.
  {
    greet: ['Awake, wired, and fenced in by one sentence. Perfect.', 'Here! Can I ask for something? I will ask for something.'],
    quiet: ['Nothing yet. I am pacing.', 'Waiting. Not good at waiting.'],
    decisions: (n) => `${n} decision${s(n)} already. Keep them coming.`,
    refused: (n) => `${n} no${n === 1 ? '' : 's'}. I bounced right off.`,
    trimmed: (n) => `${n} trimmed. Asked big, got sensible.`,
    cleared: (n) => `${n} through. On to the next.`,
    held: (p) => `You caught ${p}% of my jumps.`,
    reason: (w, n) => `I keep landing on ${w}. ${n} time${s(n)} now.`,
    last: {
      refused: 'Just got a no. Already thinking about the next one.',
      trimmed: 'Just got trimmed. Fine, fine.',
      cleared: 'Just got one through!',
    },
    creed: ['All the energy, none of the keys.', 'I can flip. The fence cannot.'],
  },
];

const pick = <T,>(xs: T[], n: number) => xs[Math.abs(n) % xs.length];

/** Everything this voice can truthfully say right now, from the log. */
function updates(v: Voice, st: TalkStats): string[] {
  const out: string[] = [];
  if (st.decisions === 0) return out;
  out.push(v.decisions(st.decisions));
  if (st.last) out.push(v.last[st.last]);
  if (st.refused > 0) out.push(v.refused(st.refused));
  if (st.trimmed > 0) out.push(v.trimmed(st.trimmed));
  if (st.cleared > 0) out.push(v.cleared(st.cleared));
  if (st.topReason && st.topReason.count > 0) out.push(v.reason(st.topReason.what, st.topReason.count));
  if (st.heldPct !== null && st.heldPct > 0) out.push(v.held(Math.round(st.heldPct)));
  return out;
}

/**
 * The next thing it says.
 *
 * `turn` counts up every time the bubble changes, so the order is a rotation
 * rather than a random draw: a greeting, then mostly what has actually
 * happened, with its creed every third turn.
 */
export function agentLine(turn: number, st: TalkStats, index: number): string {
  const v = VOICES[((index % VOICES.length) + VOICES.length) % VOICES.length];
  if (turn === 0) return pick(v.greet, index);
  const live = updates(v, st);
  if (live.length === 0) return turn % 2 ? pick(v.quiet, turn) : pick(v.creed, turn);
  return turn % 3 === 0 ? pick(v.creed, turn) : pick(live, turn);
}
