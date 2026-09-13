import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { tactile } from '../utils/haptics';

export interface DayTrendPoint {
  day: string;
  cleared: number; // $M
  refused: number; // $M
  clearedCount: number;
  refusedCount: number;
}

const DEFAULT_7D_TREND: DayTrendPoint[] = [
  { day: 'Sun', cleared: 2.85, refused: 1.62, clearedCount: 710, refusedCount: 390 },
  { day: 'Mon', cleared: 3.42, refused: 1.34, clearedCount: 840, refusedCount: 310 },
  { day: 'Tue', cleared: 3.15, refused: 1.88, clearedCount: 790, refusedCount: 430 },
  { day: 'Wed', cleared: 3.94, refused: 1.25, clearedCount: 960, refusedCount: 280 },
  { day: 'Thu', cleared: 3.72, refused: 1.10, clearedCount: 910, refusedCount: 250 },
  { day: 'Fri', cleared: 4.18, refused: 1.55, clearedCount: 1040, refusedCount: 370 },
  { day: 'Today', cleared: 4.26, refused: 1.48, clearedCount: 1084, refusedCount: 336 },
];

interface D3VolumeSparklineProps {
  data?: DayTrendPoint[];
  compact?: boolean;
}

export const D3VolumeSparkline: React.FC<D3VolumeSparklineProps> = ({
  data = DEFAULT_7D_TREND,
  compact = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    // Measured, never guessed. The old fallback of 240 was wider than the
    // card on a small phone, so the chart drew past its own edge before a
    // measurement ever arrived.
    const width = Math.max(160, container.clientWidth || container.getBoundingClientRect().width || 240);
    const height = compact ? 52 : 68;
    const margin = { top: 6, right: 14, bottom: 18, left: 14 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.attr('width', width).attr('height', height);
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
      .padding(0.1);

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
    const labelGroup = g.append('g').attr('transform', `translate(0, ${innerHeight + 12})`);
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
  }, [data, compact, hoverIndex, containerWidth]);

  // A width read once is a width that is wrong after a rotation, a tab
  // switch that reveals a hidden card, or any layout change. Watch the
  // container instead of trusting the first measurement.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activePoint = hoverIndex !== null ? data[hoverIndex] : data[data.length - 1];

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col w-full min-w-[200px]"
      id="d3-volume-sparkline-card"
    >
      {/* Sparkline Top Insight & Legend */}
      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-tertiary)] uppercase tracking-wider text-[9px] font-semibold">
            7D Trend:
          </span>
          <span className="text-[var(--verdigris)] font-bold">
            ${activePoint.cleared.toFixed(2)}M Cleared
          </span>
          <span className="text-[var(--text-tertiary)]">•</span>
          <span className="text-[var(--refused-rust)] font-bold">
            ${activePoint.refused.toFixed(2)}M Refused
          </span>
        </div>
        <span className="text-[9.5px] text-[var(--text-secondary)]">
          {activePoint.day}
        </span>
      </div>

      {/* SVG Canvas with Interactive Pointer Scrubber */}
      <div
        className="relative cursor-crosshair touch-none"
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          const stepWidth = rect.width / data.length;
          const idx = Math.min(data.length - 1, Math.max(0, Math.floor(relX / stepWidth)));
          if (idx !== hoverIndex) {
            setHoverIndex(idx);
            tactile.sliderTick(idx * 15);
          }
        }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          ref={svgRef}
          className="w-full block overflow-hidden select-none"
          role="img"
          aria-label="7-Day Cleared versus Refused Volume Sparkline"
        />
      </div>
    </div>
  );
};
