# Cleat

An agent that trades part of your portfolio and cannot see what is in it.

You write one sentence about how you want your money handled. Something like
"moderate growth, nothing over fifteen percent in one name, no fossil fuels."
That sentence becomes an account on Solana. An agent reads public market data,
proposes trades against it, and every proposal is checked against your sentence
inside a confidential computation that never learns what you hold. The answer
that comes back is one of three words: cleared, trimmed, refused.

Legally, this is a self-directed account with an automated order-entry
assistant, bounded by a policy the client wrote. It is not advice and it is not
a fund. You keep the account. The agent gets a key with an expiry and a ceiling,
and it never gets a path to your positions.

**Live preview:** https://cleat-preview.netlify.app  
**Program:** `2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL` on devnet

## Why this needs to exist

Handing money to an autonomous agent currently means handing it everything. It
sees your balances, it holds your keys, and the only thing standing between you
and a bad afternoon is that the agent behaves. That has not gone well. An agent
with a wallet and a loop is one bad input away from spending all of it, and
plenty have.

The usual answer is to make the agent smarter. That is unfalsifiable and every
company selling an agent claims it. Cleat takes the opposite position, and it is
one you can check: **the agent can be as good or as bad as any other, and it
does not matter, because it cannot exceed the sentence you wrote.**

Swap the model and the boundary holds. That is the demo.

## The four pieces

**Your sentence, compiled.** The mandate lives in an account you own. It carries
the text, a hash of the text as you signed it, the assets it rules out by name,
and the caps the program actually enforces: the most that may sit in one sector,
the most a single trade may be, the widest book it may trade into. The agent has
no write path to any of it. Every edit bumps a version, and a proposal checked
against a stale version is refused on sight, so nothing the agent reads can talk
your rules into changing.

It also carries a switch that stops everything. That lives on the mandate rather
than on the vault for a specific reason: a vault handed to the rollup for
execution is not yours to write to on the main chain until it comes back, so a
kill switch kept there would need the rollup to be answering. A mandate is never
handed anywhere. One transaction, always available, and a computation already
running when you throw it comes back refused.

**The gate.** When the agent proposes a trade, your current exposure goes to
Arcium's MPC network encrypted to your own key. The circuit adds the proposed
size, compares it to your cap, and returns one bit: would this break it. The
size of the position that decided it is never revealed, not to this program, not
to whoever runs the agent, not to us. Your updated exposure comes back sealed to
your key, so you get your position advanced without anyone having read it.

**Execution.** Approved trades run in MagicBlock's ephemeral rollup inside an
Intel TDX enclave, which answers an attestation query. Measured on devnet: 1.8
seconds to verify attestation, 36 millisecond median from submit to confirm.

**The diary.** Every decision lands in a ring buffer on chain: the sector, the
size as a share of the book, the outcome, the reason, the slot. Alongside it,
one running total per sector, which is what makes a position cap a position cap
rather than a cap on one trade at a time. No ticker, no amount, no resulting
position. That is the deliberate part. It means the record
of what your agent was stopped from doing is public and checkable, while what you
own stays yours. It is also the one screen with nothing private on it, which is
why it is the home screen and the thing people can share.

## What is real right now

The devnet log for the demo owner holds fourteen decisions: four cleared, two
trimmed, eight refused. Between them they exercise every reason the program has
except one, and the missing one is the easy case where a mandate was edited
after the grant was issued.

Three of them are worth pointing at.

One was refused because the instruction to make it arrived inside something the
agent had read. A proposal that originates in ingested content is refused
regardless of size. That is the failure mode that emptied other people's
wallets, and here it is a recorded outcome with its own reason code.

One was refused for naming Exxon. The mandate says no fossil fuels, which the
program cannot read, so the clause is resolved off chain into a list of mints
and the list is what gets enforced. The mints are real ones, live on Solana
today, so a reader can go and check.

Four near the end are each well inside every cap on their own, and the last two
are stopped by what came before them. Two percent goes through, then another
two, then three is trimmed to the two percent of room that is left, and the one
after that is refused because there is no room at all. Nothing about those four
is large. What stops them is the running total, and until this week there was
not one, so all four would have cleared and the book would have sat at twenty
percent under a sentence that says fifteen.

The owner appears twice in the middle of the run. Once to lower what a single
trade may cost in cash, after which a proposal unchanged in percentage terms is
refused. Once to halt the mandate outright, after which nothing proposes at all
until they lift it. Both are one transaction, both need their signature, and
neither is available to the agent.

The app reads that log directly off devnet. Nothing on the diary screen is
seeded.

Market data is real and it is not ours. Backpack Securities publishes the
tradable universe, the session calendar and live quotes without a key, so the
app shows the instruments the agent actually works against, priced by the venue
they trade on. As this is written, on a Sunday with the New York exchanges shut,
nineteen tokenized equity markets are quoting and have done just under fourteen
thousand trades in a day.

