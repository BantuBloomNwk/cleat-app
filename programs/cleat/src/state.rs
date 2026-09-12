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
