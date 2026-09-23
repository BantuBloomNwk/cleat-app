import React from 'react';

/**
 * Where a number on this screen came from.
 *
 * Some of what this app shows is read live, off Solana or off the venue,
 * and some of it is written to illustrate a flow that has no traffic on it
 * yet. Both are legitimate in a product this young. Letting a reader guess
 * which is which is not.
 *
 * So every card says. It costs a few pixels, it is the first thing a
 * sceptical reader looks for, and a product whose whole argument is that
 * you should not have to trust it cannot be coy about its own numbers.
 */
export type Origin = 'chain' | 'venue' | 'sample';

const COPY: Record<Origin, { label: string; title: string }> = {
  chain: {
    label: 'live, on chain',
    title:
      'Read from the Cleat program on Solana devnet at the moment this loaded. Nothing here is written by hand.',
  },
  venue: {
    label: 'live, from the venue',
    title:
      "Read from Backpack's public market data, which needs no key. Prices, the book and the session calendar are whatever the venue is quoting right now.",
  },
  sample: {
    label: 'sample',
    title:
      'Written to show the shape of the thing. The mechanism underneath is real and the numbers in this particular card are not.',
  },
};

export const DataOrigin: React.FC<{ origin: Origin; className?: string }> = ({
  origin,
  className = '',
}) => {
  const { label, title } = COPY[origin];
  const live = origin !== 'sample';
  return (
    <span
      className={`data-origin ${live ? 'is-live' : 'is-sample'} ${className}`}
      title={title}
    >
      <span className="data-origin-pip" aria-hidden="true" />
      {/* Live says nothing a reader was not already assuming.
          Saying it on every card, six times down one scroll, stopped it
          being read at all, and buried the one variant that carries
          information. So live is a dot with the explanation on hover, and
          sample keeps its word. The honesty is unchanged: anything not
          marked is live, and anything that is not gets a label you cannot
          miss. */}
      {live ? <span className="sr-only">{label}</span> : label}
    </span>
  );
};
