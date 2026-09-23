import React, { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { DataOrigin } from './DataOrigin';
import {
  connection, decodeVerdictLog, newestVerdict, outcomeLabel, reasonText,
  verdictCount,
} from '../lib/chain';
import { tactile } from '../utils/haptics';
import type { TracedRun } from './MagicblockPerDiagram';

/**
 * Push on the boundary yourself.
 *
 * Everything else on this screen is a record, and a record is something you
 * are asked to believe. This is the other thing. Picking one of these sends a
 * real proposal, signed by a real agent grant, to the same program under the
 * same sentence, and what comes back is a transaction signature. The verdict
 * is read back off the chain rather than reported from here, because the whole
 * claim is that the program decides and not us.
 *
 * It writes to a separate vault from the one the diary reads. The record holds
 * sixteen decisions that between them exercise every reason the program has,
 * and it should not be overwritten by whoever is playing with the app.
 */
interface Scenario {
  key: string;
  label: string;
  headline: string;
  tests: string;
  /** Which instruction this scenario drives. The distinction is the product. */
  path: 'gate' | 'clamp';
}

interface Outcome {
  signature?: string;
  timings?: {
    submittedMs: number;
    confirmedMs: number | null;
    readMs: number | null;
  };
  explorer?: string;
  asked?: number;
  verdict?: {
    proposedBps: number;
    allowedBps: number;
    outcome: number;
    reason: number;
    slot: number;
  } | null;
  error?: string;
  refusedOnChain?: boolean;
  /** Set on the confidential path while the network is still deciding. */
  deciding?: boolean;
  /** The per run computation account, which a reader can check themselves. */
  computation?: string;
  log?: string;
  queuedMs?: number;
  path?: 'gate' | 'clamp';
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export const AttackBox: React.FC<{
  /** Handed up so the trace diagram can animate a run that actually happened. */
  onRun?: (r: TracedRun) => void;
}> = ({ onRun }) => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    const load = (url: string, path: 'gate' | 'clamp') =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { scenarios: [] }))
        .then((j) => (j.scenarios ?? []).map((x: Scenario) => ({ ...x, path })))
        .catch(() => [] as Scenario[]);

    // The gate pair leads. It is the only thing here that exercises the
    // confidential path, and the clamp scenarios are the fallback rather than
    // the headline. If the gate endpoint is not configured on a deploy the
    // list simply starts at the clamp, which is what the old build did.
    Promise.all([load('/api/gate', 'gate'), load('/api/attack', 'clamp')]).then(
      ([gate, clamp]) => {
        if (!live) return;
        const all = [...gate, ...clamp];
        if (all.length) {
          setScenarios(all);
          setPicked(all[0].key);
        }
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const current = scenarios.find((s) => s.key === picked);

  /**
   * Watch for the answer to a confidential run.
   *
   * The gate endpoint returns as soon as the question is queued, because an
   * Arcium round trip is about five seconds against a serverless ceiling of
   * ten. So the verdict is not in the response, it arrives later in a callback
   * transaction the network sends. Two accounts say when: the log gains a
   * decision, and the per run computation account is closed once the answer is
   * in one way or the other.
   *
   * Counting before and reading the newest after is the only honest way to know
   * the verdict belongs to this run, since anyone else pressing the button
   * writes to the same log.
   */
  const watchForVerdict = async (
    logAddr: string, compAddr: string, before: number, startedAt: number,
  ): Promise<Partial<Outcome>> => {
    const log = new PublicKey(logAddr);
    const comp = new PublicKey(compAddr);
    let compGoneAt: number | null = null;

    for (let waited = 0; waited < 90_000; waited += 1500) {
      await new Promise((r) => setTimeout(r, 1500));
      let logInfo, compInfo;
      try {
        [logInfo, compInfo] = await Promise.all([
          connection.getAccountInfo(log),
          connection.getAccountInfo(comp),
        ]);
      } catch {
        continue; // a dropped read is not an answer, keep watching
      }
      if (!logInfo) continue;

      const data = new Uint8Array(logInfo.data);
      if (verdictCount(decodeVerdictLog(data)) > before) {
        return {
          verdict: (() => {
            const v = newestVerdict(data);
            return v
              ? {
                  slot: Number(v.slot), mandateVersion: v.mandateVersion,
                  category: v.category, proposedBps: v.proposedBps,
                  allowedBps: v.allowedBps, outcome: v.outcome, reason: v.reason,
                }
              : null;
          })(),
          deciding: false,
          timings: { submittedMs: 0, confirmedMs: null, readMs: Date.now() - startedAt },
        };
      }

      // Closed and nothing written means the network answered by refusing to
      // answer. Saying so is better than spinning until the timeout.
      if (!compInfo) {
        if (compGoneAt === null) compGoneAt = waited;
        else if (waited > compGoneAt + 9000) {
          return {
            deciding: false,
            error:
              'The computation closed without writing a verdict. That is the circuit declining to answer rather than a network problem, and it is visible on the computation account.',
          };
        }
      }
    }
    return {
      deciding: false,
      error:
        'No verdict after ninety seconds. The question is queued on chain and the computation account is the place to watch it, so nothing here is lost, but the network has not answered yet.',
    };
  };

  const run = async () => {
    tactile.mandateAction();
    setBusy(true);
    setResult(null);
    const isGate = current?.path === 'gate';
    const startedAt = Date.now();
    try {
      const res = await fetch(isGate ? '/api/gate' : '/api/attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: picked }),
      });
      const out: Outcome = await res.json();

      if (!isGate || out.error || !out.log || !out.computation) {
        setResult(out);
        if (out.signature && out.timings) {
          onRun?.({
            refused: out.verdict ? out.verdict.outcome === 2 : true,
            submittedMs: out.timings.submittedMs,
            confirmedMs: out.timings.confirmedMs,
            readMs: out.timings.readMs,
            signature: out.signature,
          });
        }
        return;
      }

      // Read the count now rather than before the post. The queue transaction
      // does not write a verdict, so anything already in the log at this point
      // belongs to somebody else's run.
      let before = 0;
      try {
        const info = await connection.getAccountInfo(new PublicKey(out.log));
        before = info ? verdictCount(decodeVerdictLog(new Uint8Array(info.data))) : 0;
      } catch {
        before = 0;
      }

      setResult({ ...out, deciding: true });
      const answer = await watchForVerdict(out.log, out.computation, before, startedAt);
      const settled = { ...out, ...answer } as Outcome;
      setResult(settled);
      if (settled.verdict) {
        onRun?.({
          refused: settled.verdict.outcome === 2,
          submittedMs: out.queuedMs ?? 0,
          confirmedMs: null,
          readMs: settled.timings?.readMs ?? null,
          signature: out.signature!,
        });
      }
    } catch {
      setResult({ error: 'could not reach the chain from here' });
    } finally {
      setBusy(false);
    }
  };

  const v = result?.verdict;
  const refused = v ? v.outcome === 2 : !!result?.refusedOnChain;

  return (
    <>
      <div className="section-row-header mt-2">
        <h3 className="section-heading text-[16px] font-bold">Push on it yourself</h3>
        <span className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
          <span className="section-hint text-[11px]">A real proposal, on devnet</span>
          <DataOrigin origin="chain" />
        </span>
      </div>

      <div className="poison-box glass-card flex flex-col gap-3.5 w-full" id="attack-card">
        <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
          The ledger below is a record of decisions already made, which you
          are asked to believe. This is not. Pick one and a real transaction
          goes to devnet against the same program and the same sentence. You
          get the signature, so you can check it somewhere that has never
          heard of us.
        </p>

        {current?.path === 'gate' ? (
          <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
            The top two are worth your time. Same size, same sector, same
            name, and they come back differently. The only thing separating
            them is how much of the book is already in that name, sealed
            before it leaves here. Nothing in the path ever sees the
            position.
          </p>
        ) : (
          <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
            This one takes the public route. The caps are written on the mandate
            where anyone can read them, so the program checks them itself and
            answers in a single slot. Real, and checkable, and not the part that
            needs a circuit. The two at the top of the list are that part.
          </p>
        )}

        {current && (
          <p className="text-[11.5px] leading-[1.6] text-[var(--text-tertiary)] italic border-l-0">
            “{current.headline}”
          </p>
        )}

        <div className="flex flex-col gap-2.5 w-full">
          <div className="relative w-full min-w-0">
            <select
              id="attackScenarioSelect"
              className="select-headline"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              aria-label="Choose what to try"
              disabled={scenarios.length === 0}
            >
              {scenarios.length === 0 && <option>Loading…</option>}
              {scenarios.some((s) => s.path === 'gate') && (
                <optgroup label="Through the confidential circuit">
                  {scenarios.filter((s) => s.path === 'gate').map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </optgroup>
              )}
              {scenarios.some((s) => s.path === 'clamp') && (
                <optgroup label="Against the public caps">
                  {scenarios.filter((s) => s.path === 'clamp').map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {current && (
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Tests {current.tests}.
            </p>
          )}

          <button
            id="btn-run-attack"
            type="button"
            className="btn-inject"
            onClick={run}
            disabled={busy || scenarios.length === 0}
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <span>
                  {result?.deciding
                    ? 'Asking the network…'
                    : 'Sending it to the chain…'}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Send it and see</span>
              </span>
            )}
          </button>
        </div>

        {result && (
          <div className="poison-result-card mt-1" id="attackResultCard">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span
                className="font-bold uppercase tracking-wider text-[10px]"
                style={{
                  color: result.deciding
                    ? 'var(--text-tertiary)'
                    : refused
                      ? 'var(--refused-rust)'
                      : v?.outcome === 1
                        ? 'var(--trimmed-amber)'
                        : 'var(--verdigris)',
                }}
              >
                {result.deciding
                  ? 'Deciding'
                  : v
                    ? outcomeLabel(v.outcome)
                    : refused
                      ? 'Refused'
                      : 'Answered'}
              </span>
              {result.explorer && (
                <a
                  href={result.explorer}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[10.5px] font-mono text-[var(--verdigris)] underline underline-offset-2"
                >
                  check the transaction
                </a>
              )}
            </div>

            {result.deciding ? (
              <>
                <p className="text-[12.5px] text-[var(--text-primary)] font-medium mt-1">
                  The question is on chain. The network is working on it.
                </p>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
                  Queued in {result.queuedMs ?? 0}ms. The answer arrives in its
                  own transaction, usually within about five seconds, and this
                  reads it off the log rather than being told.
                </p>
                {result.computation && (
                  <p className="text-[10.5px] font-mono text-[var(--text-tertiary)] mt-1 break-all">
                    computation {result.computation}
                  </p>
                )}
              </>
            ) : v ? (
              <>
                <p className="text-[12.5px] text-[var(--text-primary)] font-medium mt-1">
                  {reasonText(v.reason) || 'Inside every limit set'}
                </p>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
                  Asked for {pct(v.proposedBps)} of the book, allowed{' '}
                  {pct(v.allowedBps)}. Recorded at slot {v.slot} against mandate
                  version {(v as any).mandateVersion ?? ''}.
                </p>
                {result.path === 'gate' && result.computation && (
                  <p className="text-[10.5px] font-mono text-[var(--text-tertiary)] mt-1 break-all">
                    decided off chain at {result.computation}, which is owned by
                    the Arcium program and not by us
                  </p>
                )}
              </>
            ) : result.error ? (
              <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
                {result.refusedOnChain
                  ? 'The program rejected the transaction outright, which is a refusal that never reaches the log. '
                  : ''}
                {result.error}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
};
