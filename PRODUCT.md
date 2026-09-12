# Product

## Register

product

## Users

Someone who has used a brokerage app and has never used a crypto wallet. They hold
tokenized equities and want part of the portfolio managed for them without handing a
company a window into what they own. Global, not region-targeted: the concern is
identical for a user in Frankfurt, Sao Paulo, Lagos or Kuala Lumpur.

Primary context: a mid-range Android phone, glanced at once or twice a day, often in
bright light, to answer one question. Did the agent do anything, and did the boundary
hold. They are not sitting at a desk watching a chart.

Job to be done: state what I want in my own words, once, then trust that nothing the
agent reads can talk it into something I did not agree to.

## Product Purpose

An AI agent manages a slice of a tokenized-equity portfolio and is cryptographically
blind to that portfolio. Positions live as encrypted balances inside Arcium's MPC
network, so no party including this product's own operator sees a position. A mandate
written in plain English compiles once into an on-chain policy account the agent has no
write path to. The agent proposes trades from public data only. A narrow MPC circuit
returns approve, reject, or clamp, never the holdings. Approved trades execute in
MagicBlock's TEE-attested ephemeral rollup under caps the agent cannot widen.

Success looks like a user who wrote one sentence, has never seen a chart, and can point
at a trade that was refused.

## Brand Personality

Calm, confident, plainspoken. Three words: composed, candid, warm.

The emotional goal is the feeling of dealing with a good manager rather than operating a
machine. Fun comes from the interaction being satisfying and from other people's writing
being interesting, never from decoration, celebration or streaks.

Voice: short declarative sentences. Never explain the cryptography to a user who did not
ask. Never say shielded, zk, MPC, protocol or non-custodial in the interface. Say what
happened and what it means for them.

## Anti-references

All four rejected explicitly by the founder:

- **Robinhood confetti.** No celebration on trades, no streaks, no nudges toward volume.
  This is also what regulators fined Robinhood over, so it is a liability, not a style.
- **Bloomberg terminal.** No dense grids, no tickers, no candlesticks, no green on black.
- **Crypto neon on black.** No purple-to-cyan gradients, no glow, no glassmorphism. This
  would also make the product look identical to the seven confidential-trading projects
  it competes against.
- **FOMO and copy-trade feeds.** No infinite scroll of other people's trades, no follower
  count as the primary currency, no feed-first structure.

## Strategic principles

1. **The mandate is the interface.** The primary object is a sentence a person wrote, not
   an order ticket and not a position. The largest type on any screen is prose, not a
   number. The primary verb is fork, not buy.
2. **Colour means whether the boundary held, never whether money went up.** Every trading
   product encodes gain and loss in red and green. Here colour is reserved for policy
   state: cleared, clamped, refused. Performance is encoded typographically and
   positionally. This is simultaneously the accessible choice and the on-message one.
3. **A refusal is the product working, so show it like a feature.** The one moment of
   real motion and real colour in the whole app is a trade being refused.
4. **Privacy is stated as a fact, never sold as a feature.** The interface says positions
   are not visible to anyone, once, plainly, and then behaves that way.
5. **Say program-custodied, never non-custodial.** Shares sit in a program-owned pool with
   withdrawal authorised by the user's key alone. Overclaiming here is the fastest way to
   lose a technical judge.

## Accessibility & Inclusion

Assumed default, flagged for correction: WCAG 2.2 AA. Never colour alone to convey
meaning, which principle 2 already enforces. Full `prefers-reduced-motion` support with
the refusal moment degrading to a state change rather than being removed. Minimum 44px
touch targets. Legible at 320px width and at 200% text zoom. Tested against bright
outdoor ambient light, which is the stated primary context.

Onboarding uses passkeys, so no seed phrase and no wallet vocabulary reaches the user.
