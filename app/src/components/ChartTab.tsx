import { ExpandSheet, ExpandButton } from './ExpandSheet';
import { LiveInstrument } from './LiveInstrument';
import { CrossIssuer } from './CrossIssuer';
import { DataOrigin } from './DataOrigin';
import { useTilt3D } from '../utils/useTilt3D';
import { symbolTicker, loadTickers, loadDepth, bookQuality } from '../lib/backpack';
import React, { useState, useEffect, useRef } from 'react';
import { ChartMarker, SocialTradeMessage } from '../types';
import { TIMEFRAME_CONFIGS, INITIAL_SOCIAL_TRADE_MESSAGES } from '../data/initialData';
import { tactile } from '../utils/haptics';
import { D3VolumeProgressBar } from './D3VolumeProgressBar';
import { D3VolumeSparkline } from './D3VolumeSparkline';
import { DataInsightsModal } from './DataInsightsModal';

interface ChartTabProps {
  markers: ChartMarker[];
  onOpenTickDrawer: () => void;
  /** The widest book the mandate will trade into. Zero means unset. */
  maxSpreadBps: number;
}

const TIMEFRAME_VOLUMES: Record<
  '1H' | '24H' | '7D' | '30D' | '1Y' | 'ALL',
  {
    refused: number;
    cleared: number;
    totalFormatted: string;
    txCount: number;
    refusedCount: number;
    clearedCount: number;
  }
> = {
  '1H': { refused: 0.14, cleared: 0.42, totalFormatted: '$0.56M', txCount: 22, refusedCount: 7, clearedCount: 15 },
  '24H': { refused: 1.64, cleared: 3.18, totalFormatted: '$4.82M', txCount: 188, refusedCount: 64, clearedCount: 124 },
  '7D': { refused: 8.92, cleared: 19.68, totalFormatted: '$28.60M', txCount: 940, refusedCount: 290, clearedCount: 650 },
  '30D': { refused: 27.30, cleared: 66.90, totalFormatted: '$94.20M', txCount: 3820, refusedCount: 1110, clearedCount: 2710 },
  '1Y': { refused: 198.50, cleared: 441.50, totalFormatted: '$640.0M', txCount: 24600, refusedCount: 7600, clearedCount: 17000 },
  'ALL': { refused: 384.00, cleared: 856.00, totalFormatted: '$1.24B', txCount: 48900, refusedCount: 15150, clearedCount: 33750 },
};

