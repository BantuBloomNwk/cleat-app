# Security

What this program can do when it misbehaves, what has been checked, and
what has not. Written because a product whose argument is "you should not
have to trust it" owes a reader the specifics.

## The shape of the risk

Cleat never custodies a client's assets. The mandate is a policy account,
the verdict log is a record, the vault holds authority rather than value,
and the only instruction in the program that moves lamports is
`pay_agent_cost`, bounded by a ceiling the client set.

So the worst outcome from a bug here is a wrong verdict, a stuck
allowance, or a state change nobody asked for. It is not a drain. That is
a deliberate property rather than a lucky one, and it is worth preserving
as the program grows: **anything that would let this program move a
client's position is a change in its risk class, not a feature.**

## Who may call what

Every instruction, and the check that gates it.

| Instruction | Gate |
|---|---|
| `create_mandate` | signer becomes owner; PDA seeded by signer |
| `update_mandate` | `has_one = owner`, signer |
| `adopt_mandate` | child PDA seeded by adopter, so only your own |
| `open_vault` | signer becomes owner |
| `set_agent`, `revoke_agent` | `has_one = owner`, signer |
| `open_verdict_log` | `has_one = owner`, signer |
| `propose_trade` | owner, or the named agent while its grant is live |
| `delegate_vault` | vault PDA seeded by the signing owner |
| `seal_vault` | `has_one = owner`, signer |
| `release_vault` | `has_one = owner`, signer |
| `open_spend_account`, `set_spend_cap` | `has_one = owner`, signer |
| `fund_spend_account` | any signer, deliberately |
| `pay_agent_cost` | the exact agent the owner named |
| `init_gate_comp_def` | any signer, idempotent |
| `gate_trade` | owner, or the named agent while its grant is live |
| `gate_breach_v5_callback` | Arcium, and every account derived from a pending record seeded by the computation |
| `set_halted` | `has_one = owner`, signer, on an account that is never delegated |
| `set_book_size` | `has_one = owner`, signer |
| `set_position_handle` | `has_one = owner`, signer |
| `migrate_verdict_log` | signer, seeds and the stored owner both checked |

`fund_spend_account` taking any signer is intentional. Topping up an
agent's allowance is a gift, and nothing about receiving one is dangerous.
Raising the ceiling is the privileged act and that is owner only.

## Found and fixed

Everything below was found by reading the program against what it claims,
not by a tool. Each one was reproduced or traced to the line before it was
called real, and each is fixed in the deployed program.

**Anybody could write into anybody's verdict log.** This was the worst of
them. A callback receives the circuit's output and nothing else, so the
handler read the rest of its context back off whatever log account it was
handed. Arcium's macro validates that a genuine `callback_computation`
immediately precedes the callback, and reading
`arcium-macros/src/arcium_program_macro.rs` settled what it checks:
instruction ordering and a discriminator. It never looks at the accounts.
So a stranger could queue a cheap computation against their own vault,
name somebody else's log as the callback account, and push a verdict into
a record they have nothing to do with, evicting a real refusal out of a
sixteen entry ring. The public record of what an agent was stopped from
doing is the thing this product sells, and it was writable by anyone.

Fixed with a `Pending` account seeded by the computation itself. The
question is parked there when it is asked, and the callback derives the
log, the mandate and the rent destination from what is written in it
rather than from what it was handed. The computation account is the one
thing a callback receives that Arcium does guarantee.

**Two proposals in flight overwrote each other.** The same four fields
lived on the log, one set per owner, so a second question asked before the
first was answered replaced the first's size and sector. Whichever callback
landed first then wrote a verdict pairing one computation's answer with the
other's question. The per computation `Pending` account fixes this for the
same reason it fixes the first one.

**The position cap was not a position cap.** Every proposal was judged on
its own size against the ceiling, with nothing carried between them. Ten
cleared trades at four percent each sat at forty percent under a mandate
that says fifteen, and all ten were recorded as cleared. A cap that only
ever sees one trade at a time is a trade cap wearing the wrong name. The
log now carries a running total per sector, entries add to it, exits take
away, and a proposal is trimmed to what is left or refused when nothing is.

**The deny list was never read.** A mandate could name mints it refused and
the program never looked at the field. "No fossil fuels" was text. A
proposal now names the instrument, and a named mint on the list is refused
regardless of size. The clause is still resolved off chain, because the
program cannot read English; what changed is that the resolution is now
enforced.

**The agent's cash ceiling was never read.** `agent_max_trade` was written
by `set_agent` and read by nothing. It is now checked on every entry, from
the vault's own declared book size rather than from anything the agent
says, and it is checked last so it can only refuse something that was
otherwise going to go through.