That last detail matters more than it looks. These assets do not keep New York's
hours, which is the entire reason they are worth holding if you are not in New
York. It also means the boundary matters most when the legacy market is closed:
books are thin, spreads are wide, nothing halts trading, and the owner is
asleep. Right now, same venue and same minute, one name quotes at half a basis
point across seventy eight levels and another at thirty two across eleven. An
agent that treats those as the same market is what this exists to stop, so the
width of the book sits on screen next to the price.

## What the agent may spend on itself

An agent that pays per call for its own inference is an agent with a wallet and
a loop, so there is a second ceiling, separate from the mandate.

Open Wallet Standard holds the agent's key properly. The agent carries a token,
the signing core decrypts in hardened memory, signs and wipes, and the key never
enters the model's context. What it does not ship is a spend cap. Its own rules
cover which chain a key may use and when the grant expires, and its docs say a
ceiling has to be written as an executable policy. An executable policy is a
file on the agent's own machine, under the same operator. That is fine for an
operator protecting itself and no use at all to a client who wants a number they
can check.

So the number lives on chain, you set it, the agent cannot raise it, and the
payment runs through the program. There is no route to the money that skips the
check. Refusals are counted next to payments, because how often the agent was
stopped from spending is the same kind of fact as how often it was stopped from
trading, and showing people that number is the product.

The failure mode is worth stating because it is unusual. Refusal here is
deterministic and on chain, and none of it needs a model. Only the proposing
side is intelligent. So an agent that runs out of allowance stops having ideas.
It cannot degrade into guessing and it cannot degrade into acting.

## What is not true yet, stated plainly

Judges and users should hear this from us rather than find it.

**Minting a tokenized share requires KYC. Holding one does not.** Turning a real
security entitlement into a token runs through a registered broker dealer and
there is no anonymous version of that. But we checked the tokens themselves on
mainnet, and both Backpack's SPCX and Backed's AAPLx have no transfer hook wired
and do not freeze new accounts. So someone in Lagos or Kuala Lumpur can buy one
on a decentralised exchange with USDC and hold it in an ordinary wallet, having
never met the issuer. That is the path that works for everyone, and it is what
this is built on.

**The issuer keeps a standing override.** Those same tokens carry a permanent
delegate, a freeze authority and a pause switch. The issuer can move or freeze
anyone's holding without their signature. This is the industry pattern rather
than one issuer's flaw, and it means "not custodial" is true of Cleat and the
agent, and not true of the token's issuer. Anyone building here should say so.

**A perpetual is not a share.** Cash settled, nothing behind it, and on a single
name that makes it a security based swap, which is more restricted than the
share, not a shortcut around anything. The app defaults to spot and labels every
row.

**The confidential gate is not passing yet.** The circuit compiles, uploads and
finalises, the network runs it, the callback is delivered, and the computation
comes back a signed failure. We found why late: an `Enc<Shared, T>` carries the
caller's key so the circuit can seal a result back to them, our circuit only
revealed a bit and never touched that key, and the compiler had been saying so
on every build while we theorised about the arithmetic. The current version
seals the updated exposure back and the warning is gone. It is deploying as this
is written. The rest of the system runs without it; the gate is the part that
makes the guarantee confidential rather than merely enforced.

## Running it

```bash
# the program and the circuit. never plain `arcium build`, it rewrites declare_id
arcium build --skip-program --skip-keys-sync
anchor build --ignore-keys

# the confidential gate: create the computation definition, upload, finalise
node scripts/gate-setup.mjs

# two proposals identical from outside, differing only in a holding nobody sees
node scripts/gate-run.mjs

# fourteen proposals through the public policy engine, every reason it has
node scripts/verdicts.mjs

# the spending ceiling, demonstrated
node scripts/spend-demo.mjs

# every Arcium and Anchor pin agrees across the program, the circuit
# compiler, the cli and the javascript client
node scripts/check-pins.mjs
```

The app:

```bash
cd app && npm install && npm run dev
```

`SECURITY.md` says what this program can do when it misbehaves, what has
been checked, and what has not, including the things that are known and
accepted rather than hidden.

`TOOLCHAIN.md` is worth reading before touching the Arcium side. It records five
theories that were wrong and the cheap evidence that would have settled it on
day one.

## Layout

```
programs/cleat/      the Anchor program: mandate, vault, verdict log, gate, spend
encrypted-ixs/       the Arcis circuit
app/                 React and Vite, with a function proxying market data
scripts/             setup, gate, spend demo, the OWS policy, the pin check
PRODUCT.md           what this is for and what it refuses to be
DESIGN.md            the visual system
TOOLCHAIN.md         how to not lose a week to Arcium
```

## Credits

Built for Stocklana. Market data from Backpack Securities. Confidential compute
from Arcium. Attested execution from MagicBlock. Agent key custody follows Open
Wallet Standard, and the agent pays for its own work over x402.
