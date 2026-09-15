import React, { useEffect, useState } from 'react';
import { DataOrigin } from './DataOrigin';
import { outcomeLabel, reasonText } from '../lib/chain';
import { tactile } from '../utils/haptics';

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
}

interface Outcome {
  signature?: string;
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
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export const AttackBox: React.FC = () => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [picked, setPicked] = useState('headline');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/attack')
      .then((r) => (r.ok ? r.json() : { scenarios: [] }))
      .then((j) => {
        if (live && j.scenarios?.length) setScenarios(j.scenarios);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const current = scenarios.find((s) => s.key === picked);

  const run = async () => {
    tactile.mandateAction();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: picked }),
      });
      setResult(await res.json());
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
          Everything above is a record of what the program decided. This is not.
          Pick one and a genuine transaction goes to Solana devnet against the
          same program and the same sentence, signed by an agent whose grant is
          live. The verdict comes back off the chain, and you get the signature,
          so you can check it somewhere that has never heard of us.
        </p>

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
              {scenarios.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
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
                <span>Sending it to the chain…</span>
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
                  color: refused
                    ? 'var(--refused-rust)'
                    : v?.outcome === 1
                      ? 'var(--trimmed-amber)'
                      : 'var(--verdigris)',
                }}
              >
                {v ? outcomeLabel(v.outcome) : refused ? 'Refused' : 'Answered'}
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

            {v ? (
              <>
                <p className="text-[12.5px] text-[var(--text-primary)] font-medium mt-1">
                  {reasonText(v.reason) || 'Inside every limit set'}
                </p>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
                  Asked for {pct(v.proposedBps)} of the book, allowed{' '}
                  {pct(v.allowedBps)}. Recorded at slot {v.slot} against mandate
                  version {(v as any).mandateVersion ?? ''}.
                </p>
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