**The sealed exposure was just an argument.** `gate_trade` took the
encrypted holding as a parameter, so an agent that wanted a trade cleared
could seal a small number to its own key and ask the network about that
instead. The circuit would answer correctly about a fiction. The input is
now required to match the handle published on the vault, and that handle
moves only under the owner's signature.

**The gate recorded every verdict as mandate version zero.** A hardcoded
field in the callback. The log's whole claim is that a decision can be
matched to the sentence that was in force when it was made, and for the
confidential path it could not. The version is now taken from the pending
record, which captured it when the question was asked.

**A mandate edited mid computation was answered against the old one.** The
network takes seconds. An owner who tightened their caps inside that window
had the answer applied anyway. The callback now rereads the mandate and
records a refusal when the version has moved.

**`adopt_mandate` silently dropped the spread cap.** It copied the position
cap and the trade cap and not the third one, so every adopted mandate
arrived without a spread limit. Zero means the owner did not ask for one,
which is not what somebody adopting a mandate that has one is agreeing to.

**`seal_vault` accepted any signer.** The accounts struct took a `payer`
rather than an owner, and the vault is seeded from `vault.owner` rather
than from the signer, so a stranger could seal somebody else's vault. They
could not add themselves to the member list and could not change a flag,
so it was never a takeover. But the vault sponsors its own permission
account, which meant a stranger could spend another person's lamports on a
state change they did not ask for. Now `has_one = owner`, signer.

**The kill switch could be unreachable exactly when it was wanted.**
`revoke_agent` writes to the vault. A vault delegated to the ephemeral
rollup is owned by the delegation program on base, so the instruction
cannot execute there at all, and the only remaining route runs through the
rollup. A control that needs the rollup to answer is not a control you want
during whatever made you reach for it.

So the halt moved to the mandate, which is never delegated. One owner
signed transaction, on the account the owner has always held, and every
path that proposes anything reads it: the public engine refuses and records
why, the confidential gate refuses on the way in, and the gate's callback
refuses on the way out, so a computation already running when the switch is
thrown comes back refused rather than cleared. `revoke_agent` still exists
and is still the right thing for an ordinary revocation. The halt is the
one that works when nothing else does.

## Known, accepted, and written down rather than hidden

**Adoption counts are Sybil-able.** `adopt_mandate` increments the
parent's counter, and the child PDA is seeded by the adopter, so one wallet
can adopt a given mandate once. Inflating a count therefore costs one
funded wallet and one account's rent per point. That is not free but it is
cheap, and adoption is the social metric this product leads with. Before
this number is used for anything that matters, it needs a cost that scales
or an identity that does not.

**Two of the inputs are the agent's own word.** The program cannot see an
order book and cannot see where an instruction came from, so
`observed_spread_bps` and `from_ingested_content` both arrive from the
caller and a dishonest agent can lie about either. Worth being precise
about what each is for.

The spread check bounds an honest agent that would otherwise trade into an
illiquid market. It is not a defence against a hostile one.

The app now measures the same quantity instead of asking for it: price a
hundred dollars of the name through a router, price the real size, and the
gap is what the trade costs for being that large. That number is
independently checkable, because the endpoint is public and anyone can run
it again. It is not yet what the program checks against, and the gap
between those two is worth naming rather than blurring: the measurement is
verifiable, the argument the program receives is still whatever the caller
puts in it. Closing that means the measurement arriving with something
signed by whoever made it, and no venue here signs a quote today.

The ingested content flag is not a defence at all and was never meant as
one. It is a disclosure. An agent that has been talked into something by a
web page it read has no reason to admit it, and an agent that does admit it
gets refused. What actually defends against a prompt injection is that
nothing an agent reads can move a cap, a deny list, a version or a ceiling,
because every one of those needs the owner's signature. The flag exists so
that when the honest case does happen, the record says what happened rather
than recording a refusal with no reason attached.

Both are stated this way in the code as well, so nobody reads either as
more than it is.

**A deny list that names one issuer stops nothing.** The mandate rules out
assets by mint, and the same company exists at several addresses:
MicroStrategy is a Backpack token, Backed's MSTRx and Ondo's MSTRon all at
once, and Exxon and Chevron are each at two. An agent refused at the first
address routes to the second without breaking a rule, because the rule only
knew about the first. So a clause has to resolve across every issuer that
has wrapped the company, and the resolution has to be redone when a new
issuer appears rather than written once.

