use anchor_lang::prelude::*;

#[constant]
pub const MANDATE_SEED: &[u8] = b"mandate";

/// The bytes a sleeve index contributes to an account's seeds.
///
/// One mandate per key was the wrong shape. Nobody holds a single position:
/// there is money that must not be touched and money that is being played
/// with, and they do not want the same sentence or the same balance. So a key
/// holds several, each with its own mandate, its own vault, its own log and
/// its own allowance, and the index is what separates them.
///
/// Index zero contributes nothing at all. A seed of zero length adds no bytes
/// to the hash, so a sleeve zero account derives to exactly the address it
/// derived to before any of this existed. Everything already on chain keeps
/// working, nothing has to be moved, and no balance gets stranded behind an
/// address the program can no longer sign for. That mattered more than the
/// tidiness of always writing the index.
pub fn index_seed(index: u16) -> Vec<u8> {
    if index == 0 {
        Vec::new()
    } else {
        index.to_le_bytes().to_vec()
    }
}
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const UNIVERSE_SEED: &[u8] = b"universe";

/// Basis points of the portfolio. 10_000 is the whole thing.
pub const BPS_DENOM: u16 = 10_000;

/// A mandate is prose a person wrote, so it needs room to be read, and a bound
/// so an account cannot grow without limit. 280 bytes is long enough for every
/// real mandate we have written and short enough to stay one sentence or two.
pub const MANDATE_TEXT_MAX: usize = 280;

/// How many mints a single mandate may name as off limits. The plain English
/// clause "no fossil fuels" resolves off chain into a list, and the list is
/// what the program enforces, because the program cannot read English.
pub const DENY_MAX: usize = 8;

/// How many instruments an owner may declare for one mandate.
///
/// A declared universe is the answer to the hole the deny list left. A deny
/// list names what is forbidden and says nothing about everything else, so an
/// agent that wanted a refused name could propose a different one and be
/// cleared. A universe inverts it: the owner says which instruments exist for
/// this mandate and which sector each one belongs to, and anything not on the
/// list is refused without being judged on size at all.
pub const UNIVERSE_MAX: usize = 32;

/// An agent's authority always expires. There is no permanent grant, because a
/// permanent grant is the thing that emptied the Grok wallet.
pub const AGENT_MAX_TTL: i64 = 60 * 60 * 24 * 30;

/// MagicBlock's TDX ephemeral validator on devnet.
///
/// Not the plain rollup validator. This one runs inside an Intel TDX enclave and
/// answers an attestation query, which is the difference between "fast" and
/// "fast and the operator cannot read it". Measured on devnet at 1.8s to verify
/// attestation and a 36ms median from submit to confirm.
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/// How often the rollup pushes state back to base while delegated.
pub const COMMIT_FREQUENCY_MS: u32 = 30_000;

#[constant]
pub const VERDICT_SEED: &[u8] = b"verdicts";

/// How many verdicts the on chain ring buffer keeps. Enough for a person to
/// scroll a week of activity without an indexer, bounded so the account cannot
/// grow forever. Totals are kept separately and never roll over.
pub const VERDICT_CAPACITY: usize = 16;

#[constant]
pub const SPEND_SEED: &[u8] = b"spend";

/// The shortest window a spending allowance may be written over.
///
/// An allowance with a very short period is really an unlimited allowance
/// wearing a small number, because it refills before anyone could notice it
/// draining. An hour is the floor.
pub const SPEND_PERIOD_MIN: i64 = 60 * 60;

/// And the longest, so an allowance cannot be set once and forgotten for a
/// year the way a permanent approval is.
pub const SPEND_PERIOD_MAX: i64 = 60 * 60 * 24 * 31;

#[constant]
pub const PENDING_SEED: &[u8] = b"pending";

/// How many sectors a proposal can name, counting the unspecified one at zero.
/// A proposal naming anything past this has no room under any cap, which is the
/// safe way for an out of range number to fail.
pub const CATEGORY_COUNT: usize = 6;

#[constant]
pub const TREASURY_SEED: &[u8] = b"treasury";

/// What the product charges, in basis points of what actually cleared.
///
/// Charged on clearances and never on refusals, which is the whole of the
/// pricing argument. An agent that proposes a thousand times and is stopped a
/// thousand times costs its owner nothing, so there is no version of this
/// where we are paid for the agent misbehaving, and no incentive to let
/// something through that should not have been.
///
/// Three basis points. On a two thousand dollar fill that is sixty cents, and
/// the cap below stops it becoming a percentage fee on a large book.
pub const PROTOCOL_FEE_BPS: u64 = 3;

/// No single clearance pays more than this, whatever it was worth.
pub const PROTOCOL_FEE_CAP: u64 = 2_000_000; // 0.002 SOL on devnet
