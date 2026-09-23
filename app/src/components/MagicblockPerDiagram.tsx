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

/** A real run, measured. Null until somebody has actually fired one. */
export interface TracedRun {
  refused: boolean;
  submittedMs: number;
  confirmedMs: number | null;
  readMs: number | null;
  signature: string;
}

interface DiagramProps {
  /**
   * The last proposal anybody actually sent, with the wall clock it took.
   *
   * Every latency on this diagram used to be typed in: one point two
   * milliseconds to intercept, four point eight in the enclave, eleven point
   * four for predicates. None of it was measured and one of the stages does
   * not run at all. When a run exists these come from it instead, and when
   * one does not the diagram says so rather than showing a number.
   */
  run?: TracedRun | null;
}

export const MagicblockPerDiagram: React.FC<DiagramProps> = ({ run = null }) => {
  const [flowMode, setFlowMode] = useState<'intercept' | 'compliant'>('intercept');

  // The path a real run took wins over whichever tab was left selected.
  useEffect(() => {
    if (run) setFlowMode(run.refused ? 'intercept' : 'compliant');
  }, [run]);

  /**
   * What each stage cost, from the run if there is one.
   *
   * Four boxes, three measurements: submitted, confirmed, verdict read. The
   * third box is the Arcium evaluator, which does not run, so it never gets a
   * number however many runs happen.
   */
  const measured = (i: number): string => {
    if (!run) return 'send one';
    if (i === 2) return 'gate not live';
    const ms = i === 0 ? run.submittedMs : i === 1 ? run.confirmedMs : run.readMs;
    return ms === null ? 'no answer' : `${ms}ms`;
  };
  const [selectedNode, setSelectedNode] = useState<number>(0);
  const [isPlayingPulse, setIsPlayingPulse] = useState(false);
  const [pulseStep, setPulseStep] = useState<number>(0);

  const stagesIntercept: StageDetail[] = [
    {
      id: 'mempool',
      name: '1. Submitted to Solana',
      sub: 'Solana RPC Ingestion',
      latency: 'measured per run',
      privacy: 'Unencrypted RPC Payload',
      status: 'active',
      detail: 'Trading agent triggers automated swap instruction via Jupiter router. Packet is captured at RPC boundary before validator inclusion.',
      payload: 'Program: JUP6Lkb... -> swap(XOM_CRUDE, 2,500 USDC)',
    },
    {
      id: 'per',
      name: '2. The program decides',
      sub: 'Confidential State Enclave',
      latency: 'measured per run',
      privacy: 'Intel TDX, attested rollup',
      status: 'active',
      detail: 'Transaction routes into private ephemeral rollup. State transitions occur in blinded memory; public mempool and front-running searchers see nothing.',
      payload: 'Rollup: per-sol-instance-92 • State: Ephemeral Isolated State',
    },
    {
      id: 'mpc',
      name: '3. Confidential gate, not live',
      sub: 'Threshold Rule Circuit',
      latency: 'not live',
      privacy: 'Confidential Multi-Party Verification',
      status: 'active',
      detail: 'Arcium multi-party node cluster evaluates human plain English mandate predicate: "no fossil fuels". Computes cryptographic token classification.',
      payload: 'Predicate: sector(XOM) in RESTRICTED_SET -> VIOLATION_TRUE',
    },
    {
      id: 'gate',
      name: '4. Refusal recorded',
      sub: 'Execution Aborted',
      latency: 'measured per run',
      privacy: 'Blinded Refusal Root Recorded',
      status: 'blocked',
      detail: 'Mandate violation detected. Hard cryptographic gate halts execution. Zero USDC moved, nothing spent on fees. Permanent refusal signature logged.',
      payload: 'Action: REFUSED_COLD • Proof: 5KwN8v3b...ArciumMPC9x7k',
    },
  ];

  const stagesCompliant: StageDetail[] = [
    {
      id: 'mempool',
      name: '1. Submitted to Solana',
      sub: 'Solana RPC Ingestion',
      latency: 'measured per run',
      privacy: 'Encrypted Inbound Route',
      status: 'active',
      detail: 'Trading agent proposes scheduled rebalance into compliant ESG Clean Energy yield vault.',
      payload: 'Program: LBUZKhR... -> deposit(GREEN_INFRA, 450 USDC)',
    },
    {
      id: 'per',
      name: '2. The program decides',
      sub: 'Confidential Execution Enclave',
      latency: 'measured per run',
      privacy: 'Blinded Sub-ms Rollup',
      status: 'active',
      detail: 'The nine boundaries the mandate sets are checked here, inside the transaction, by the program. Nothing off chain gets a vote.',
      payload: 'Rollup: per-sol-instance-92 • Slippage: 0.02% Protected',
    },
    {
      id: 'mpc',
      name: '3. Confidential gate, not live',
      sub: 'Threshold Rule Circuit',
      latency: 'not live',
      privacy: 'Confidential MPC Consensus',
      status: 'active',
      detail: 'Arcium MPC evaluates mandate bounds: single-stock concentration <= 15%, ESG compliant. All 4 nodes attest compliance.',
      payload: 'Predicate: allocation(GREEN_INFRA) = 4.2% <= 15.0% -> COMPLIANT',
    },
    {
      id: 'gate',
      name: '4. Clearance recorded',
      sub: 'State Finalized on Chain',
      latency: 'measured per run',
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
            <span className="meta-kicker text-[10px]">How a proposal is decided</span>
            <h4 className="font-bold text-[13.5px] text-[var(--text-primary)]">
              Four stages, three of them measured
            </h4>
          </div>
        </div>

        {/* Mode Selector.
            A grid rather than a flex row, so each half of the track is the
            same width and its label sits in the middle of it. Hugging
            buttons in a full width track left both labels crowded against
            the left edge with dead space after the second one. */}
        <div className="grid grid-cols-2 gap-1.5 w-full p-0.5 rounded-xl bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[11px] font-mono">
          <button
            type="button"
            className={`px-2 py-1.5 rounded-lg text-center whitespace-nowrap transition-all ${
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
            Refused
          </button>
          <button
            type="button"
            className={`px-2 py-1.5 rounded-lg text-center whitespace-nowrap transition-all ${
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
            Cleared
          </button>
        </div>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
        A proposal is an ordinary Solana transaction, decided inside that
        transaction against the nine boundaries your sentence sets. Timings
        are wall clock from the last one sent, not modelled. The confidential
        gate, which reaches the same verdict without anyone seeing the
        holdings, returns in about three seconds. Attested execution handles
        cleared trades, measured separately at 1.8 seconds.
      </p>

      {/* SVG Interactive Pipeline Flow Diagram */}
      <div className="relative w-full rounded-2xl bg-[var(--card-surface-raised)] border border-[var(--card-border)] p-3 overflow-hidden">
        {/* Ambient Grid Background */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        <svg
          className="w-full h-auto min-h-[170px]"
          viewBox="0 0 680 206"
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
              r="10"
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
              r={selectedNode === 0 ? "34" : "30"}
              fill="var(--card-surface)"
              stroke={selectedNode === 0 ? "var(--text-primary)" : "var(--card-border)"}
              strokeWidth={selectedNode === 0 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="85" cy="80" r="22" fill="var(--card-surface-raised)" />
            <text
              x="85"
              y="87"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="17"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              RPC
            </text>
            <text
              x="85"
              y="136"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="17"
              fontWeight="700"
            >
              Submitted
            </text>
            <text
              x="85"
              y="162"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="15"
              fontFamily="var(--font-mono)"
            >
              {measured(0)}
            </text>
          </g>

          {/* Node 2: the program decides, inside the transaction */}
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
              r={selectedNode === 1 ? "36" : "32"}
              fill="var(--card-surface)"
              stroke={selectedNode === 1 ? "var(--verdigris)" : "var(--card-border)"}
              strokeWidth={selectedNode === 1 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="255" cy="80" r="24" fill="var(--verdigris-chip-bg)" />
            <text
              x="255"
              y="87"
              textAnchor="middle"
              fill="var(--verdigris)"
              fontSize="18"
              fontFamily="var(--font-mono)"
              fontWeight="extrabold"
            >
              SOL
            </text>
            <text
              x="255"
              y="136"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="17"
              fontWeight="700"
            >
              Program decides
            </text>
            <text
              x="255"
              y="162"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="15"
              fontFamily="var(--font-mono)"
            >
              {measured(1)}
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
              r={selectedNode === 2 ? "36" : "32"}
              fill="var(--card-surface)"
              stroke={selectedNode === 2 ? "var(--ember)" : "var(--card-border)"}
              strokeWidth={selectedNode === 2 ? "2.5" : "1.5"}
              className="transition-all duration-200"
            />
            <circle cx="425" cy="80" r="24" fill="var(--card-surface-raised)" />
            <text
              x="425"
              y="87"
              textAnchor="middle"
              fill="var(--ember)"
              fontSize="17"
              fontFamily="var(--font-mono)"
              fontWeight="extrabold"
            >
              MPC
            </text>
            <text
              x="425"
              y="136"
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="17"
              fontWeight="700"
            >
              Arcium gate
            </text>
            <text
              x="425"
              y="162"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="15"
              fontFamily="var(--font-mono)"
            >
              {measured(2)}
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
              r={selectedNode === 3 ? "36" : "32"}
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
              y="87"
              textAnchor="middle"
              fill={flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
              fontSize="20"
              fontWeight="bold"
            >
              {flowMode === 'intercept' ? '✕' : '✓'}
            </text>
            <text
              x="595"
              y="136"
              textAnchor="middle"
              fill={flowMode === 'intercept' ? 'var(--refused-rust)' : 'var(--verdigris)'}
              fontSize="17"
              fontWeight="700"
            >
              {flowMode === 'intercept' ? 'Refused' : 'To the rollup'}
            </text>
            <text
              x="595"
              y="162"
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="15"
              fontFamily="var(--font-mono)"
            >
              {measured(3)}
            </text>
          </g>
        </svg>

        {/* Live Simulator Button */}
        <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)] mt-2">
          {run ? (
            <>
              Timed from the proposal sent just above, wall clock. The
              confirmation is an upper bound rather than the exact moment the
              cluster agreed, because it is polled.
            </>
          ) : (
            <>
              Nothing has been sent yet, so there is nothing to time. Send a
              proposal in the box above and these fill in with what it
              actually cost.
            </>
          )}
          {flowMode === 'compliant' ? (
            <>
              {' '}
              A cleared trade then executes in MagicBlock's rollup, inside an
              Intel TDX enclave, which a refused one never reaches. That leg
              is measured separately on devnet: 1,808ms to verify the
              attestation, 168ms to seal the vault, 205ms to commit and
              release it, and a 36ms median from submit to confirm once
              inside.
            </>
          ) : (
            <>
              {' '}
              A refused proposal stops here. It never reaches the rollup, and
              nothing settles.
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mt-2 pt-2 border-t border-[var(--card-border-subtle)]">
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--text-tertiary)] min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--verdigris)] animate-pulse shrink-0" />
            <span className="truncate">{activeDetail.name}</span>
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 translate-y-[-1px] ${activeDetail.status === 'blocked' ? 'bg-[var(--refused-rust)]' : activeDetail.status === 'cleared' ? 'bg-[var(--verdigris)]' : 'bg-[var(--ember)]'}`} />
            <h5 className="text-[12.5px] font-bold text-[var(--text-primary)]">
              {activeDetail.name}
            </h5>
          </div>
          <div className="flex items-baseline gap-2 font-mono text-[10.5px] shrink-0">
            <span className="text-[var(--text-tertiary)]">Latency</span>
            <span className="font-bold text-[var(--verdigris)]">{activeDetail.latency}</span>
          </div>
        </div>

        <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
          {activeDetail.detail}
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-[var(--card-border-subtle)]/60 text-[10.5px] font-mono">
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
