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

## The wedge

**Investing, robo portfolios.** Stocklana's own wording, and the honest fit: an agent
managing a slice of a portfolio against a stated policy is a robo portfolio, with nothing
stretched to make it fit. One line: **a robo portfolio whose manager cannot see the
portfolio.**

Consumer and Infrastructure are built properly rather than gestured at. They are simply
not what we lead with.

- **Consumer, social trading.** Mandate adoption, rule cards, the diary. Leading here
  invites the FOMO comparison, which we lose on distribution and on the volatility of the
  underlying. It is the surface, not the pitch.
- **Infrastructure, compliance.** The verdict log is a public, queryable record of what an
  agent was stopped from doing. Leading here reads as a feature rather than a product and
  buries the demo. It is the mechanism, not the pitch.

**The framing that survives contact with a regulator, and the only one to use in the
README, the video and the UI:** a self-directed account with an automated order-entry
assistant, bounded by a policy the client wrote. Not discretionary advice, not a fund.
"Robo portfolio" is the category; it is not a description of the legal relationship.

## Every timeframe, not just buy and hold

A mandate is a **strategy container, not a risk preset**. "Never hold overnight, two
percent a position, stop out at three percent down" is a mandate. So is an options mandate
with a delta cap, a swing mandate, a long-only index mandate. The caps differ, the gate does
not care which timeframe it is enforcing.

This is not breadth for its own sake, it repairs the retention argument. Tokenized equities
move about a percent a day, so a buy-and-hold mandate produces almost nothing to come back
for. A day-trading mandate produces dozens of decisions a day, and every one is an entry in
the diary. **Day trading is what solves the content cadence problem that long-term investing
cannot.** Never build anything that assumes a single holding period.

Consequence for the discipline streak: it is per mandate and counts decisions, not days.
An investor sees "held for 34 days", a day trader sees "held through 214 decisions". Same
primitive, honest at both ends.

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

## The home screen is the agent's diary

Not portfolio value. Decided deliberately, and it is the single most important layout call
in the product.

A robo portfolio is structurally the worst category for daily opens, because set and forget
is the pitch. So the daily content cannot be the price, which moves too slowly to be worth
returning for. **The daily content is the agent's behaviour.** What it wanted to do
overnight, what it did, and what the owner's own sentence stopped. That is an artifact a
passive fund cannot produce, it is personal because it is her rule being tested, and it is
the one screen with nothing private on it, so it is also the screen that can be shared.

**Build the chart.** An earlier draft of this file said not to, which was solving the wrong
problem: the risk was never that a chart exists, it was a *generic* chart competing with the
diary. A trader reads charts the way other people read sentences, and a trading product
without one does not respect its user. The question is what ours shows that nobody else's
can.

### The chart nobody else can draw

Pump.fun marks what people did. We can mark what people's rules would not let them do.

Real Pyth price for the instrument, then the decisions of every published mandate marked on
the time axis: cleared, trimmed, refused. At a price spike the chart visibly fills with
refusals, because that is precisely the moment a person would have chased it and a mandate
would not. Aggregated it becomes a **discipline heatmap**: at this level, fourteen mandates
were stopped.

This needs nothing new on chain. The verdict log already publishes, per decision, the
sector, the size as a fraction of the portfolio, the outcome, the reason and the slot. No
ticker, no amount, no resulting position. So decisions are plottable already and holdings
still are not.

It is also a chart no other trading app can render, because no other app knows what was
prevented. And it tells a story about discipline rather than about dopamine, which is the
whole difference between our chart and the one worth rejecting.

The loop, at three speeds:

- **Daily.** The diary. What was proposed, cleared, trimmed, refused.
- **Weekly.** Every refusal is an invitation to edit one sentence. "Three technology trades
  stopped by your fifteen percent cap. Raise it?" That is agency, and it is the opposite of
  a passive product.
- **Ongoing.** Other people's mandates as reading material. Not a trade feed. A sentence
  that beat yours is browsable and argues with you.

## Published or private, the switch the privacy claim lives on

**A published mandate's diary is public. A private mandate publishes nothing.**

If a sentence is published for other people to adopt, its decision record *is* the track
record, and hiding it would make adoption blind faith, which is the thing this product
exists to remove. A mandate kept to oneself emits no verdicts at all.

