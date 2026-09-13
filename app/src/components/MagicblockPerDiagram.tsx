import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, Play, RotateCcw, Cpu, Lock, ArrowRight, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { tactile } from '../utils/haptics';

interface StageDetail {
  id: string;
  name: string;
  sub: string;
  latency: string;
  privacy: string;
  status: 'active' | 'blocked' | 'cleared';
  detail: string;
  payload: string;
}

export const MagicblockPerDiagram: React.FC = () => {
  const [flowMode, setFlowMode] = useState<'intercept' | 'compliant'>('intercept');
  const [selectedNode, setSelectedNode] = useState<number>(0);
  const [isPlayingPulse, setIsPlayingPulse] = useState(false);
  const [pulseStep, setPulseStep] = useState<number>(0);

  const stagesIntercept: StageDetail[] = [
    {
      id: 'mempool',
      name: '1. Ingress & Mempool Intercept',
      sub: 'Solana RPC Ingestion',
      latency: '1.2ms',
      privacy: 'Unencrypted RPC Payload',
      status: 'active',
      detail: 'Trading agent triggers automated swap instruction via Jupiter router. Packet is captured at RPC boundary before validator inclusion.',
      payload: 'Program: JUP6Lkb... -> swap(XOM_CRUDE, 2,500 USDC)',
    },
    {
      id: 'per',
      name: '2. Magicblock Ephemeral Rollup (PER)',
      sub: 'Confidential State Enclave',
      latency: '4.8ms',
      privacy: 'SEV-SNP Hardware Blinded',
      status: 'active',
      detail: 'Transaction routes into private ephemeral rollup. State transitions occur in blinded memory; public mempool and front-running searchers see nothing.',
      payload: 'Rollup: per-sol-instance-92 • State: Ephemeral Isolated State',
    },
    {
      id: 'mpc',
      name: '3. Arcium MPC Mandate Evaluator',
      sub: 'Threshold Rule Circuit',
      latency: '11.4ms',
      privacy: 'Confidential Multi-Party Verification',
      status: 'active',
      detail: 'Arcium multi-party node cluster evaluates human plain English mandate predicate: "no fossil fuels". Computes cryptographic token classification.',
      payload: 'Predicate: sector(XOM) in RESTRICTED_SET -> VIOLATION_TRUE',
    },
    {
      id: 'gate',
      name: '4. Enforcer Cold Refusal Gate',
      sub: 'Execution Aborted',
      latency: '14.1ms',
      privacy: 'Blinded Refusal Root Recorded',
      status: 'blocked',
      detail: 'Mandate violation detected. Hard cryptographic gate halts execution. Zero USDC moved, zero gas spent. Permanent refusal signature logged.',
      payload: 'Action: REFUSED_COLD • Proof: 5KwN8v3b...ArciumMPC9x7k',
    },
  ];

  const stagesCompliant: StageDetail[] = [
    {
      id: 'mempool',
      name: '1. Ingress & Mempool Intercept',
      sub: 'Solana RPC Ingestion',
      latency: '1.1ms',
      privacy: 'Encrypted Inbound Route',
      status: 'active',
      detail: 'Trading agent proposes scheduled rebalance into compliant ESG Clean Energy yield vault.',
      payload: 'Program: LBUZKhR... -> deposit(GREEN_INFRA, 450 USDC)',
    },
    {
      id: 'per',
      name: '2. Magicblock Ephemeral Rollup (PER)',
      sub: 'Confidential Execution Enclave',
      latency: '4.2ms',
      privacy: 'Blinded Sub-ms Rollup',
      status: 'active',
      detail: 'PER executes transaction optimistically inside enclave without risking sandwich attacks or slippage leakage.',
      payload: 'Rollup: per-sol-instance-92 • Slippage: 0.02% Protected',
    },
    {
      id: 'mpc',
      name: '3. Arcium MPC Mandate Evaluator',
      sub: 'Threshold Rule Circuit',
      latency: '9.8ms',
      privacy: 'Confidential MPC Consensus',
      status: 'active',
      detail: 'Arcium MPC evaluates mandate bounds: single-stock concentration <= 15%, ESG compliant. All 4 nodes attest compliance.',
      payload: 'Predicate: allocation(GREEN_INFRA) = 4.2% <= 15.0% -> COMPLIANT',
    },
    {
      id: 'gate',
      name: '4. Solana Settlement Commitment',
      sub: 'State Finalized on Chain',
      latency: '16.5ms',
      privacy: 'MPC Threshold Signed Proof',
      status: 'cleared',
      detail: 'MPC cluster generates multi-party authorization signature. Transaction state commits to Solana Mainnet slot cleanly.',
      payload: 'Status: CLEARED_ON_CHAIN • Slot #298,419,302',
    },
  ];

  const currentStages = flowMode === 'intercept' ? stagesIntercept : stagesCompliant;
  const activeDetail = currentStages[selectedNode];

  const handleSimulate = () => {
    setIsPlayingPulse(true);
    setPulseStep(0);
    tactile.selectionTap();

    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step <= 3) {
        setPulseStep(step);
        setSelectedNode(step);
        if (step === 3) {
          if (flowMode === 'intercept') {
            tactile.ledgerTrigger('refused');
          } else {
            tactile.ledgerTrigger('cleared');
          }
        } else {
          tactile.sliderTick(step * 25);
        }
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setIsPlayingPulse(false);
        }, 800);
      }
    }, 650);
  };

  return (
    <article className="glass-card flex flex-col gap-3" id="magicblock-per-flow-diagram">
      {/* Top Header */}
      <div className="card-topbar flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[var(--verdigris)]">
            <Zap size={14} />
          </div>
          <div>
            <span className="meta-kicker text-[10px]">Filtering Architecture</span>
            <h4 className="font-bold text-[13.5px] text-[var(--text-primary)]">
              Magicblock PER &amp; MPC Enforcer Pipeline
            </h4>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1.5 p-0.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[11px] font-mono">
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg transition-all ${
              flowMode === 'intercept'
                ? 'bg-[var(--refused-chip-bg)] text-[var(--refused-rust)] font-bold border border-[var(--refused-chip-border)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
            onClick={() => {
              setFlowMode('intercept');
              setSelectedNode(0);
              tactile.selectionTap();
            }}
          >
            Refusal Intercept
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg transition-all ${
              flowMode === 'compliant'
                ? 'bg-[var(--verdigris-chip-bg)] text-[var(--verdigris)] font-bold border border-[var(--verdigris-chip-border)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
            onClick={() => {
              setFlowMode('compliant');
              setSelectedNode(0);
              tactile.selectionTap();
            }}
          >
            Compliant Pass
          </button>
        </div>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
        Autonomous agent transactions are intercepted in sub-millisecond memory before reaching the public Solana validator pool. Private Ephemeral Rollups isolate execution while Arcium MPC evaluates plain English boundaries.
      </p>

      {/* SVG Interactive Pipeline Flow Diagram */}
      <div className="relative w-full rounded-2xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] p-3 overflow-hidden">
        {/* Ambient Grid Background */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        <svg
          className="w-full h-auto min-h-[170px]"
          viewBox="0 0 680 160"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="perPathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--text-tertiary)" stopOpacity="0.4" />
              <stop offset="35%" stopColor="var(--verdigris)" stopOpacity="0.7" />
              <stop offset="70%" stopColor="var(--ember)" stopOpacity="0.7" />
              <stop
                offset="100%"
                stopColor={flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
                stopOpacity="0.9"
              />
            </linearGradient>

            <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Interconnecting Pipeline Track */}
          <path
            d="M 85 80 L 235 80 L 415 80 L 595 80"
            stroke="var(--card-border)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Animated Flow Track */}
          <path
            d="M 85 80 L 235 80 L 415 80 L 595 80"
            stroke="url(#perPathGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray="8 6"
            className="animate-[dash_12s_linear_infinite]"
          />

          {/* Dynamic Traveling Packet during Simulation */}
          {isPlayingPulse && (
            <circle
              cx={85 + pulseStep * 170}
              cy="80"
              r="7.5"
              fill={pulseStep === 3 && flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
              filter="url(#glowFilter)"
              className="transition-all duration-500 ease-out"
            >
              <animate
                attributeName="r"
                values="6;9;6"
                dur="0.8s"
                repeatCount="indefinite"
              />
            </circle>
          )}

          {/* Node 1: Ingress Mempool */}
          <g
            className="cursor-pointer group"
            onClick={() => {
              setSelectedNode(0);
              tactile.selectionTap();
            }}
          >
            <circle
              cx="85"
              cy="80"
              r={selectedNode === 0 ? "26" : "22"}
              fill="var(--card-surface)"
              stroke={selectedNode === 0 ? "var(--text-primary)" : "var(--card-border)"}
              strokeWidth={selectedNode === 0 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="85" cy="80" r="14" fill="var(--card-surface-raised)" />
            <text
              x="85"
              y="84"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              RPC
            </text>
            <text
              x="85"
              y="122"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="10"
              fontWeight="700"
            >
              Ingress
            </text>
            <text
              x="85"
              y="136"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
            >
              1.2ms • Intercept
            </text>
          </g>

          {/* Node 2: Magicblock PER */}
          <g
            className="cursor-pointer group"
            onClick={() => {
              setSelectedNode(1);
              tactile.selectionTap();
            }}
          >
            <circle
              cx="255"
              cy="80"
              r={selectedNode === 1 ? "28" : "24"}
              fill="var(--card-surface)"
              stroke={selectedNode === 1 ? "var(--verdigris)" : "var(--card-border)"}
              strokeWidth={selectedNode === 1 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="255" cy="80" r="16" fill="var(--verdigris-chip-bg)" />
            <text
              x="255"
              y="84"
              textAnchor="middle"
              fill="var(--verdigris)"
              fontSize="10.5"
              fontFamily="var(--font-mono)"
              fontWeight="extrabold"
            >
              PER
            </text>
            <text
              x="255"
              y="122"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="10"
              fontWeight="700"
            >
              Magicblock PER
            </text>
            <text
              x="255"
              y="136"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
            >
              4.8ms • Enclave
            </text>
          </g>

          {/* Node 3: Arcium MPC Circuit */}
          <g
            className="cursor-pointer group"
            onClick={() => {
              setSelectedNode(2);
              tactile.selectionTap();
            }}
          >
            <circle
              cx="425"
              cy="80"
              r={selectedNode === 2 ? "28" : "24"}
              fill="var(--card-surface)"
              stroke={selectedNode === 2 ? "var(--ember)" : "var(--card-border)"}
              strokeWidth={selectedNode === 2 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="425" cy="80" r="16" fill="var(--card-surface-raised)" />
            <text
              x="425"
              y="84"
              textAnchor="middle"
              fill="var(--ember)"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fontWeight="extrabold"
            >
              MPC
            </text>
            <text
              x="425"
              y="122"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="10"
              fontWeight="700"
            >
              Arcium MPC
            </text>
            <text
              x="425"
              y="136"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
            >
              11.4ms • Predicates
            </text>
          </g>

          {/* Node 4: Decision Gate (Refused vs Cleared) */}
          <g
            className="cursor-pointer group"
            onClick={() => {
              setSelectedNode(3);
              tactile.selectionTap();
            }}
          >
            <circle
              cx="595"
              cy="80"
              r={selectedNode === 3 ? "28" : "24"}
              fill="var(--card-surface)"
              stroke={
                selectedNode === 3
                  ? flowMode === 'intercept'
                    ? 'var(--refused-rust)'
                    : 'var(--verdigris)'
                  : 'var(--card-border)'
              }
              strokeWidth={selectedNode === 3 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle
              cx="595"
              cy="80"
              r="16"
              fill={flowMode === 'intercept' ? 'var(--refused-chip-bg)' : 'var(--verdigris-chip-bg)'}
            />
            <text
              x="595"
              y="84"
              textAnchor="middle"
              fill={flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
              fontSize="12"
              fontWeight="bold"
            >
              {flowMode === 'intercept' ? '✕' : '✓'}
            </text>
            <text
              x="595"
              y="122"
              textAnchor="middle"
              fill={flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
              fontSize="10"
              fontWeight="700"
            >
              {flowMode === 'intercept' ? 'Refused Cold' : 'Solana Settled'}
            </text>
            <text
              x="595"
              y="136"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
            >
              {flowMode === 'intercept' ? '14.1ms • Aborted' : '16.5ms • Cleared'}
            </text>
          </g>
        </svg>

        {/* Live Simulator Button */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--card-border-subtle)]">
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--text-tertiary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--verdigris)] animate-pulse" />
            <span>Active Step: {activeDetail.name}</span>
          </div>

          <button
            id="btn-simulate-per-pulse"
            type="button"
            disabled={isPlayingPulse}
            onClick={handleSimulate}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[var(--card-surface)] border border-[var(--card-border)] hover:border-[var(--verdigris)] text-[11px] text-[var(--text-primary)] font-semibold transition-all shadow-sm disabled:opacity-60"
          >
            {isPlayingPulse ? (
              <>
                <RotateCcw size={12} className="animate-spin text-[var(--verdigris)]" />
                <span>Simulating Packet...</span>
              </>
            ) : (
              <>
                <Play size={12} className="text-[var(--verdigris)] fill-current" />
                <span>Trace Pipeline ({flowMode === 'intercept' ? 'Refusal' : 'Clear'})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Selected Step Deep Dive Card */}
      <div className="p-3 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${activeDetail.status === 'blocked' ? 'bg-[var(--refused-rust)]' : activeDetail.status === 'cleared' ? 'bg-[var(--verdigris)]' : 'bg-[var(--ember)]'}`} />
            <h5 className="text-[12.5px] font-bold text-[var(--text-primary)]">
              {activeDetail.name}
            </h5>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10.5px]">
            <span className="text-[var(--text-tertiary)]">Latency:</span>
            <span className="font-bold text-[var(--verdigris)]">{activeDetail.latency}</span>
          </div>
        </div>

        <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
          {activeDetail.detail}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1.5 border-t border-[var(--card-border-subtle)]/60 text-[10.5px] font-mono">
          <div className="flex flex-col gap-0.5 bg-[var(--card-surface)] p-2 rounded-lg border border-[var(--card-border-subtle)]">
            <span className="text-[var(--text-tertiary)]">Privacy &amp; Attestation:</span>
            <span className="text-[var(--text-primary)] font-medium truncate">{activeDetail.privacy}</span>
          </div>
          <div className="flex flex-col gap-0.5 bg-[var(--card-surface)] p-2 rounded-lg border border-[var(--card-border-subtle)]">
            <span className="text-[var(--text-tertiary)]">Instruction Payload:</span>
            <code className="text-[var(--verdigris)] truncate">{activeDetail.payload}</code>
          </div>
        </div>
      </div>
    </article>
  );
};
