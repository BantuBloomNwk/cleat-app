import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';

/**
 * A chart somebody can actually read a price off.
 *
 * A line alone says the shape and nothing else. Anyone looking at a market
 * wants to know what it was on a particular day, which means the line has to
 * answer being pointed at: a crosshair, the price under it, the date, and how
 * far that point sits from where the series began.
 *
 * Touch and mouse are the same gesture here. Dragging along the chart scrubs
 * it, which is how every trading app behaves on a phone, and phones are the
 * stated primary surface.
 */
interface Props {
  series: number[];
  /** Unix seconds per point, when the source carries them. */
  at?: number[];
  label: string;
  stroke: string;
  height?: number;
  /** Offers the pop out. The popped out copy does not offer it again. */
  expandable?: boolean;
}

const money = (n: number) =>
  n >= 1000 ? `$${n.toFixed(0)}` : n >= 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

const dayLabel = (t?: number) =>
  t
    ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '';

const Chart: React.FC<Props & { onExpand?: () => void }> = ({
  series,
  at,
  label,
  stroke,
  height = 150,
  expandable,
  onExpand,
}) => {
  const [i, setI] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const W = 1000;
  const H = 300;
  const PAD = 10;

  const { lo, hi, d, area, x, y } = useMemo(() => {
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const span = hi - lo || 1;
    const x = (n: number) => (n / (series.length - 1)) * W;
    const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
    const d = series
      .map((v, n) => `${n === 0 ? 'M' : 'L'}${x(n).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
    return { lo, hi, d, area: `${d} L${W},${H} L0,${H} Z`, x, y };
  }, [series]);

  // Where the pointer is, in points rather than pixels.
  const scrub = useCallback(
    (clientX: number) => {
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      setI(Math.round(frac * (series.length - 1)));
    },
    [series.length],
  );

  const active = i === null ? series.length - 1 : i;
  const price = series[active];
  const first = series[0];
  const change = first > 0 ? ((price - first) / first) * 100 : 0;
  const gid = `g${label.replace(/\W/g, '')}${series.length}`;

  return (
    <div className="flex flex-col gap-1.5 w-full min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[15px] font-bold text-[var(--text-primary)] tabular-nums">
            {money(price)}
          </span>
          <span
            className="font-mono text-[11.5px] tabular-nums"
            style={{ color: change >= 0 ? 'var(--verdigris)' : 'var(--refused-rust)' }}
          >
            {change >= 0 ? '+' : '−'}
            {Math.abs(change).toFixed(2)}%
          </span>
          {i !== null && at?.[active] && (
            <span className="font-mono text-[10.5px] text-[var(--text-tertiary)]">
              {dayLabel(at[active])}
            </span>
          )}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open this chart larger"
            className="flex items-center gap-1 text-[10.5px] font-mono text-[var(--text-tertiary)] hover:text-[var(--verdigris)] transition-colors shrink-0"
          >
            <Maximize2 size={11} />
            <span>expand</span>
          </button>
        )}
      </div>

      <div
        ref={box}
        className="relative w-full touch-pan-y select-none"
        style={{ height }}
        onMouseMove={(e) => scrub(e.clientX)}
        onMouseLeave={() => setI(null)}
        onTouchStart={(e) => scrub(e.touches[0].clientX)}
        onTouchMove={(e) => scrub(e.touches[0].clientX)}
        onTouchEnd={() => setI(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full block"
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Three rules, so the eye has something to measure against. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={PAD + f * (H - PAD * 2)}
              y2={PAD + f * (H - PAD * 2)}
              stroke="var(--card-border-subtle)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#${gid})`} />
          <path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {i !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1="0"
              y2={H}
              stroke={stroke}
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity="0.7"
            />
          )}
          <circle
            cx={x(active)}
            cy={y(price)}
            r="4"
            fill={stroke}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] text-[var(--text-tertiary)] tabular-nums">
        <span>{money(lo)}</span>
        <span>
          {series.length} days
          {at?.[0] ? ` from ${dayLabel(at[0])}` : ''}
        </span>
        <span>{money(hi)}</span>
      </div>
    </div>
  );
};

export const PriceChart: React.FC<Props> = (props) => {
  const [big, setBig] = useState(false);

  return (
    <>
      <Chart {...props} expandable onExpand={() => setBig(true)} />
      {big &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setBig(false);
            }}
          >
            <div className="onboarding-card max-w-[560px] w-full">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--card-border-subtle)] pb-2.5 mb-3">
                <h3 className="font-wordmark text-[15px] font-bold text-[var(--text-primary)]">
                  {props.label}
                </h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setBig(false)}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X size={18} />
                </button>
              </div>
              <Chart {...props} height={260} />
              <p className="text-[10.5px] leading-[1.6] text-[var(--text-tertiary)] mt-3">
                Drag across the chart to read a price on any day. Published by
                Pyth, daily closes, and the same series the agent is working
                against.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