This runs into a real ceiling. A mandate holds eight mints, which at two to
three addresses per company is three companies, not a sector. A sentence
that rules out fossil fuels in general cannot be expressed today, and
saying otherwise would be the sort of claim this file exists to avoid.
Widening it means either a larger account or a commitment to a list held
off chain, and the second one gives back the property that makes the first
one worth having.

**The issuer field is not always populated.** Sunrise lists forty six
tokenized shares and one of them, Nike, carries no issuer at all today.
Code that assumes the field is set reports the wrong issuer rather than an
unknown one, which is the same class of mistake as a shifted account field.

**Quoting is geofenced, and that check belongs in the browser.** Asking
Sunrise what a trade would cost returns 403 GEO_BLOCKED depending on where
the request came from. Proxying it through a function on this origin would
move the check to whichever region the host runs in, which for this project
is not the region any user is in, and would answer a question nobody asked.
So the browser asks directly, the CSP names that one origin, and when the
answer is no the app says so. The listing of which mint is which is not
geofenced and does go through a function here, where it can be cached.

**The book size is declared rather than custodied.** `set_book_size` is
how the owner says what the percentages are percentages of, because the
vault holds authority rather than value. An owner who understates it makes
their own cash ceiling tighter and an owner who overstates it makes it
looser, and either way it is their own money and their own signature. It is
not a number an agent can touch. When the vault custodies assets this field
stops being a declaration and starts being a balance, and that is the point
at which the cash ceiling becomes as hard as the percentage ones.

**The upgrade authority is one key.** For devnet that is fine. Before
mainnet it should be a multisig, because today a single compromised key
can replace this program with one that does anything at all, and no other
control in here survives that.

**The issuers keep a permanent delegate.** Every tokenized equity checked
on mainnet, Backpack's and Backed's alike, carries a permanent delegate, a
freeze authority and a pause switch. The issuer can move or freeze any
holder's tokens without their signature. Nothing in this program changes
that, and users should be told rather than left to discover it.

## The agent's spending policy

`scripts/ows-policy.mjs` runs before Open Wallet Standard will sign an
x402 payment. It holds no ceiling of its own; it reads the one on chain,
which the client wrote and the agent cannot raise.

It fails closed in every case, which was tested rather than assumed:

- no owner configured, deny
- chain is not Solana, deny
- amount missing, unparseable, or negative, deny
- the policy context is not valid JSON, deny
- no allowance exists on chain, deny
- the chain cannot be reached, deny, because an unknown ceiling is not an
  absent one

The chain enforces the same limit independently, in `pay_agent_cost`, so
the policy being bypassed or removed does not raise the ceiling. It only
removes a warning.

**Account layouts have changed and older accounts do not read.** Three
mandate layouts have existed and two verdict log layouts, and the fields
that were added sit in the middle rather than at the end, so an account
written by an earlier version decodes one field out of step. That is the
dangerous kind of failure, because a shifted field is not an error, it is a
number: one stale mandate reported an adoption count of two point seven
billion and nothing on the screen said anything was wrong.

The reader in the app tells the layouts apart by allocation size, which is
unambiguous where parsing is not, since Anchor allocates the whole maximum
length up front and every layout walks to a plausible end through the
padding. `migrate_verdict_log` moves a log forward in place, keeping every
recorded verdict and every lifetime total, and grows the account so a full
ring still fits. A mandate written before the spread cap has to be created
again, which is stated here rather than left as a surprise.

**What running totals cannot see.** The sector totals count what this
program cleared. They do not count anything the owner did in their own
wallet, outside the mandate, which is a thing an owner is free to do at any
time. So the running total is a bound on the agent and not a picture of the
portfolio. The confidential gate is the half that checks the actual
holding, and the two are deliberately independent: the tighter one wins.

## What has not been done

No external audit. No fuzzing of the account layouts. No formal review of
the Arcium circuit's information leakage beyond reasoning about what the
revealed bit can imply. The findings above were all found by reading the
program rather than by running anything at it.

The confidential gate does not return a verdict yet. The failure is
reproduced in `TOOLCHAIN.md` and sits above this program: a circuit of
Ilowa's that runs on the same devnet cluster, copied byte for byte, aborts
under this MXE and not under theirs. Everything written above about the
gate's account handling is correct and deployed, and none of it has been
exercised by a callback that carried a real answer.

Before mainnet: the multisig above, a focused review of the program by
someone who did not write it, and counsel on whether a US person acquiring
a tokenized equity through a decentralised exchange creates exposure,
which the SEC's January 2026 statement does not resolve.
