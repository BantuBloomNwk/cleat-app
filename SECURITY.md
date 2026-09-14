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

`fund_spend_account` taking any signer is intentional. Topping up an
agent's allowance is a gift, and nothing about receiving one is dangerous.
Raising the ceiling is the privileged act and that is owner only.

## Found and fixed

**`seal_vault` accepted any signer.** The accounts struct took a `payer`
rather than an owner, and the vault is seeded from `vault.owner` rather
than from the signer, so a stranger could seal somebody else's vault. They
could not add themselves to the member list and could not change a flag,
so it was never a takeover. But the vault sponsors its own permission
account, which meant a stranger could spend another person's lamports on a
state change they did not ask for. Now `has_one = owner`, signer.

## Known, accepted, and written down rather than hidden

**Adoption counts are Sybil-able.** `adopt_mandate` increments the
parent's counter, and the child PDA is seeded by the adopter, so one wallet
can adopt a given mandate once. Inflating a count therefore costs one
funded wallet and one account's rent per point. That is not free but it is
cheap, and adoption is the social metric this product leads with. Before
this number is used for anything that matters, it needs a cost that scales
or an identity that does not.

**The spread a proposal reports is the agent's own measurement.** The
program cannot see the order book, so `observed_spread_bps` arrives from
the caller. A dishonest agent can understate it. This check bounds an
honest agent that would otherwise trade into an illiquid market; it is not
a defence against a hostile one. What defends against a hostile agent is
the size caps, which it cannot influence at all. Stated in the code as
well, so nobody reads the feature as more than it is.

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

## What has not been done

No external audit. No fuzzing of the account layouts. No formal review of
the Arcium circuit's information leakage beyond reasoning about what the
revealed bit can imply. No review by anyone other than the author.

Before mainnet: the multisig above, a focused review of the program by
someone who did not write it, and counsel on whether a US person acquiring
a tokenized equity through a decentralised exchange creates exposure,
which the SEC's January 2026 statement does not resolve.
