import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { tactile } from '../utils/haptics';

export interface DayTrendPoint {
  day: string;
  /** Basis points, cumulative. */
  cleared: number;
  refused: number;
  clearedCount: number;
  refusedCount: number;
}

/**
 * Nothing, until the chain says otherwise.
 *
 * This held a week of invented dollars: Sunday to Today, cleared against
 * refused, none of it from anywhere. There is no week to draw. The log is a
 * ring of sixteen and every entry in it is recent, so the honest series is
 * the record in order rather than a calendar, and it arrives as a prop.
 */
const DEFAULT_7D_TREND: DayTrendPoint[] = [];

interface D3VolumeSparklineProps {
  data?: DayTrendPoint[];
  compact?: boolean;
  /** Rendered into the header row, so it costs the chart no height. */
  action?: React.ReactNode;
}

export const D3VolumeSparkline: React.FC<D3VolumeSparklineProps> = ({
  data = DEFAULT_7D_TREND,
  compact = false,
  action,
}) => {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    // Not measured at all any more, which is the point.
    //
    // Every version of this that read the container failed the same way:
    // when the card is on a hidden tab the read returns zero, the code
    // falls through to a hard coded fallback wider than the card, and the
    // chart is already drawn too wide before any observer can correct it.
    // A viewBox has no such failure mode. The svg is given a fixed
    // internal coordinate space and told to fill its parent, so the
    // browser scales it to whatever room exists and it cannot, by
    // construction, draw outside its own box.
    const width = 320;
    // The compact one was down to 28px of plot, which flattened a week of
    // trend into two straight lines. The tile has the room, so take it.
    const height = compact ? 64 : 84;
    const margin = { top: 5, right: 16, bottom: compact ? 15 : 18, left: 16 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    // viewBox and nothing else. The width and height attributes are left
    // off on purpose: an svg height attribute has to be a length, so the
    // height="auto" that was here was rejected outright by the browser and
    // the element was left with no usable height, which is what kept the
    // line escaping no matter what else moved. With only a viewBox the
    // browser takes its own aspect ratio from these coordinates and the
    // css below sizes it, so it cannot draw outside its box.
    svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');
    svg.selectAll('*').remove();

    // Gradients
    const defs = svg.append('defs');

    // Cleared Area Gradient
    const clearedGrad = defs
      .append('linearGradient')
      .attr('id', 'sparkClearedGrad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    clearedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.35);
    clearedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    // Refused Area Gradient
    const refusedGrad = defs
      .append('linearGradient')
      .attr('id', 'sparkRefusedGrad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    refusedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#e05243').attr('stop-opacity', 0.28);
    refusedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#e05243').attr('stop-opacity', 0.0);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.day))
      .range([0, innerWidth])
      // No padding, so a point sits exactly at margin.left + i * step and
      // the hover maths below can land on the same day the cursor is over
      // without duplicating d3's own padding arithmetic.
      .padding(0);

    const maxVal = d3.max(data, (d) => Math.max(d.cleared, d.refused)) || 5;
    const yScale = d3.scaleLinear().domain([0, maxVal * 1.15]).range([innerHeight, 0]);

    // Area Generators
    const clearedArea = d3
      .area<DayTrendPoint>()
      .x((d) => xScale(d.day) || 0)
      .y0(innerHeight)
      .y1((d) => yScale(d.cleared))
      .curve(d3.curveMonotoneX);

    const refusedArea = d3
      .area<DayTrendPoint>()
      .x((d) => xScale(d.day) || 0)
      .y0(innerHeight)
      .y1((d) => yScale(d.refused))
      .curve(d3.curveMonotoneX);

    // Line Generators
    const clearedLine = d3
      .line<DayTrendPoint>()
      .x((d) => xScale(d.day) || 0)
      .y((d) => yScale(d.cleared))
      .curve(d3.curveMonotoneX);

    const refusedLine = d3
      .line<DayTrendPoint>()
      .x((d) => xScale(d.day) || 0)
      .y((d) => yScale(d.refused))
      .curve(d3.curveMonotoneX);

    // Draw Areas
    g.append('path')
      .datum(data)
      .attr('fill', 'url(#sparkClearedGrad)')
      .attr('d', clearedArea);

    g.append('path')
      .datum(data)
      .attr('fill', 'url(#sparkRefusedGrad)')
      .attr('d', refusedArea);

    // Draw Lines
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .attr('d', clearedLine);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#e05243')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '3 2')
      .attr('stroke-linecap', 'round')
      .attr('d', refusedLine);

    // Draw End Node Dots
    const lastPoint = data[data.length - 1];
    const lastX = xScale(lastPoint.day) || 0;
    
    // Cleared End Dot
    g.append('circle')
      .attr('cx', lastX)
      .attr('cy', yScale(lastPoint.cleared))
      .attr('r', 3)
      .attr('fill', '#10b981')
      .attr('stroke', 'var(--card-surface)')
      .attr('stroke-width', 1.5);

    // Refused End Dot
    g.append('circle')
      .attr('cx', lastX)
      .attr('cy', yScale(lastPoint.refused))
      .attr('r', 2.5)
      .attr('fill', '#e05243')
      .attr('stroke', 'var(--card-surface)')
      .attr('stroke-width', 1.5);

    // Bottom Day Labels (Compact X-Axis)
    const labelGroup = g.append('g').attr('transform', `translate(0, ${innerHeight + 11})`);
    data.forEach((d, i) => {
      const xPos = xScale(d.day) || 0;
      labelGroup
        .append('text')
        .attr('x', xPos)
        .attr('y', 0)
        .attr('text-anchor', i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle')
        .attr('fill', 'var(--text-tertiary)')
        .attr('font-size', '8.5px')
        .attr('font-family', 'var(--font-mono)')
        .text(d.day);
    });

    // Hover Crosshair & Overlay
    if (hoverIndex !== null && data[hoverIndex]) {
      const activePoint = data[hoverIndex];
      const hX = xScale(activePoint.day) || 0;

      // Vertical line
      g.append('line')
        .attr('x1', hX)
        .attr('x2', hX)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', 'var(--card-border)')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2 2');

      // Cleared hover dot
      g.append('circle')
        .attr('cx', hX)
        .attr('cy', yScale(activePoint.cleared))
        .attr('r', 4)
        .attr('fill', '#10b981')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.5);

      // Refused hover dot
      g.append('circle')
        .attr('cx', hX)
        .attr('cy', yScale(activePoint.refused))
        .attr('r', 4)
        .attr('fill', '#e05243')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.5);
    }
  }, [data, compact, hoverIndex]);

  const activePoint = hoverIndex !== null ? data[hoverIndex] : data[data.length - 1];


  // Nothing recorded yet is a real state and has to render as one, rather
  // than reaching into an empty array for a last point that is not there.
  if (data.length === 0) {
    return (
      <p className="text-[10.5px] leading-[1.6] text-[var(--text-tertiary)]">
        Nothing on the log yet, so there is no line to draw.
      </p>
    );
  }

  return (
    <div className="relative flex flex-col w-full min-w-0" id="d3-volume-sparkline-card">
      {/* The reading for whichever day is under the cursor.
          Compact drops the words Cleared and Refused and leans on the two
          colours instead, because in a tile this narrow the full legend
          wrapped onto three lines and pushed the chart out of the card. */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono mb-1 min-w-0">
        <div className={`flex items-center min-w-0 ${compact ? 'gap-1.5' : 'flex-wrap gap-x-2 gap-y-1'}`}>
          <span className="text-[var(--text-tertiary)] uppercase tracking-wider text-[9px] font-semibold whitespace-nowrap">
            {compact ? activePoint.day : '7D Trend:'}
          </span>
          <span className="text-[var(--verdigris)] font-bold whitespace-nowrap">
            {(activePoint.cleared / 100).toFixed(1)}%{compact ? '' : ' allowed'}
          </span>
          <span className="text-[var(--text-tertiary)]">•</span>
          <span className="text-[var(--refused-rust)] font-bold whitespace-nowrap">
            {(activePoint.refused / 100).toFixed(1)}%{compact ? '' : ' held back'}
          </span>
        </div>
        {action ? (
          <div className="shrink-0">{action}</div>
        ) : (
          <span className="text-[9.5px] text-[var(--text-secondary)] whitespace-nowrap shrink-0">
            {activePoint.day}
          </span>
        )}
      </div>

      {/* SVG Canvas with Interactive Pointer Scrubber */}
      <div
        ref={plotRef}
        className="relative w-full cursor-crosshair touch-none"
        onMouseMove={(e) => {
          if (!plotRef.current) return;
          // Measured against the plot box, not the whole card, and mapped
          // back through the same margins the scale uses. Reading the card
          // was how the crosshair ended up landing on a different day from
          // the one under the cursor.
          const rect = plotRef.current.getBoundingClientRect();
          if (rect.width === 0) return;
          const scale = 320 / rect.width;
          const vbX = (e.clientX - rect.left) * scale - 16;
          const step = (320 - 32) / (data.length - 1);
          const idx = Math.min(
            data.length - 1,
            Math.max(0, Math.round(vbX / step)),
          );
          if (idx !== hoverIndex) {
            setHoverIndex(idx);
            tactile.sliderTick(idx * 15);
          }
        }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          ref={svgRef}
          className="w-full h-auto block overflow-hidden select-none"
          role="img"
          aria-label="7-Day Cleared versus Refused Volume Sparkline"
        />
      </div>
    </div>
  );
};
