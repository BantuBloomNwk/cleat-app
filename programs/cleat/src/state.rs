use anchor_lang::prelude::*;
use crate::constants::*;

/// The written instruction. Public on purpose.
///
/// This is the one part of the product that is meant to be read by strangers,
/// because a mandate is what people share and fork. What stays private is the
/// holdings, not the intent. Keeping those two on opposite sides of the line is
/// the whole design: you can show someone how you think without showing them
/// what you own.
#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub owner: Pubkey,

    /// Bumped on every edit by the owner. An agent that read a stale version
    /// cannot act on it, and nothing an agent ingests can move this number.
    pub version: u16,

    /// The sentence itself, so the social surface can render it without a
    /// server in the loop.
    #[max_len(MANDATE_TEXT_MAX)]
    pub text: String,

    /// Hash of the text as the owner signed it. The renderer shows `text`, the
    /// checker binds to this, so a mutated string cannot pass as the original.
    pub text_hash: [u8; 32],

    /// No more than this share of the portfolio in any one name.
    pub max_position_bps: u16,

    /// No single trade larger than this share of the portfolio.
    pub max_trade_bps: u16,

    /// Mints this mandate refuses. The English clause is resolved off chain and
    /// the resolution is recorded here, where it is enforceable.
    #[max_len(DENY_MAX)]
    pub denied: Vec<Pubkey>,

    /// The social graph, on chain. None means someone wrote this from scratch.
    pub adopted_from: Option<Pubkey>,

    /// How many people took this as a starting point.
    pub adopt_count: u32,

    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

/// The account that holds and acts.
///
/// Custody and authority are deliberately separate fields. `owner` can always
/// withdraw. `agent` can only ever propose, and only until `agent_expires_at`.
/// There is no field an agent can write, which is why a prompt injection has
/// nowhere to land: the worst an injected instruction achieves is a proposal
/// that gets refused.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub owner: Pubkey,

    /// The mandate this vault answers to.
    pub mandate: Pubkey,

    /// Version of that mandate as of the last owner action. A proposal checked
    /// against an older version is stale and gets rejected.
    pub mandate_version: u16,

    /// Who may propose. Default means nobody, which is the safe resting state.
    pub agent: Pubkey,

    /// When that stops being true. Always set, never optional.
    pub agent_expires_at: i64,

    /// Hard ceiling on one proposal, in quote units, independent of the bps
    /// caps in the mandate. Two limits of different kinds, because a percentage
    /// cap alone misbehaves when the portfolio is small.
    pub agent_max_trade: u64,

    /// Handle to this owner's encrypted position set. Written only by the
    /// confidential compute callback, never by the owner and never by the
    /// agent, so nothing here is readable on chain by anyone.
    pub position_handle: [u8; 32],

    /// Public and deliberately coarse. The pool total is visible, the split
    /// between people in it is not.
    pub deposited: u64,

    pub created_at: i64,
    pub bump: u8,
}

impl Vault {
    pub fn agent_is_live(&self, now: i64) -> bool {
        self.agent != Pubkey::default() && now < self.agent_expires_at
    }
}

/// What the policy decided about one proposal.
///
/// Deliberately records a ratio and a category, never a ticker and never an
/// amount. A complete log of proposals with tickers in it would leak the
/// portfolio by inference over a few weeks, which would undo the thing the
/// vault exists to protect. A category and a percentage say enough to be worth
/// reading and not enough to reconstruct.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Verdict {
    pub slot: u64,
    /// Which mandate version was in force when this was decided.
    pub mandate_version: u16,
    /// Sector or asset class, not the instrument.
    pub category: u8,
    /// What the agent asked for, in basis points of the portfolio.
    pub proposed_bps: u16,
    /// What it was allowed to do. Equal to proposed when cleared, smaller when
    /// clamped, zero when refused.
    pub allowed_bps: u16,
    /// 0 cleared, 1 clamped, 2 refused.
    pub outcome: u8,
    /// 0 none, 1 position cap, 2 single trade cap, 3 denied asset,
    /// 4 stale mandate, 5 instruction arrived inside content the agent read.
    pub reason: u8,
}

/// The visible record of what the agent was stopped from doing.
///
/// This is the only part of the product that is meant to travel. A refusal is
/// the mechanism working, and it is the one artifact that can be shown to
/// somebody without revealing a position, so it is kept on chain rather than
/// left in logs an indexer has to reconstruct.
#[account]
#[derive(InitSpace)]
pub struct VerdictLog {
    pub owner: Pubkey,
    pub vault: Pubkey,
    /// Next slot to write. The buffer wraps.
    pub head: u8,
    /// Lifetime tallies. These are the numbers worth quoting.
    pub cleared: u32,
    pub clamped: u32,
    pub refused: u32,
    #[max_len(VERDICT_CAPACITY)]
    pub entries: Vec<Verdict>,

    /// The proposal currently out with the confidential gate.
    ///
    /// A callback only receives the circuit's output, so the context it needs
    /// has to be parked somewhere first. Keeping it on the log rather than in a
    /// separate per computation account costs one account instead of two and
    /// means a stalled computation leaves nothing behind to garbage collect.
    pub pending_offset: u64,
    pub pending_category: u8,
    pub pending_bps: u16,
    /// The single trade cap as it read when the question was asked, so a clamped
    /// verdict can be written down without the callback needing the mandate.
    pub pending_clamp_bps: u16,
    pub bump: u8,
}

impl VerdictLog {
    pub fn push(&mut self, v: Verdict) {
        match v.outcome {
            0 => self.cleared = self.cleared.saturating_add(1),
            1 => self.clamped = self.clamped.saturating_add(1),
            _ => self.refused = self.refused.saturating_add(1),
        }
        if self.entries.len() < VERDICT_CAPACITY {
            self.entries.push(v);
        } else {
            self.entries[self.head as usize] = v;
        }
        self.head = ((self.head as usize + 1) % VERDICT_CAPACITY) as u8;
    }
}
