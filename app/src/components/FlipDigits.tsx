import React, { useEffect, useRef, useState } from 'react';

/**
 * Characters that turn over in place when the value behind them changes.
 *
 * Borrowed from the split flap boards that hung in airports, for the
 * reason those boards worked rather than because they are nostalgic: when
 * a number changes, only the part that changed moves, so a glance tells
 * you what moved without reading anything. A price that redraws whole
 * gives you no such signal.
 *
 * Only the characters that actually differ are animated. Re-flipping a
 * digit that did not change is the thing that makes these look like a
 * screensaver instead of a board.
 */
interface FlipDigitsProps {
  value: string;
  className?: string;
  /** Milliseconds a single character takes to turn. */
  speed?: number;
}

export const FlipDigits: React.FC<FlipDigitsProps> = ({
  value,
  className = '',
  speed = 260,
}) => {
  const previous = useRef(value);
  const [flipping, setFlipping] = useState<Set<number>>(new Set());

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (previous.current === value) return;
    if (reduced) {
      previous.current = value;
      return;
    }

    const before = previous.current;
    const changed = new Set<number>();
    const width = Math.max(before.length, value.length);
    for (let i = 0; i < width; i++) {
      if (before[i] !== value[i]) changed.add(i);
    }
    previous.current = value;
    setFlipping(changed);

    // Characters further right settle slightly later, the way a real board
    // cascades, so the eye follows the change instead of catching all of it
    // at once.
    const t = window.setTimeout(() => setFlipping(new Set()), speed + width * 18);
    return () => window.clearTimeout(t);
  }, [value, speed, reduced]);

  return (
    <span className={`flip-digits ${className}`} aria-label={value}>
      {value.split('').map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          aria-hidden="true"
          className={`flip-digit ${flipping.has(i) ? 'is-turning' : ''}`}
          style={flipping.has(i) ? { animationDelay: `${i * 18}ms` } : undefined}
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
};
