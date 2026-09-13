import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { tactile } from '../utils/haptics';

interface D3VolumeProgressBarProps {
  refusedVolume: number; // in Millions, e.g. 1.64
  clearedVolume: number; // in Millions, e.g. 3.18
  refusedCount?: number;
  clearedCount?: number;
  timeframeLabel?: string;
  onSimulateVolumeShift?: () => void;
}

export const D3VolumeProgressBar: React.FC<D3VolumeProgressBarProps> = ({
  refusedVolume,
  clearedVolume,
  refusedCount = 64,
  clearedCount = 124,
  timeframeLabel = '24H',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prevRefusedRatio = useRef<number>(34);
  const [activeTooltip, setActiveTooltip] = useState<{
    type: 'refused' | 'cleared';
    x: number;
    volume: string;
    percentage: string;
    count: number;
  } | null>(null);

  const totalVolume = refusedVolume + clearedVolume;
  const refusedRatio = totalVolume > 0 ? (refusedVolume / totalVolume) * 100 : 34;
  const clearedRatio = 100 - refusedRatio;

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 320;
    const height = 48;
    const barHeight = 22;
    const barY = 13;
    const rx = 11;

    const svg = d3.select(svgRef.current);
    svg.attr('width', width).attr('height', height);

    // Clear prior dynamic groups (preserve defs if any)
    svg.selectAll('.d3-chart-content').remove();

    const g = svg.append('g').attr('class', 'd3-chart-content');

    // Defs: Gradients and Glow Filters
    let defs = svg.select('defs');
    if (defs.empty()) {
      defs = svg.append('defs');

      // Refused Rust Gradient
      const refusedGrad = defs
        .append('linearGradient')
        .attr('id', 'd3RefusedGradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');
      refusedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#dc2626');
      refusedGrad.append('stop').attr('offset', '70%').attr('stop-color', '#e05338');
      refusedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f87171');

      // Cleared Verdigris Gradient
      const clearedGrad = defs
        .append('linearGradient')
        .attr('id', 'd3ClearedGradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');
      clearedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0f766e');
      clearedGrad.append('stop').attr('offset', '35%').attr('stop-color', '#14b8a6');
      clearedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#2dd4bf');

      // Capsule Clip Path
      defs
        .append('clipPath')
        .attr('id', 'd3CapsuleClip')
        .append('rect')
        .attr('x', 0)
        .attr('y', barY)
        .attr('width', width)
        .attr('height', barHeight)
        .attr('rx', rx)
        .attr('ry', rx);
    } else {
      // Update clip rect width on resize
      defs.select('#d3CapsuleClip rect').attr('width', width);
    }

    const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);

    // Outer Track Background
    g.append('rect')
      .attr('class', 'd3-track-bg')
      .attr('x', 0)
      .attr('y', barY)
      .attr('width', width)
      .attr('height', barHeight)
      .attr('rx', rx)
      .attr('ry', rx)
      .attr('fill', 'var(--card-surface-raised)')
      .attr('stroke', 'var(--card-border-subtle)')
      .attr('stroke-width', 1);

    // Group clipped inside the capsule
    const barGroup = g.append('g').attr('clip-path', 'url(#d3CapsuleClip)');

    const prevX = xScale(prevRefusedRatio.current);
    const targetX = xScale(refusedRatio);

    // Refused Bar (Left)
    const refusedBar = barGroup
      .append('rect')
      .attr('class', 'd3-bar-refused')
      .attr('x', 0)
      .attr('y', barY)
      .attr('width', prevX)
      .attr('height', barHeight)
      .attr('fill', 'url(#d3RefusedGradient)')
      .style('cursor', 'pointer');

    // Cleared Bar (Right)
    const clearedBar = barGroup
      .append('rect')
      .attr('class', 'd3-bar-cleared')
      .attr('x', prevX)
      .attr('y', barY)
      .attr('width', Math.max(0, width - prevX))
      .attr('height', barHeight)
      .attr('fill', 'url(#d3ClearedGradient)')
      .style('cursor', 'pointer');

    // Diagonal Hazard Micro-Stripes on Refused Bar (military enclosure look)
    const stripeGroup = barGroup
      .append('g')
      .attr('class', 'd3-stripes')
      .style('pointer-events', 'none')
      .style('opacity', 0.25);

    for (let s = -20; s < width; s += 14) {
      stripeGroup
        .append('line')
        .attr('x1', s)
        .attr('y1', barY + barHeight)
        .attr('x2', s + 12)
        .attr('y2', barY)
        .attr('stroke', '#000000')
        .attr('stroke-width', 2.5);
    }

    // Divider Line / Needle Indicator at boundary
    const dividerGroup = g
      .append('g')
      .attr('class', 'd3-divider-group')
      .style('pointer-events', 'none');

    const dividerLine = dividerGroup
      .append('line')
      .attr('x1', prevX)
      .attr('y1', barY - 2)
      .attr('x2', prevX)
      .attr('y2', barY + barHeight + 2)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('filter', 'drop-shadow(0 0 3px rgba(0,0,0,0.6))');

    const dividerCap = dividerGroup
      .append('polygon')
      .attr(
        'points',
        `${prevX - 3.5},${barY - 3} ${prevX + 3.5},${barY - 3} ${prevX},${barY}`
      )
      .attr('fill', '#ffffff');

    // Smooth D3 Transition
    const t = d3.transition().duration(850).ease(d3.easeCubicOut);

    refusedBar.transition(t).attr('width', targetX);

    clearedBar
      .transition(t)
      .attr('x', targetX)
      .attr('width', Math.max(0, width - targetX));

    dividerLine.transition(t).attr('x1', targetX).attr('x2', targetX);

    dividerCap.transition(t).attr(
      'points',
      `${targetX - 3.5},${barY - 3} ${targetX + 3.5},${barY - 3} ${targetX},${barY}`
    );

    // Save previous ratio for next smooth transition
    prevRefusedRatio.current = refusedRatio;

    // Interactive Hover & Click Handlers with Hardware Vibration
    refusedBar
      .on('click', () => {
        tactile.ledgerTrigger('refused');
      })
      .on('mouseenter', (event: MouseEvent) => {
        tactile.selectionTap();
        const rect = container.getBoundingClientRect();
        setActiveTooltip({
          type: 'refused',
          x: Math.min(Math.max(40, targetX / 2), width - 90),
          volume: `$${refusedVolume.toFixed(2)}M`,
          percentage: `${refusedRatio.toFixed(1)}%`,
          count: refusedCount,
        });
        d3.select(event.currentTarget as SVGElement).style('opacity', '0.9');
      })
      .on('mouseleave', (event: MouseEvent) => {
        setActiveTooltip(null);
        d3.select(event.currentTarget as SVGElement).style('opacity', '1');
      });

    clearedBar
      .on('click', () => {
        tactile.ledgerTrigger('cleared');
      })
      .on('mouseenter', (event: MouseEvent) => {
        tactile.selectionTap();
        setActiveTooltip({
          type: 'cleared',
          x: Math.min(Math.max(60, targetX + (width - targetX) / 2), width - 90),
          volume: `$${clearedVolume.toFixed(2)}M`,
          percentage: `${clearedRatio.toFixed(1)}%`,
          count: clearedCount,
        });
        d3.select(event.currentTarget as SVGElement).style('opacity', '0.9');
      })
      .on('mouseleave', (event: MouseEvent) => {
        setActiveTooltip(null);
        d3.select(event.currentTarget as SVGElement).style('opacity', '1');
      });
  }, [refusedVolume, clearedVolume, refusedRatio, clearedRatio, refusedCount, clearedCount]);

  return (
    <div className="flex flex-col gap-2 w-full select-none" ref={containerRef}>
      {/* Top Labels: Status & Values */}
      <div className="flex items-center justify-between font-mono text-[11.5px]">
        <div className="flex items-center gap-1.5 text-[var(--refused-rust)] font-bold">
          <span className="w-2 h-2 rounded-full bg-[var(--refused-rust)] shrink-0" />
          <span>Refused</span>
          <span className="text-[12.5px]">${refusedVolume.toFixed(2)}M</span>
          <span className="text-[10px] opacity-75 font-normal">
            ({refusedRatio.toFixed(1)}%)
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[var(--verdigris)] font-bold">
          <span className="text-[10px] opacity-75 font-normal">
            ({clearedRatio.toFixed(1)}%)
          </span>
          <span className="text-[12.5px]">${clearedVolume.toFixed(2)}M</span>
          <span>Cleared</span>
          <span className="w-2 h-2 rounded-full bg-[var(--verdigris)] shrink-0" />
        </div>
      </div>

      {/* D3 Render Target with Floating Tooltip */}
      <div className="relative w-full overflow-visible">
        <svg
          ref={svgRef}
          className="w-full overflow-visible block"
          style={{ height: '44px' }}
          role="img"
          aria-label={`D3 Volume Ratio: ${refusedRatio.toFixed(1)}% Refused vs ${clearedRatio.toFixed(1)}% Cleared`}
        />

        {/* Dynamic D3 Hover Tooltip */}
        {activeTooltip && (
          <div
            className={`absolute top-0 -translate-y-full -translate-x-1/2 pointer-events-none z-20 px-2.5 py-1.5 rounded-lg border text-center shadow-xl backdrop-blur-md font-mono text-[11px] transition-all duration-150 ${
              activeTooltip.type === 'refused'
                ? 'bg-[var(--refused-chip-bg)] border-[var(--refused-chip-border)] text-[var(--refused-rust)]'
                : 'bg-[var(--verdigris-chip-bg)] border-[var(--verdigris-chip-border)] text-[var(--verdigris)]'
            }`}
            style={{ left: `${activeTooltip.x}px` }}
          >
            <div className="font-extrabold text-[12px]">{activeTooltip.volume} ({activeTooltip.percentage})</div>
            <div className="text-[9.5px] opacity-85">{activeTooltip.count} Intercepted Transactions</div>
          </div>
        )}
      </div>

      {/* Sub-bar Metadata & Ratio Caption */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-tertiary)] -mt-1">
        <span className="flex items-center gap-1">
          <span>Shielded rogue outflow:</span>
          <strong className="text-[var(--refused-rust)]">{refusedRatio.toFixed(0)}%</strong>
        </span>
        <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
          {timeframeLabel} Ratio Visualizer
        </span>
        <span className="flex items-center gap-1">
          <span>Compliant execution:</span>
          <strong className="text-[var(--verdigris)]">{clearedRatio.toFixed(0)}%</strong>
        </span>
      </div>
    </div>
  );
};