The honest cost, which must be a deliberate choice in the UI and never a default somebody
stumbles into: publishing sector, ratio and timing on every decision, continuously, leaks
the *shape* of a published mandate over time. Not positions and not sizes, but a determined
observer could infer its tilts. That is intended for a published mandate and unacceptable
for a private one, so the switch gets plain words next to it explaining exactly that.

## Adopting a rule is not copy trading, and it is better

`adopt_mandate` copies the sentence, never the positions. The adopter's agent runs that
sentence against their own portfolio, from their own starting point, at their own size.
Neither party ever learns what the other holds.

Say this explicitly wherever copy trading comes up, because it answers the sharpest
criticism of the entire category. In conventional copy trading a follower inherits the
leader's entry and sizing, which is the mechanism by which followers become exit liquidity
and by which a leader's edge decays as their following grows. **Here there is no order to
front-run, only a rule.** That is structural, not a promise.

## Status is adoptions, never PnL

The leaderboard metric is how many people run your sentence. "One thousand two hundred
people run this" is a claim about authorship and judgement, it survives a bad month, and it
cannot be won by luck. Ranking by returns rewards whoever took the most risk in the
luckiest month, which is how every app in this category ends up teaching people to gamble.

The one gamified beat worth having is comparative discipline under stress: your rule held
through a spike where two hundred others were refused. Privacy safe, genuinely earned, and
it is the thing people screenshot.

## The format, and why a feed is the wrong one

Social trading apps look like trading because they took their unit of content from the
terminal. A trade is an event: it happened, it is finished, it belongs in a feed. So they
built feeds, and the result reads as a terminal with avatars.

Stories worked because of a social contract rather than a layout: it disappears, therefore
posting is safe. Our contract is the inverse and stronger: **it never appeared.** Publishing
a mandate costs nothing, because it carries no holding, no size and no entry price. On a
position-sharing app, posting exposes you. Here it cannot. That is what makes a social layer
safe for someone who would never post a position, and it is privacy doing the work rather
than privacy getting in the way.

So the unit is a **standing order**: a sentence that is currently running, with a pulse, a
lineage and a record. Not a post, because it is alive and stateful rather than finished. Not
a story, because it persists. Not a leaderboard row, because the content is prose you can
disagree with. You do not scroll outcomes, you read intentions and watch them work, and one
tap runs somebody's sentence yourself.

**Rule cards, never trade cards.** A winning-trade card leaks the instrument and the size,
which is the one thing this product cannot do. A rule card carries the sentence, its
verified return and how many times it was refused. It is shareable, it is honest, and it
credits judgement rather than a lucky fill, which is what a trader actually wants credit
for.

## The agent's intelligence is not the moat

Anyone can call the same models. Competing on "our agent is smarter" is an unverifiable
claim in a category where every entrant makes it, so the product does not make it. The
stronger and checkable position is the inverse: **the agent can be as good or as bad as any
other and it does not matter, because it cannot exceed the sentence its owner wrote.**

So let the user choose the model, and say so. Nobody else offers it, it costs almost
nothing, and it proves the point: if the model is swappable and the boundary still holds,
the boundary is obviously what is doing the work.

**Voice, with one hard line.** Speaking a mandate is more natural than typing it and it
removes the form entirely for a non-crypto user. So voice writes rules, only, and only from
an authenticated owner. **Voice never places a trade.** Audio the agent hears is ingestion,
and ingestion is exactly the channel that emptied the Grok wallet. The line to use: you can
speak your rules, and nothing the agent hears can change them.

### Does paying per call remove the need for more than one model

No, and it changes why we want them.

The original reasons for a spread of models were the ordinary ones: privacy,
resilience, cost. Two of those turn out not to apply here. Privacy barely does,
because the agent is blind by construction: it reasons over prices, headlines and
the mandate, and there is no holding in its prompt to leak. The one sensitive
thing it ever sees is the sentence the client wrote, which is why mandate
compilation is the step that should stay local and the only step that has to.
Cost stops being an argument for a spread the moment payment is per call, because
a second provider costs an account and a key and a contract, and under x402 it
costs nothing at all: the agent pays whoever answers, from one capped wallet.

What survives is the reason already written above, and it is the strongest one.
**The model is swappable so that the boundary is obviously what is doing the
work.** That is a claim you demonstrate by switching models mid demo and watching
the same refusal land, and x402 is what makes switching free enough to actually
do it on stage rather than describe it.

