import React from 'react';

/**
 * A month of closes, drawn small.
 *
 * Every row on a markets screen should carry its own shape. A number and a
 * percentage say where a thing is and how it moved since yesterday; the line
 * says whether that move is the story or noise, which is the question anyone
 * looking at a price is actually asking.
 */
export const Spark: React.FC<{
  series: number[];
  width?: number;
  height?: number;
  stroke: string;
  fill?: boolean;
}> = ({ series, width = 72, height = 22, stroke, fill = false }) => {
  if (!series || series.length < 2) return null;

  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  // A hair of padding so the extremes are not clipped by the stroke.
  const pad = 1.5;
  const x = (i: number) => (i / (series.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  const d = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const id = `sp${Math.round(series[0] * 1000)}${series.length}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r="2" fill={stroke} />
    </svg>
  );
};
