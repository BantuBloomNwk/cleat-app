import React, { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { KeyRound, Check } from 'lucide-react';
import {
  connection, decodeVerdictLog, newestVerdict, reasonText, verdictCount,
} from '../lib/chain';
import {
  PROVIDERS, chooseProvider, chosenProvider, keyStore, providerReady, type Provider,
} from '../lib/models';
import { SECTORS, draftProposal, type Draft } from '../lib/propose';
import type { AgentMood } from './AgentAvatar';
import { tactile } from '../utils/haptics';

/**
 * Tell your agent what you want, in a sentence, and watch it get refused.
 *
 * Everything else on this screen is the agent proposing things on its own
 * schedule. This is the one place a person can put an idea into it and see
 * the whole path in a few seconds: a model they brought turns the sentence
 * into a proposal, the proposal goes to the confidential gate on devnet, and
 * the mascot above reacts to whatever comes back.
 *
 * The division of labour is the argument the product makes, so it is worth
 * being exact about which half is which. The model is theirs, runs on their
 * key, and is consulted only about what to ask for. The refusal is ours, runs
 * in a program and a circuit, and is not consulted about anything: it reads
 * the caps out of the mandate account and answers. Swap the model and the
 * same refusal lands, which is the demonstration.
 *
 * What the agent may not do here is say what is already held. That number is
 * the secret the gate turns on, it stays on the server side of this call, and
 * a proposal that could declare it would have turned a confidential check
 * into a lookup.
 */

interface Verdict {
  status: 'cleared' | 'trimmed' | 'refused';
  reason: string;
  ms?: number;
  signature?: string;
  explorer?: string;
}

export const AgentBrief: React.FC<{
  /** So the mascot above reacts to what the agent just had done to it. */
  onMood: (m: AgentMood) => void;
}> = ({ onMood }) => {
  const [provider, setProvider] = useState<Provider>(() => chosenProvider());
  const [open, setOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [ready, setReady] = useState(false);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState<'thinking' | 'gating' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Unsealing asks for the passkey, so it happens once when this panel is
  // first opened rather than on every page load.
  useEffect(() => {
    if (!open) return;
    keyStore.unlock().then(() => setReady(providerReady(provider)));
  }, [open, provider]);

  useEffect(() => setReady(providerReady(provider)), [provider]);

  const pick = (p: Provider) => {
    tactile.selectionTap();
    chooseProvider(p.id);
    setProvider(p);
    setErr(null);
  };

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    await keyStore.set(provider.id, keyDraft.trim());
    setKeyDraft('');
    setReady(providerReady(provider));
    tactile.mandateAction();
  };

  const run = async () => {
    if (!intent.trim()) return;
    setErr(null);
    setDraft(null);
    setVerdict(null);
    onMood('thinking');
    setBusy('thinking');
    try {
      const { draft: d } = await draftProposal(intent.trim());
      setDraft(d);
      setBusy('gating');
      // Straight into the real gate. The scenario supplies the book it is
      // checked against, because what is already held is not the caller's to
      // declare; the ask is entirely theirs.
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scenario: 'nearcap',
          ask: { category: d.category, bps: d.bps, side: d.side },
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.error) {
        throw new Error(body?.error ?? `the gate said ${res.status}`);
      }
      if (!body.log || !body.computation) {
        throw new Error('the gate took the proposal but did not say where to read it');
      }

      // The queue transaction does not carry the answer. The circuit runs,
      // a callback writes a verdict into the log, and the only honest place
      // to read it is off the chain, which is the same reason the box on the
      // Log tab reads it that way rather than believing a response body.
      const log = new PublicKey(body.log);
      let before = 0;
      try {
        const info = await connection.getAccountInfo(log);
        before = info ? verdictCount(decodeVerdictLog(new Uint8Array(info.data))) : 0;
      } catch { before = 0; }

      const startedAt = Date.now();
      let v: Verdict | null = null;
      for (let waited = 0; waited < 90_000 && !v; waited += 1500) {
        await new Promise((r) => setTimeout(r, 1500));
        let info;
        try { info = await connection.getAccountInfo(log); } catch { continue; }
        if (!info) continue;
        const data = new Uint8Array(info.data);
        if (verdictCount(decodeVerdictLog(data)) <= before) continue;
        const nv = newestVerdict(data);
        if (!nv) continue;
        v = {
          status: nv.outcome === 0 ? 'cleared' : nv.outcome === 1 ? 'trimmed' : 'refused',
          reason: reasonText(nv.reason),
          ms: Date.now() - startedAt,
          signature: body.signature,
          explorer: body.explorer,
        };
      }
      if (!v) throw new Error('the circuit did not answer inside ninety seconds');

      setVerdict(v);
      tactile.ledgerTrigger(v.status);
      onMood(v.status as AgentMood);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      onMood('idle');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="brief">
      <button
        type="button"
        className="brief-toggle"
        onClick={() => { tactile.selectionTap(); setOpen((o) => !o); }}
        aria-expanded={open}
      >
        <span>{open ? 'Close' : 'Give it something to try'}</span>
        <span className="brief-provider">{provider.name}{ready ? '' : ' · no key'}</span>
      </button>

      {open && (
        <div className="brief-body">
          <p className="brief-note">
            Your model has the idea, and it runs on your key from this browser.
            The refusal is not its to make: that happens in the program and in
            the circuit, against the caps your sentence set. Swap the model and
            the same answer lands, which is the whole point.
          </p>

          <div className="brief-providers">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`brief-chip${p.id === provider.id ? ' is-on' : ''}`}
                onClick={() => pick(p)}
              >
                {p.name}
                {keyStore.stored(p.id) && <Check size={11} strokeWidth={3} />}
              </button>
            ))}
          </div>

          <p className="brief-privacy">{provider.privacy}</p>

          {provider.needsKey && !ready && (
            <div className="brief-key">
              <KeyRound size={13} className="shrink-0 text-[var(--text-tertiary)]" />
              <input
                type="password"
                className="brief-input"
                placeholder={`Your ${provider.name} key`}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="mesh-chip" onClick={saveKey}>keep it</button>
            </div>
          )}
          {provider.needsKey && ready && (
            <p className="brief-privacy">
              Key held, sealed in this browser under your passkey.{' '}
              <button
                type="button"
                className="brief-link"
                onClick={() => { keyStore.clear(provider.id); setReady(false); }}
              >
                forget it
              </button>
            </p>
          )}

          <div className="brief-ask">
            <input
              className="brief-input"
              placeholder="add three percent of energy"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            />
            <button
              type="button"
              className="btn-inject btn-inject-sm"
              disabled={!!busy || !intent.trim() || (provider.needsKey && !ready)}
              onClick={run}
            >
              {busy === 'thinking' ? 'Thinking…' : busy === 'gating' ? 'At the gate…' : 'Ask'}
            </button>
          </div>

          {draft && (
            <p className="brief-draft">
              It asked for <strong>{(draft.bps / 100).toFixed(draft.bps % 100 ? 2 : 0)}%</strong>
              {' '}{draft.side === 1 ? 'out of' : 'into'} <strong>{SECTORS[draft.category]}</strong>.
              {draft.why && <span className="brief-why"> “{draft.why}”</span>}
            </p>
          )}

          {busy === 'gating' && (
            <p className="brief-privacy">
              The circuit is deciding. It takes a few seconds, and the answer
              is read back off the chain rather than reported from here.
            </p>
          )}

          {verdict && (
            <div className={`brief-verdict brief-${verdict.status}`}>
              <span className="brief-verdict-word">{verdict.status}</span>
              <span>{verdict.reason}</span>
              {verdict.ms !== undefined && (
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                  {(verdict.ms / 1000).toFixed(1)}s
                </span>
              )}
              {verdict.explorer && (
                <a href={verdict.explorer} target="_blank" rel="noreferrer noopener" className="brief-link">
                  read it on chain
                </a>
              )}
            </div>
          )}

          {err && <p className="brief-err">{err}</p>}
        </div>
      )}
    </section>
  );
};