So: many models reachable, one at a time, chosen by the client, paid for per call
out of an allowance the client set. Not a committee of models voting, which would
be cost dressed up as rigour.

### What happens when the allowance runs out

It stops proposing. That is the whole failure mode, and it is worth saying
plainly because it is unusual.

Refusal in this system is deterministic and on chain. The caps are in the mandate
account, the check runs in the program, and none of it needs a model. Only the
*proposal* side is intelligent. So an agent that cannot pay for inference, or
whose allowance has lapsed, or that cannot reach a provider at all, degrades to
silence. It does not degrade to guessing, and it cannot degrade to acting.

**The failure mode of the spending cap is silence, not risk.** An agent that runs
out of money stops having ideas, and the boundary that stops bad ideas was never
the part that cost anything to run.

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

## Edge items, in order of value per hour

1. **Let judges attack it themselves.** A page where anyone types a poisoned headline,
   watches the agent's reasoning get pushed around, and watches the chain refuse the trade
   anyway. Turns the strongest claim from a video moment into something tested by hand.
2. **Show the absence, not the claim.** A view of exactly what our own operator sees: the
   encrypted blob, the verdict, nothing else. Proving you cannot see something is far more
   convincing than saying so, and it is a dump of real account data.
3. **A permalink for every refusal.** Category, ratio, verdict, reason, on-chain reference,
   no holdings anywhere. The shareable object, and the compliance record, in one artifact.
4. **Publish the measured numbers.** Circuit cost, verdict latency, the attested rollup's
   seal and read times. Most entries assert performance; almost none show it.

## The instruments are real, and so is the calendar

Backpack Securities is a registered US broker dealer issuing tokenized
equities on Solana, and in September 2026 its CEO opened mint and redeem to
any developer building stocks on Solana. Backpack and Sunrise are the two
outlets actually bringing equities onto this chain, so building against
them is the difference between a demo with invented tickers and something a
person could use.

Four of their endpoints need no key and no account, and they are wired in:

- `securities` is the tradable universe, about eleven hundred names, each
  with a cusip and, per session, the minimum quantity and the step size the
  venue will accept.
- `market-sessions` is the four real US equity sessions with their hours in
  New York: pre-market 04:00 to 09:30, regular 09:30 to 16:00, after hours
  16:00 to 20:00, overnight 20:00 to 04:00.
- `market-holidays` is the closures, including the overnight eves that shut
  early.
- `markets` says which of those names actually have a market, and whether
  it is spot or perpetual.

This is not decoration, and it repairs a specific weakness. **A mandate that
says "never hold overnight" was a sentence the app could store and not
enforce**, because nothing in it knew when overnight was. Now something
does, and it is the exchange's own definition rather than a number we
picked. The same applies to the clamp: a cap expressed as a share of the
book has to come out as a quantity the venue will take, so it has to land
on a real step size. A cap that produces 3.14159 shares of something quoted
in whole shares was described, not enforced.

It also settles the tickers question. They are real names now, with real
cusips, fetched at runtime.

### Minting and redeeming, and why it is not in the browser

The public docs and the official Rust client carry no mint or redeem route.
What they carry is the flow underneath it: a security entitlement is
tokenized by **withdrawing it to Solana**, and redeemed by **depositing it
back**, through an account Backpack has onboarded. So "one API call" is
real but it is an authenticated, KYC'd call, signed with a client's own
credentials.

That means it can never run in a page, and the split is the same one this
whole product is built on: public market structure in the client, anything
bearing a client's credentials on a server acting with their consent. When
Cleat custodies, it is this path, and the framing does not change: a
self-directed account with an automated order-entry assistant, bounded by a
policy the client wrote.

## Accessibility & Inclusion

Assumed default, flagged for correction: WCAG 2.2 AA. Never colour alone to convey
meaning, which principle 2 already enforces. Full `prefers-reduced-motion` support with
the refusal moment degrading to a state change rather than being removed. Minimum 44px
touch targets. Legible at 320px width and at 200% text zoom. Tested against bright
outdoor ambient light, which is the stated primary context.

Onboarding uses passkeys, so no seed phrase and no wallet vocabulary reaches the user.
