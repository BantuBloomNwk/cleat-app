import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tactile } from '../utils/haptics';
import { PublicKey } from '@solana/web3.js';
import { loadSpend, type SpendState } from '../lib/chain';
import { DataOrigin } from './DataOrigin';

/**
 * The agent's own wallet, and the models it may reach for.
 *
 * Both of these have worked on chain since they were written and neither has
 * ever appeared in the interface, which is its own quiet untruth: a control
 * nobody can see is a control nobody can check.
 *
 * They belong together because they are the same problem. An agent that pays
 * per call for its own inference is an agent with a wallet and a loop, which
 * is how other people's agents emptied other people's wallets. The answer
 * here is two separate ceilings, and the cheapest answer of all is a model
 * the client already pays for, where the key never reaches us.
 */
export const AgentSpend: React.FC<{ owner: PublicKey }> = ({ owner }) => {
  const [spend, setSpend] = useState<SpendState | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    loadSpend(owner).then((s) => {
      if (live) setSpend(s);
    });
    return () => {
      live = false;
    };
  }, [owner]);

  const [whyOpen, setWhyOpen] = useState(false);

  const sol = (n: number) => `${(n / 1e9).toFixed(4)} SOL`;

  return (
    <section className="glass-card flex flex-col gap-2.5" id="agent-spend">
      <div className="card-topbar">
        <span className="meta-kicker">What the agent may spend on itself</span>
        <span className="flex items-center gap-2">
          {/* The reasoning is long and correct and nobody needs it before
              they have looked at the numbers. It moved into a sheet, which
              is what this app already does for anything that is reading
              rather than a one line reveal. */}
          <button
            type="button"
            className="vault-key-refresh"
            aria-haspopup="dialog"
            onClick={() => { tactile.selectionTap(); setWhyOpen(true); }}
          >
            why
          </button>
          <DataOrigin origin={spend && spend !== 'loading' ? 'chain' : 'sample'} />
        </span>
      </div>

      <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
        The sentence bounds what the agent may do with your money. This bounds
        what it may do with its own: two ceilings, and you set both.
      </p>

      {spend === 'loading' && (
        <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">
          Asking the chain.
        </p>
      )}

      {spend === null && (
        <p className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
          No allowance opened for this account yet. Until one is, the agent
          cannot spend anything at all, which is the safe resting state rather
          than an omission.
        </p>
      )}

      {spend && spend !== 'loading' && (
        <div className="flex flex-col gap-1.5">
          {[
            ['Ceiling', sol(spend.ceilingLamports), 'per ' + Math.round(spend.periodSecs / 3600) + 'h'],
            ['Spent this period', sol(spend.spentLamports), ''],
            ['Paid, all time', sol(spend.lifetimeLamports), spend.payments + ' payments'],
            ['Refused', String(spend.refusals), 'stopped at the ceiling'],
          ].map(([k, v, note]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-3 px-2.5 py-1.5 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)]"
            >
              <span className="text-[11px] text-[var(--text-secondary)]">{k}</span>
              <span className="flex items-baseline gap-2 shrink-0">
                <span className="font-mono text-[11.5px] font-bold text-[var(--text-primary)] tabular-nums">
                  {v}
                </span>
                {note && (
                  <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {note}
                  </span>
                )}
              </span>
            </div>
          ))}

        </div>
      )}

  

      {whyOpen && createPortal(
        <div className="agent-sheet-scrim" onClick={() => setWhyOpen(false)}>
          <div
            className="agent-sheet brief-sheet"
            role="dialog"
            aria-label="Before it can even sign"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="agent-sheet-head">
              <span className="meta-kicker">Before it can even sign</span>
              <button
                type="button"
                className="agent-sheet-x"
                onClick={() => setWhyOpen(false)}
                aria-label="close"
              >
                ✕
              </button>
            </div>

            <div className="ows">
              <div className="ows-head">
                <span className="ows-tag">Open Wallet Standard · x402</span>
              </div>
              <p className="ows-note">
                An agent that pays per call for its own thinking is a wallet
                and a loop, which is how other people's agents emptied other
                people's wallets.
              </p>
              <p className="ows-note">
                The agent's key is held by an OWS signing core, which is the
                part that is genuinely hard and the part OWS does well: the
                model never sees the key, the core decrypts in hardened
                memory, signs, and wipes. What OWS does not ship is a spend
                cap. Its own rules are which chains a key may use and when the
                grant runs out, and its docs say a ceiling has to be written
                as an executable policy.
              </p>
              <p className="ows-note">
                An executable policy is a file on the agent's own machine,
                under the same operator, which is fine for an operator
                protecting itself and no use to a client who wants a number
                they can check. So the policy here holds no number. It reads
                the two figures on the card off this account, which you wrote
                and the agent cannot raise, and refuses anything that would
                not fit.
              </p>
              <div className="ows-rules">
                {[
                  ['no account', 'deny', 'nothing opened, so nothing may be spent'],
                  ['over the ceiling', 'deny', 'the period total would not fit'],
                  ['wrong agent', 'deny', 'not the key this account names'],
                  ['cannot read the chain', 'deny', 'an unreadable ceiling is not an absent one'],
                  ['inside it', 'allow', 'and the program checks again anyway'],
                ].map(([when, verdict, why]) => (
                  <div key={when} className={`ows-rule ows-${verdict}`}>
                    <span className="ows-verdict">{verdict}</span>
                    <span className="ows-when">{when}</span>
                    <span className="ows-why">{why}</span>
                  </div>
                ))}
              </div>
              <p className="ows-note ows-quiet">
                Four of the five are denials and the last one defers, which is
                the shape a policy should have: it fails closed, so one that
                cannot reach the chain stops the agent rather than waving it
                through. Run it with no environment set and it answers{' '}
                <code>{'{"decision":"deny"}'}</code> and a reason. Payment then
                runs through the program as well, so there is no route to the
                money that skips the check, and refusals are counted next to
                payments because how often the agent was stopped from spending
                is the same kind of fact as how often it was stopped from
                trading. The policy is <code>scripts/ows-policy.mjs</code>, and
                it is the authority; this only says what it does.
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
};