export const ChartTab: React.FC<ChartTabProps> = ({
  onOpenTickDrawer,
  maxSpreadBps,
}) => {
  const [activeTimeframe, setActiveTimeframe] = useState<'1H' | '24H' | '7D' | '30D' | '1Y' | 'ALL'>('30D');
  const [is3DActive, setIs3DActive] = useState(false);
  const [showKernelLayers, setShowKernelLayers] = useState(false);
  const [isCopiedAlert, setIsCopiedAlert] = useState(false);
  // which card has been opened for a closer look, if any
  const [expanded, setExpanded] = useState<null | 'volume' | 'trend' | 'chart'>(null);
  // Defaults to a spot tokenized share rather than a perpetual, and the
  // reason is legal rather than aesthetic.
  //
  // A perpetual on a single name is a cash settled derivative with no
  // share behind it, which makes it a security based swap, which US rules
  // keep away from retail entirely. The spot token is the actual
  // entitlement, it is the thing that can sit in a wallet without anyone's
  // permission, and it is the one our framing survives on. Perps stay in
  // the picker because they are where the liquidity is, and they are
  // labelled.
  const [instrument, setInstrument] = useState('MU.US_USDC');
  const tilt = useTilt3D(is3DActive);

  // What the venue's own book says about the selected name, so the
  // comparison against the other issuers is complete rather than missing
  // the one row we already have.
  const [venuePrice, setVenuePrice] = useState<number | null>(null);
  const [venueDepth, setVenueDepth] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    loadTickers().then((ts) => {
      if (!live || !ts) return;
      const t = ts.find((x) => x.symbol === instrument);
      setVenuePrice(t ? Number(t.lastPrice) : null);
    });
    loadDepth(instrument).then((d) => {
      if (!live) return;
      const q = bookQuality(d);
      setVenueDepth(q ? q.nearDepthUsd : null);
    });
    return () => {
      live = false;
    };
  }, [instrument]);
  const [traderDetailTab, setTraderDetailTab] = useState<'telemetry' | 'counterfactual' | 'proof'>('telemetry');
  const [copiedProof, setCopiedProof] = useState(false);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [insightsMarker, setInsightsMarker] = useState<ChartMarker | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  const handleCopyProof = (hash: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(hash);
      }
      setCopiedProof(true);
      tactile.mandateAction();
      setTimeout(() => setCopiedProof(false), 2200);
    } catch {
      setCopiedProof(true);
      setTimeout(() => setCopiedProof(false), 2200);
    }
  };

  const currentConfig = TIMEFRAME_CONFIGS[activeTimeframe] || TIMEFRAME_CONFIGS['30D'];
  const activeMarkers = currentConfig.markers || [];

  const [selectedMarker, setSelectedMarker] = useState<ChartMarker>(activeMarkers[0] || null);
  const [scrubberVal, setScrubberVal] = useState(activeMarkers[0]?.cx || 170);
  const [isDraggingSvg, setIsDraggingSvg] = useState(false);

  // Social Trading Feed State
  const [messages, setMessages] = useState<SocialTradeMessage[]>(INITIAL_SOCIAL_TRADE_MESSAGES);
  const [newMsgText, setNewMsgText] = useState('');
  const [isCopierSynced, setIsCopierSynced] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Price calculations along the wave
  const norm = (scrubberVal - 25) / (340 - 25);
  const simPrice = (98.40 + norm * 16.40).toFixed(2);
  const simY = 145 - norm * 88;
  const isImpulsePeak = scrubberVal > 155 && scrubberVal < 195;

  const handleTimeframeChange = (tf: '1H' | '24H' | '7D' | '30D' | '1Y' | 'ALL') => {
    setActiveTimeframe(tf);
    tactile.selectionTap();
    const newConfig = TIMEFRAME_CONFIGS[tf];
    if (newConfig && newConfig.markers.length > 0) {
      setSelectedMarker(newConfig.markers[0]);
      setScrubberVal(newConfig.markers[0].cx);
    }
  };

  const currentVolume = TIMEFRAME_VOLUMES[activeTimeframe] || TIMEFRAME_VOLUMES['24H'];

  const handleMarkerSelect = (marker: ChartMarker) => {
    setSelectedMarker(marker);
    setScrubberVal(marker.cx);
    tactile.ledgerTrigger(marker.status);
  };

  const handleMarkerTap = (marker: ChartMarker) => {
    setSelectedMarker(marker);
    setScrubberVal(marker.cx);
    setInsightsMarker(marker);
    setIsInsightsOpen(true);
    tactile.ledgerTrigger(marker.status);
  };

  const updateScrubberFromClientX = (clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xPos = ((clientX - rect.left) / rect.width) * 360;
    const clampedX = Math.round(Math.max(25, Math.min(340, xPos)));
    setScrubberVal(clampedX);
    tactile.sliderTick(clampedX);

    // Auto-snap to nearest marker if close
    const nearest = activeMarkers.find((m) => Math.abs(m.cx - clampedX) < 18);
    if (nearest && nearest.id !== selectedMarker?.id) {
      setSelectedMarker(nearest);
      tactile.ledgerTrigger(nearest.status);
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDraggingSvg(true);
    updateScrubberFromClientX(e.clientX);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDraggingSvg) {
      updateScrubberFromClientX(e.clientX);
    }
  };

  const handleSvgPointerUp = () => {
    setIsDraggingSvg(false);
  };

  // Quick navigation helpers
  const handleJumpPrevMarker = () => {
    const currentIndex = activeMarkers.findIndex((m) => m.id === selectedMarker?.id);
    if (currentIndex > 0) {
      handleMarkerSelect(activeMarkers[currentIndex - 1]);
    } else if (activeMarkers.length > 0) {
      handleMarkerSelect(activeMarkers[activeMarkers.length - 1]);
    }
  };

  const handleJumpNextMarker = () => {
    const currentIndex = activeMarkers.findIndex((m) => m.id === selectedMarker?.id);
    if (currentIndex < activeMarkers.length - 1) {
      handleMarkerSelect(activeMarkers[currentIndex + 1]);
    } else if (activeMarkers.length > 0) {
      handleMarkerSelect(activeMarkers[0]);
    }
  };

  const handleJumpLiveHead = () => {
    setScrubberVal(340);
    tactile.selectionTap();
  };

  // Social message submit
  const handleSendSocialMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMsgText.trim()) return;

    const newMsg: SocialTradeMessage = {
      id: `msg-${Date.now()}`,
      sender: 'you.sol',
      avatar: 'ME',
      badge: 'Active Copier',
      time: 'Just now',
      text: newMsgText.trim(),
      isEnforcer: true,
      likes: 1,
    };

    setMessages([newMsg, ...messages]);
    setNewMsgText('');
    tactile.mandateAction();
  };

  const handleLikeMessage = (id: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, likes: msg.likes + 1 } : msg
      )
    );
    tactile.selectionTap();
  };

  const handleToggleSync = () => {
    setIsCopierSynced(!isCopierSynced);
    setIsCopiedAlert(true);
    tactile.mandateAction();
    setTimeout(() => setIsCopiedAlert(false), 2400);
  };

  return (
    <section className="tab-screen active flex flex-col gap-3.5 w-full pb-12" id="view-chart">
      {/* Section Header */}
      <div className="section-row-header">
        <h2 className="section-heading text-[16px] font-bold">Protection Geometry</h2>
        <span className="flex items-center gap-2">
          <span className="section-hint text-[11px]">Live price, sample refusals</span>
          <DataOrigin origin="venue" />
        </span>
      </div>

      <div className="glass-card flex flex-col gap-3" id="protection-geometry-card">
        {/* Card Topbar */}
        <div className="card-topbar">
          {/* The real instrument, priced by the venue the agent trades
              on, replacing a token that did not exist. */}
          <LiveInstrument symbol={instrument} onSelect={setInstrument} />
          <div className="flex gap-1.5 items-center">
            <button
              id="perspectiveToggleBtn"
              type="button"
              className={`mode-switch-pill ${is3DActive ? 'active border-[var(--ember)] text-[var(--ember)]' : ''}`}
              onClick={() => setIs3DActive(!is3DActive)}
              title="Toggle 3D View"
            >
              <span>3D Mesh</span>
            </button>
            <span className="immutable-chip" id="refusalsCountChip">
              {currentConfig.refusalsCountText}
            </span>
          </div>
        </div>

        {/* Separated & Spacious Timeframe Segmented Bar */}
        <div className="timeframe-bar" id="timeframe-bar" role="tablist" aria-label="Chart timeframes">
          {(['1H', '24H', '7D', '30D', '1Y', 'ALL'] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              role="tab"
              aria-selected={activeTimeframe === tf}
              className={`timeframe-btn ${activeTimeframe === tf ? 'active' : ''}`}
              onClick={() => handleTimeframeChange(tf)}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* The plot, and in 3D mode something you can actually turn.
            The scrubbing gestures stay with the svg, marked data-no-tilt,
            so reading a day and turning the panel do not fight. */}
        <div
          ref={tilt.ref}
          id="chartWrapper3D"
          className={`chart-wrapper-3d ${is3DActive ? 'perspective-active' : ''} ${
            tilt.isDragging ? 'is-turning' : ''
          }`}
          role={is3DActive ? 'application' : undefined}
          aria-label={is3DActive ? 'Three dimensional chart. Drag or use the arrow keys to turn it, Escape to reset.' : undefined}
          tabIndex={is3DActive ? 0 : undefined}
          onPointerDown={tilt.onPointerDown}
          onPointerMove={tilt.onPointerMove}
          onPointerUp={tilt.onPointerUp}
          onPointerCancel={tilt.onPointerUp}
          onKeyDown={tilt.onKeyDown}
          onDoubleClick={tilt.reset}
        >
          {is3DActive && (
            <div className="tilt-hint" aria-hidden="true">
              drag to turn · double tap to reset
            </div>
          )}
          <svg
            ref={svgRef}
            id="chartSvgBox"
            data-no-tilt
            aria-label="Interactive simulated wave price chart"
            className="chart-canvas-box"
            viewBox="0 0 360 185"
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
          >
            <defs>
              <linearGradient id="curveGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="var(--text-tertiary)" stopOpacity="0.45" />
                <stop offset="40%" stopColor="var(--verdigris)" stopOpacity="0.8" />
                <stop offset="80%" stopColor="var(--ember)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--verdigris)" stopOpacity="1" />
              </linearGradient>

              <linearGradient id="areaFillGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--verdigris)" stopOpacity="0.32" />
                <stop offset="50%" stopColor="var(--verdigris)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="var(--verdigris)" stopOpacity="0.0" />
              </linearGradient>

              <linearGradient id="ceilingGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="var(--refused-rust)" stopOpacity="0.3" />
                <stop offset="50%" stopColor="var(--refused-rust)" stopOpacity="0.8" />
                <stop offset="100%" stopColor="var(--refused-rust)" stopOpacity="0.4" />
              </linearGradient>
            </defs>

            {/* Price Level Horizontal Guidelines & Labels */}
            {currentConfig.priceLevels.map((lvl) => (
              <g key={`price-${lvl.label}`}>
                <line
                  stroke="var(--card-border-subtle)"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                  x1="28"
                  x2="350"
                  y1={lvl.y}
                  y2={lvl.y}
                />
                <text
                  x="6"
                  y={lvl.y + 3.5}
                  fill="var(--text-tertiary)"
                  fontSize="8.5"
                  fontFamily="var(--font-mono)"
                >
                  {lvl.label}
                </text>
              </g>
            ))}

            {/* Time Interval Vertical Guidelines & Axis Ticks */}
            {currentConfig.timeIntervals.map((interval) => (
              <g key={`interval-${interval.label}`}>
                <line
                  stroke="var(--card-border-subtle)"
                  strokeDasharray="2 3"
                  strokeWidth="0.8"
                  x1={interval.x}
                  x2={interval.x}
                  y1="25"
                  y2="160"
                  opacity="0.65"
                />
                <circle
                  cx={interval.x}
                  cy="160"
                  r="1.5"
                  fill="var(--text-tertiary)"
                />
                <text
                  x={interval.x}
                  y="173"
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  {interval.label}
                </text>
              </g>
            ))}

            {/* Mandate Ceiling Barrier Band.
                The boundary plane. It sits furthest back when the panel is
                turned, because the price and the refusals are read against
                it rather than the other way round. */}
            {currentConfig.ceilingPath && (
              <g className="layer-boundary">
                <path
                  d={currentConfig.ceilingPath}
                  fill="none"
                  stroke="url(#ceilingGrad)"
                  strokeDasharray="4 3"
                  strokeWidth="1.6"
                />
                <text
                  x="50"
                  y="24"
                  fill="var(--refused-rust)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  opacity="0.85"
                >
                  ▲ Mandate Ceiling Barrier
                </text>
              </g>
            )}

            {/* Preservation Support Floor Band */}
            {currentConfig.floorPath && (
              <g>
                <path
                  d={currentConfig.floorPath}
                  fill="none"
                  stroke="var(--verdigris)"
                  strokeDasharray="4 3"
                  strokeWidth="1.4"
                  opacity="0.55"
                />
                <text
                  x="50"
                  y="160"
                  fill="var(--verdigris)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  opacity="0.75"
                >
                  ▼ Capital Preservation Floor
                </text>
              </g>
            )}

            {/* The price plane, between the boundary behind it and the
                refusals in front. */}
            <g className="layer-price">
            {/* Dynamic Wave Area Fill */}
            <path
              id="chartAreaFillPath"
              d={currentConfig.areaFillPath}
              fill="url(#areaFillGrad)"
            />

            {/* Simulated Primary Wave Trajectory Curve */}
            <path
              id="chartTrajectoryPath"
              d={currentConfig.trajectoryPath}
              fill="none"
              stroke="url(#curveGrad)"
              strokeLinecap="round"
              strokeWidth="2.8"
            />

            {/* Live Head Pulse Beacon */}
            <circle
              className="radar-ring"
              cx="340"
              cy="44"
              r="6"
              fill="none"
              stroke="var(--verdigris)"
              strokeWidth="1.2"
            />
            <circle
              cx="340"
              cy="44"
              r="3.5"
              fill="var(--verdigris)"
            />

            {/* Interactive Crosshair & Simulated Price Tracker */}
            <line
              id="chartCrosshairV"
              className="chart-crosshair-line"
              x1={scrubberVal}
              x2={scrubberVal}
              y1="20"
              y2="160"
            />
            <circle
              id="chartCrosshairPoint"
              className="chart-crosshair-handle"
              cx={scrubberVal}
              cy={simY}
              r="5"
            />

            </g>

            {/* Event Dots with Status Rings & Interactive Hover/Tap Preview.
                Nearest the viewer, so a refused trade occludes the boundary
                it broke rather than hiding behind it. Occlusion is one of
                only three depth cues a flat screen has; this is spending
                one of them on the thing the product is about. */}
            <g id="chartMarkersGroup" className="layer-marks">
              {activeMarkers.map((marker) => {
                const isSelected = selectedMarker?.id === marker.id;
                const isHovered = hoveredMarkerId === marker.id;
                const fillColor =
                  marker.status === 'refused'
                    ? 'var(--refused-rust)'
                    : marker.status === 'trimmed'
                    ? 'var(--trimmed-amber)'
                    : 'var(--verdigris)';

                return (
                  <g
                    key={marker.id}
                    className="cursor-pointer group"
                    onMouseEnter={() => {
                      setHoveredMarkerId(marker.id);
                      tactile.selectionTap();
                    }}
                    onMouseLeave={() => {
                      setHoveredMarkerId(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkerTap(marker);
                    }}
                  >
                    {marker.hasRadarRing && (
                      <circle
                        className="radar-ring"
                        cx={marker.cx}
                        cy={marker.cy}
                        r={isHovered ? 9 : 6}
                        fill="none"
                        stroke={fillColor}
                        strokeWidth="1.2"
                      />
                    )}

                    {/* Outer halo when selected or hovered */}
                    {(isSelected || isHovered) && (
                      <circle
                        cx={marker.cx}
                        cy={marker.cy}
                        r={isHovered ? marker.r + 6 : marker.r + 4}
                        fill="none"
                        stroke={fillColor}
                        strokeWidth={isHovered ? 1.8 : 1.4}
                        strokeDasharray={isHovered ? '3 2' : '2 2'}
                        opacity={isHovered ? '1' : '0.9'}
                      />
                    )}

                    {/* Core dot with dynamic expansion */}
                    <circle
                      className={`chart-dot ${isSelected ? 'selected' : ''} transition-all duration-150`}
                      cx={marker.cx}
                      cy={marker.cy}
                      r={isHovered ? marker.r + 3.2 : isSelected ? marker.r + 1.5 : marker.r}
                      fill={fillColor}
                      stroke="var(--card-surface)"
                      strokeWidth={isSelected || isHovered ? 2.5 : 1.5}
                    />

                    {/* Prominent ticker tag */}
                    <text
                      x={marker.cx}
                      y={marker.cy - (isHovered ? 14 : 10)}
                      textAnchor="middle"
                      fill="var(--text-primary)"
                      fontSize="8.5"
                      fontFamily="var(--font-mono)"
                      fontWeight="700"
                      opacity={isHovered ? '0' : isSelected ? '1' : '0.8'}
                    >
                      {marker.ticker}
                    </text>

                    {/* Mini-Tooltip Preview on Hover/Focus */}
                    {isHovered && (() => {
                      // The box is measured from the label rather than fixed.
                      // A fixed 118 wide rect was narrower than the text it had
                      // to hold, so the words escaped the box they were in.
                      const label = `${marker.ticker} • ${marker.status.toUpperCase()} • ${marker.saved}`;
                      const w = Math.min(240, Math.max(78, label.length * 5.15 + 18));
                      const x = Math.max(6, Math.min(360 - w - 6, marker.cx - w / 2));
                      const y = Math.max(6, marker.cy - 38);
                      return (
                        <g className="pointer-events-none transition-all duration-200" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.65))' }}>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height="22"
                            rx="6"
                            fill="var(--card-surface-raised)"
                            stroke={fillColor}
                            strokeWidth="1.2"
                          />
                          <text
                            x={x + w / 2}
                            y={y + 14.5}
                            textAnchor="middle"
                            fill="var(--text-primary)"
                            fontSize="8.5"
                            fontFamily="var(--font-mono)"
                            fontWeight="700"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Floating HUD with Real-time Coordinates - Clean Single Line, Non-Wrapping */}
          <div className="chart-hud-tooltip flex items-center justify-between" id="chartLiveHud">
            <span className="text-[var(--text-secondary)] font-mono text-[11px] truncate flex items-center gap-1.5 min-w-0">
              <strong id="hudTime" className="text-[var(--text-primary)] font-bold shrink-0">
                {selectedMarker ? `${selectedMarker.ticker} • ${selectedMarker.time}` : 'Live Index Stream'}
              </strong>
              <span className="text-[var(--text-tertiary)] shrink-0">•</span>
              <span className="text-[var(--text-secondary)] shrink-0">Price:</span>
              <span id="hudPrice" className="text-[var(--verdigris)] font-semibold shrink-0">
                ${selectedMarker ? selectedMarker.price.toFixed(2) : simPrice}
              </span>
            </span>
            <span
              id="hudBadge"
              className="chart-hud-badge"
              style={{
                background: selectedMarker?.status === 'refused' || isImpulsePeak ? 'var(--refused-chip-bg)' : selectedMarker?.status === 'trimmed' ? 'var(--trimmed-chip-bg)' : 'var(--verdigris-chip-bg)',
                color: selectedMarker?.status === 'refused' || isImpulsePeak ? 'var(--refused-rust)' : selectedMarker?.status === 'trimmed' ? 'var(--trimmed-amber)' : 'var(--verdigris)',
                border: `1px solid ${selectedMarker?.status === 'refused' || isImpulsePeak ? 'var(--refused-chip-border)' : selectedMarker?.status === 'trimmed' ? 'var(--trimmed-chip-border)' : 'var(--verdigris-chip-border)'}`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
              <span>
                {selectedMarker ? (selectedMarker.status === 'refused' ? 'Refused' : selectedMarker.status === 'trimmed' ? 'Trimmed' : 'Cleared') : (isImpulsePeak ? 'Boundary Active' : 'Monitored')}
              </span>
            </span>
          </div>
        </div>

        {/* Premium Metallic Machined Scrubber Slider with Tactile Knurled Dial */}
        <div className="scrubber-panel flex flex-col gap-2" id="volatility-scrubber-panel">
          <div className="flex justify-between items-center font-mono text-[10.5px] text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--verdigris)] inline-block" />
              <span>Metallic Scrubber ({activeTimeframe})</span>
            </div>
            <span id="scrubberPosLabel" className="text-[var(--ember)] font-bold">
              {activeMarkers.length} on-chain intercepts
            </span>
          </div>

          <input
            id="chartScrubber"
            aria-label="Volatility timeline scrubber"
            className="scrubber-slider"
            type="range"
            min="25"
            max="340"
            value={scrubberVal}
            onChange={(e) => {
              const val = Number(e.target.value);
              setScrubberVal(val);
              tactile.sliderTick(val);
              // Snap to nearest marker if close
              const nearest = activeMarkers.find((m) => Math.abs(m.cx - val) < 18);
              if (nearest && nearest.id !== selectedMarker?.id) {
                setSelectedMarker(nearest);
                tactile.ledgerTrigger(nearest.status);
              }
            }}
          />

          {/* Scrubber Tactical Jumps */}
          <div className="flex items-center justify-between gap-1.5 pt-0.5 font-mono text-[10px]">
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--card-border)] transition-colors flex items-center gap-1"
              onClick={handleJumpPrevMarker}
            >
              <span>◀</span> Prev Event
            </button>
            <span className="text-[var(--text-tertiary)]">
              Scrub or tap canvas
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--card-border)] transition-colors flex items-center gap-1"
                onClick={handleJumpNextMarker}
              >
                Next Event <span>▶</span>
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-lg bg-[var(--verdigris-chip-bg)] border border-[var(--verdigris-chip-border)] text-[var(--verdigris)] font-bold hover:brightness-110 transition-all"
                onClick={handleJumpLiveHead}
                title="Jump to live head"
              >
                Live
              </button>
            </div>
          </div>
        </div>

        {/* Polished Marker Detail Card with Trader Analytics Station */}
        {selectedMarker && (
          <div
            id="markerDetailBox"
            className="marker-detail-card flex flex-col gap-3"
            role="region"
            aria-label="Trader Intercept Details"
          >
            {/* Top Row: Left has ticker, timestamp, price; Right has dedicated non-wrapping status pill */}
            <div className="marker-detail-toprow flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span id="markerTicker" className="font-mono font-bold text-[14px] text-[var(--text-primary)] shrink-0">
                  {selectedMarker.ticker}
                </span>
                <span className="text-[var(--text-tertiary)] font-mono text-[11.5px] truncate">
                  • {selectedMarker.time}
                </span>
                <span className="text-[var(--verdigris)] font-mono text-[11.5px] font-semibold shrink-0">
                  ${selectedMarker.price.toFixed(2)}
                </span>
              </div>

              {/* Status Pill: Single line, strict nowrap, never wraps or stacks */}
              <span className={`marker-badge-status ${selectedMarker.status} shrink-0`} id="markerStatusPill">
                <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                <span>
                  {selectedMarker.status === 'refused'
                    ? 'Refused on-chain'
                    : selectedMarker.status === 'trimmed'
                    ? 'Trimmed on-chain'
                    : 'Cleared on-chain'}
                </span>
              </span>
            </div>

            {/* Event Title & Plain English Mandate Explanation */}
            <div>
              <div id="markerTitle" className="text-[13.5px] font-bold text-[var(--text-primary)] font-sans">
                {selectedMarker.title}
              </div>
              <p id="markerDesc" className="text-[12px] text-[var(--text-secondary)] leading-relaxed font-sans mt-0.5">
                {selectedMarker.desc}
              </p>
            </div>

            {/* Trader Analytics Sub-Tabs.
                Three equal columns. As a flex row the third label had no
                room left and came out stacked three words high. */}
            <div className="grid grid-cols-3 gap-1.5 border-b border-[var(--card-border-subtle)] pb-2 font-mono text-[10.5px]">
              <button
                type="button"
                className={`px-1.5 py-1.5 rounded-lg text-center leading-tight transition-colors ${traderDetailTab === 'telemetry' ? 'bg-[var(--card-surface)] text-[var(--text-primary)] font-bold border border-[var(--card-border)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                onClick={() => { setTraderDetailTab('telemetry'); tactile.selectionTap(); }}
              >
                Telemetry
              </button>
              <button
                type="button"
                className={`px-1.5 py-1.5 rounded-lg text-center leading-tight transition-colors ${traderDetailTab === 'counterfactual' ? 'bg-[var(--card-surface)] text-[var(--text-primary)] font-bold border border-[var(--card-border)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                onClick={() => { setTraderDetailTab('counterfactual'); tactile.selectionTap(); }}
              >
                Counterfactual
              </button>
              <button
                type="button"
                className={`px-1.5 py-1.5 rounded-lg text-center leading-tight transition-colors ${traderDetailTab === 'proof' ? 'bg-[var(--card-surface)] text-[var(--text-primary)] font-bold border border-[var(--card-border)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                onClick={() => { setTraderDetailTab('proof'); tactile.selectionTap(); }}
              >
                PER Proof
              </button>
            </div>

            {/* Tab 1: Trader Telemetry */}
            {traderDetailTab === 'telemetry' && (
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-2 rounded-xl flex flex-col gap-0.5">
                  <span className="text-[var(--text-tertiary)] text-[10px]">Execution Venue:</span>
                  <span className="text-[var(--text-primary)] font-semibold truncate">
                    {selectedMarker.venue || 'Jupiter DEX Aggregator (Solana)'}
                  </span>
                </div>
                <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-2 rounded-xl flex flex-col gap-0.5">
                  <span className="text-[var(--text-tertiary)] text-[10px]">Intended Sizing:</span>
                  <span className="text-[var(--text-primary)] font-semibold truncate">
                    {selectedMarker.orderSize || selectedMarker.saved}
                  </span>
                </div>
                <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-2 rounded-xl flex flex-col gap-0.5">
                  <span className="text-[var(--text-tertiary)] text-[10px]">Drawdown Shielded:</span>
                  <span className="text-[var(--refused-rust)] font-bold truncate">
                    {selectedMarker.drawdownSaved || '-14.8% peak collapse avoided'}
                  </span>
                </div>
                <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-2 rounded-xl flex flex-col gap-0.5">
                  <span className="text-[var(--text-tertiary)] text-[10px]">Slippage / MEV Prevented:</span>
                  <span className="text-[var(--verdigris)] font-bold truncate">
                    {selectedMarker.slippagePrevented || '3.8% sandwich attack'}
                  </span>
                </div>
              </div>
            )}

            {/* Tab 2: Counterfactual PnL Simulation */}
            {traderDetailTab === 'counterfactual' && (
              <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-3 rounded-xl flex flex-col gap-2.5 font-mono text-[11.5px]">
                <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                  <span>Simulated Outcome Comparison</span>
                  <span className="text-[var(--verdigris)]">14ms Enforcer Pre-check</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-[rgba(232,85,62,0.08)] border border-[rgba(232,85,62,0.25)] flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--refused-rust)] font-bold uppercase">
                      Without Cleat Mandate
                    </span>
                    <span className="text-[12px] text-[var(--refused-rust)] font-bold">
                      {selectedMarker.counterfactualPnl || '-$177.60 Drawdown'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      Rogue order fills at top; portfolio suffers drawdown breach.
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-[rgba(78,194,165,0.08)] border border-[rgba(78,194,165,0.25)] flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--verdigris)] font-bold uppercase">
                      With Cleat Enforcer
                    </span>
                    <span className="text-[12px] text-[var(--verdigris)] font-bold">
                      $0.00 Capital Loss
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      Halted pre-broadcast. 100% of capital shielded on-chain.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Magicblock PER & Arcium MPC Proof */}
            {traderDetailTab === 'proof' && (
              <div className="bg-[var(--card-surface)] border border-[var(--card-border-subtle)] p-2.5 rounded-xl flex flex-col gap-2 font-mono text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-[var(--text-tertiary)]">Solana Slot:</span>
                    <span className="text-[var(--text-primary)] font-bold">
                      #{selectedMarker.solanaSlot || selectedMarker.blockNumber || 298419302}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-[var(--text-tertiary)]">Arcium Cluster:</span>
                    <span className="text-[var(--verdigris)] font-bold truncate">
                      {selectedMarker.arciumClusterId || 'arcium-mpc-cluster-04'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--card-border-subtle)]">
                  <span className="text-[10px] text-[var(--text-tertiary)]">MPC Proof Sig:</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <code className="text-[var(--verdigris)] bg-[var(--card-surface-raised)] px-1.5 py-0.5 rounded border border-[var(--card-border-subtle)] text-[10px] truncate max-w-[140px]">
                      {selectedMarker.proofSig || selectedMarker.zkProofHash || '5KwN8v3bWz6Y7qT9ArciumMPC9x7kM2vP4L1'}
                    </code>
                    <button
                      type="button"
                      className="px-2 py-0.5 rounded bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                      onClick={() => handleCopyProof(selectedMarker.proofSig || selectedMarker.zkProofHash || '5KwN8v3bWz6Y7qT9ArciumMPC9x7kM2vP4L1')}
                    >
                      {copiedProof ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="pt-1 border-t border-[var(--card-border-subtle)] flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--text-tertiary)]">Solana Instruction Intercepted:</span>
                  <code className="p-1.5 rounded bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[9.5px] text-[var(--text-secondary)] break-all leading-tight">
                    {selectedMarker.rawPayload || 'Program: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 -> route()'}
                  </code>
                </div>
              </div>
            )}

            {/* Proof & Capital Preservation Footer Row */}
            <div className="flex items-center justify-between border-t border-[var(--card-border-subtle)] pt-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-tertiary)]">Protected Capital:</span>
                <span id="markerSavedCapital" className="text-[var(--verdigris)] font-bold">
                  {selectedMarker.saved}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                <span>Rule:</span>
                <span className="text-[var(--text-secondary)] italic">“{selectedMarker.rule}”</span>
                <span className="text-[var(--verdigris)] text-[9px] bg-[var(--verdigris-chip-bg)] px-1.5 py-0.5 rounded border border-[var(--verdigris-chip-border)] font-bold">
                  PER • MPC
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 3D Execution Breakdown Toggle */}
        <button
          id="toggleKernelBtn"
          type="button"
          className="btn-ember w-full mt-1 justify-center font-sans"
          onClick={() => {
            setShowKernelLayers(!showKernelLayers);
            tactile.selectionTap();
          }}
        >
          {showKernelLayers
            ? 'Hide Cryptographic Execution Layers'
            : 'Inspect 3D Cryptographic Execution Layers'}
        </button>

        {showKernelLayers && (
          <div className="flex flex-col gap-2 mt-1" id="kernelLayersContainer">
            <div className="bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-xl p-2.5 flex items-center justify-between font-mono text-[11px] border-l-[3px] border-l-[var(--verdigris)]">
              <div>
                <div className="font-bold text-[var(--text-primary)] font-sans">Layer 1: Magicblock Ephemeral Rollup (PER)</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">Sub-millisecond confidential transaction execution</div>
              </div>
              <span className="text-[var(--verdigris)] font-bold">14ms</span>
            </div>
            <div className="bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-xl p-2.5 flex items-center justify-between font-mono text-[11px] border-l-[3px] border-l-[var(--ember)]">
              <div>
                <div className="font-bold text-[var(--text-primary)] font-sans">Layer 2: Confidential MPC Verification (Arcium)</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">Threshold multi-party mandate verification &amp; state audit</div>
              </div>
              <span className="text-[var(--ember)] font-bold">22ms</span>
            </div>
            <div className="bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-xl p-2.5 flex items-center justify-between font-mono text-[11px] border-l-[3px] border-l-[var(--refused-rust)]">
              <div>
                <div className="font-bold text-[var(--text-primary)] font-sans">Layer 3: Solana Cryptographic Gate Enforcer</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">Cold refusal gate triggered before on-chain commitment</div>
              </div>
              <span className="text-[var(--refused-rust)] font-bold">Interrupted</span>
            </div>
          </div>
        )}

        <button
          id="btn-open-data-insights-modal"
          type="button"
          className="btn-ember w-full mt-1 justify-center font-sans text-[12.5px]"
          onClick={() => {
            tactile.selectionTap();
            setInsightsMarker(selectedMarker);
            setIsInsightsOpen(true);
          }}
        >
          <span>Data Insights: Intercept Breakdown</span>
        </button>

        <button
          id="btn-open-tick-drawer"
          type="button"
          className="btn-mic w-full mt-1 justify-center font-sans"
          onClick={() => {
            tactile.selectionTap();
            onOpenTickDrawer();
          }}
        >
          <span>Granular Tick Stream Intercepts</span>
        </button>
      </div>

      {/* 24-Hour Enforcement Volume Summary Dashboard with D3 Animated Progress Bar */}
      <section
        className="glass-card flex flex-col gap-3"
        id="enforcement-volume-summary-dashboard"
        aria-label="24-Hour Enforcement Volume Summary"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 pb-1.5 border-b border-[var(--card-border-subtle)]">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[var(--verdigris)] animate-pulse shrink-0" />
            <h3 className="font-sans font-bold text-[13.5px] text-[var(--text-primary)] whitespace-nowrap">
              {activeTimeframe === '24H' ? '24-Hour' : `${activeTimeframe}`} Enforcement Volume
            </h3>
            {/* Kept on the title line. The full sized button pushed the
                window pill onto a second row and read louder than the
                heading it sits next to. */}
            <ExpandButton
              compact
              onClick={() => setExpanded('volume')}
              label="Open enforcement volume in full"
            />
          </div>
          <span className="font-mono text-[10px] text-[var(--text-tertiary)] px-2 py-0.5 rounded-full bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] whitespace-nowrap ml-auto shrink-0">
            Rolling {activeTimeframe} Window
          </span>
        </div>

        {/* Volume Metric Cards & 7D D3 Sparkline Graph.
        
            No viewport breakpoints. They were the bug: sm: and lg: key off
            the window, but this app is a 440px column at every window size,
            so on a desktop lg:grid-cols-4 fired and cut the row into four
            86px tiles with a chart in one of them. The column never
            changes width, so the layout should not ask the window about
            it.
        
            Headline, then the pair that compares, then the trend, each
            given the width its content actually needs. */}
        <div className="grid grid-cols-2 gap-2">
          {/* Total Volume, the headline, across the row */}
          <div className="col-span-2 p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">
                Total Volume
              </span>
              <span className="text-[17px] font-mono font-extrabold text-[var(--text-primary)]">
                {currentVolume.totalFormatted}
              </span>
            </div>
            <span className="text-[10px] text-[var(--text-secondary)] whitespace-nowrap">
              {currentVolume.txCount.toLocaleString()} transactions
            </span>
          </div>

          {/* Refused Volume */}
          <div className="p-2.5 rounded-xl bg-[var(--refused-chip-bg)] border border-[var(--refused-chip-border)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--refused-rust)] font-bold">
                  Refused
                </span>
                <span className="text-[10px] font-mono font-bold text-[var(--refused-rust)]">
                  {((currentVolume.refused / (currentVolume.refused + currentVolume.cleared)) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="text-[15px] font-mono font-extrabold text-[var(--refused-rust)] mt-0.5">
                ${currentVolume.refused.toFixed(2)}M
              </div>
            </div>
            <span className="text-[10px] text-[var(--refused-rust)]/80 mt-0.5 truncate">
              {currentVolume.refusedCount.toLocaleString()} blocked cold
            </span>
          </div>

          {/* Cleared Volume */}
          <div className="p-2.5 rounded-xl bg-[var(--verdigris-chip-bg)] border border-[var(--verdigris-chip-border)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--verdigris)] font-bold">
                  Cleared
                </span>
                <span className="text-[10px] font-mono font-bold text-[var(--verdigris)]">
                  {((currentVolume.cleared / (currentVolume.refused + currentVolume.cleared)) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="text-[15px] font-mono font-extrabold text-[var(--verdigris)] mt-0.5">
                ${currentVolume.cleared.toFixed(2)}M
              </div>
            </div>
            <span className="text-[10px] text-[var(--verdigris)]/80 mt-0.5 truncate">
              {currentVolume.clearedCount.toLocaleString()} compliant
            </span>
          </div>

          {/* 7-Day High-Density D3 Sparkline Graph */}
          <div className="col-span-2 p-2.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col justify-center min-w-0 overflow-hidden">
            <D3VolumeSparkline
              compact={true}
              action={
                <ExpandButton
                  compact
                  onClick={() => setExpanded('trend')}
                  label="Open the seven day trend in full"
                />
              }
            />
          </div>
        </div>

        <CrossIssuer
        ticker={symbolTicker(instrument)}
        venuePrice={venuePrice}
        venueDepthUsd={venueDepth}
        maxSpreadBps={maxSpreadBps}
      />

      {/* D3-Based Horizontal Progress Bar with Smooth Dynamic Interpolation */}
        <D3VolumeProgressBar
          refusedVolume={currentVolume.refused}
          clearedVolume={currentVolume.cleared}
          refusedCount={currentVolume.refusedCount}
          clearedCount={currentVolume.clearedCount}
          timeframeLabel={activeTimeframe}
        />
      </section>

      {/* Social Trading Room & Copier Feed for Social Trading dApp */}
      <div className="social-stream-card" id="social-trading-dapp-room">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-1 border-b border-[var(--card-border-subtle)]">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--verdigris)] animate-pulse shrink-0" />
            <h3 className="font-sans font-bold text-[14px] text-[var(--text-primary)] whitespace-nowrap">
              Copier Trading Room
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] whitespace-nowrap">
              1,420 Active Copiers
            </span>
            <button
              type="button"
              className={`px-2.5 py-1 text-[11px] font-sans font-bold rounded-lg transition-all ${
                isCopierSynced
                  ? 'bg-[var(--verdigris)] text-[#0c0b0a]'
                  : 'bg-[var(--card-surface-raised)] border border-[var(--card-border)] text-[var(--verdigris)] hover:border-[var(--verdigris)]'
              }`}
              onClick={handleToggleSync}
            >
              <span className="whitespace-nowrap">{isCopierSynced ? '✓ Synced' : 'Sync Mandate'}</span>
            </button>
          </div>
        </div>

        {/* Copy sync toast */}
        {isCopiedAlert && (
          <div className="bg-[var(--verdigris-chip-bg)] border border-[var(--verdigris-chip-border)] text-[var(--verdigris)] px-3 py-2 rounded-xl text-[11.5px] font-sans flex items-center justify-between">
            <span>
              {isCopierSynced
                ? 'Portfolio hooked to Mandate v2.4 enforcer circuit.'
                : 'Unsynced mandate. Autonomous agent returned to local manual mode.'}
            </span>
            <span className="font-mono text-[10px] font-bold">7xKP...4nP9</span>
          </div>
        )}

        {/* Live Copier Messages Stream */}
        <div className="flex flex-col gap-2.5 max-h-[280px] overflow-y-auto pr-0.5">
          {messages.map((msg) => (
            <div key={msg.id} className="social-msg-item">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[var(--card-surface)] border border-[var(--card-border)] flex items-center justify-center font-mono font-bold text-[9px] text-[var(--verdigris)]">
                    {msg.avatar}
                  </div>
                  <span className="font-mono font-bold text-[12px] text-[var(--text-primary)]">
                    @{msg.sender}
                  </span>
                  <span className="text-[9.5px] font-sans font-semibold px-2 py-0.5 rounded-full bg-[var(--card-surface)] text-[var(--text-tertiary)] border border-[var(--card-border-subtle)]">
                    {msg.badge}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                  {msg.time}
                </span>
              </div>

              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed font-sans pl-8">
                {msg.text}
              </p>

              <div className="flex items-center justify-between pl-8 pt-1 text-[11px] font-mono">
                {msg.protectedAmount ? (
                  <span className="text-[var(--verdigris)] font-semibold">
                    Shielded {msg.protectedAmount}
                  </span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">Signal Verified</span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--ember)] transition-colors"
                    onClick={() => handleLikeMessage(msg.id)}
                  >
                    <span>♥</span> {msg.likes}
                  </button>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {msg.isEnforcer ? '⚡ Enforced' : 'Copied'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Social Room Message Composer */}
        <form onSubmit={handleSendSocialMessage} className="flex gap-2 pt-1">
          <input
            type="text"
            className="flex-1 bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-xl px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--verdigris)] transition-colors font-sans"
            placeholder="Broadcast trade signal or mandate observation..."
            value={newMsgText}
            onChange={(e) => setNewMsgText(e.target.value)}
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-xl bg-[var(--verdigris)] text-[#0c0b0a] font-sans font-bold text-[12px] hover:brightness-110 transition-all shrink-0"
          >
            Broadcast
          </button>
        </form>
      </div>

      {/* Custom Data Insights Modal Triggered on Chart Marker Tap */}
      <DataInsightsModal
        isOpen={isInsightsOpen}
        onClose={() => setIsInsightsOpen(false)}
        marker={insightsMarker || selectedMarker}
      />

      {/* Pop out views. Each renders the same component the card does, so
          the two can never drift apart; they simply get more room here. */}
      <ExpandSheet
        isOpen={expanded === 'volume'}
        onClose={() => setExpanded(null)}
        kicker={`Rolling ${activeTimeframe} window`}
        title={`${activeTimeframe === '24H' ? '24-Hour' : activeTimeframe} enforcement volume`}
        wide
      >
        <D3VolumeProgressBar
          refusedVolume={currentVolume.refused}
          clearedVolume={currentVolume.cleared}
          refusedCount={currentVolume.refusedCount}
          clearedCount={currentVolume.clearedCount}
          timeframeLabel={activeTimeframe}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
            <span className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Cleared</span>
            <span className="block font-mono text-[19px] text-[var(--verdigris)] tabular-nums">${currentVolume.cleared.toFixed(2)}M</span>
            <span className="block text-[11px] text-[var(--text-secondary)]">{currentVolume.clearedCount.toLocaleString()} decisions</span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
            <span className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Refused</span>
            <span className="block font-mono text-[19px] text-[var(--refused-rust)] tabular-nums">${currentVolume.refused.toFixed(2)}M</span>
            <span className="block text-[11px] text-[var(--text-secondary)]">{currentVolume.refusedCount.toLocaleString()} decisions</span>
          </div>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
          Volume the mandate allowed against volume it stopped, over the rolling
          {' '}{activeTimeframe} window. Sector and share of the book only; no instrument
          and no holding appears here, which is why this view is safe to show anybody.
        </p>
      </ExpandSheet>

      <ExpandSheet
        isOpen={expanded === 'trend'}
        onClose={() => setExpanded(null)}
        kicker="Seven day trend"
        title="Cleared against refused, by day"
        wide
      >
        <div className="p-3 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]">
          <D3VolumeSparkline compact={false} />
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
          Drag across the chart to read any day. The gap between the two lines is
          the work the mandate did that week.
        </p>
      </ExpandSheet>
    </section>
  );
};
