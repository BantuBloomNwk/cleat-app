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

    /// Everything stops.
    ///
    /// This lives on the mandate rather than on the vault, and that is the
    /// whole point of it. Revoking an agent writes to the vault, and a vault
    /// delegated to the ephemeral rollup is owned by the delegation program on
    /// base, so the revocation cannot execute there at all. The kill switch
    /// would then depend on the rollup being reachable, which is exactly the
    /// condition under which somebody wants a kill switch.
    ///
    /// A mandate is never delegated. One transaction from the owner, on the
    /// account the owner has always held, and every path that proposes anything
    /// reads it: the public engine, the confidential gate on the way in, and the
    /// gate's callback on the way out, so a computation already in flight when
    /// the switch is thrown comes back refused rather than cleared.
    pub halted: bool,

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

    /// The widest market the agent may trade into, in basis points of
    /// spread.
    ///
    /// Size was never the only way to lose money. A trade well inside every
    /// size cap still executes badly if the book it lands in is thin, and
    /// the book is thinnest exactly when the legacy exchange is shut and the
    /// owner is asleep. Measured on the same venue in the same minute: one
    /// name quoting at half a basis point across seventy eight levels, and
    /// another at thirty two across eleven. Those are not the same market
    /// and a mandate that cannot tell them apart is not enforcing much.
    ///
    /// Zero means the owner did not ask for one, and the check is skipped.
    pub max_spread_bps: u16,

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

/// One instrument, and the sector the owner says it belongs to.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct AssetEntry {
    pub mint: Pubkey,
    pub category: u8,
}

/// The instruments a mandate is allowed to touch, and their sectors.
///
/// This exists because `category` and `mint` were two independent things the
/// agent asserted about the same asset, and nothing on chain made them agree.
/// An agent could call an energy name a healthcare name to dodge a full sector,
/// or name an instrument the deny list had never heard of. Both are settled by
/// the owner writing the mapping down once, in an account the agent cannot
/// touch.
///
/// Kept in its own account rather than on the mandate on purpose. Every mandate
/// already on chain was written before this existed, and growing the mandate
/// layout would make all of them unreadable to the program at once. An absent
/// universe means the mandate predates the feature and is judged the old way,
/// which is weaker and is recorded as such rather than pretended about.
#[account]
#[derive(InitSpace)]
pub struct AssetUniverse {
    /// The mandate this describes. Checked, so a universe cannot be pointed at
    /// somebody else's sentence.
    pub mandate: Pubkey,
    pub owner: Pubkey,
    #[max_len(UNIVERSE_MAX)]
    pub entries: Vec<AssetEntry>,
    pub bump: u8,
}

impl AssetUniverse {
    /// The sector the owner declared for this mint, or None if undeclared.
    pub fn category_of(&self, mint: &Pubkey) -> Option<u8> {
        self.entries
            .iter()
            .find(|e| e.mint == *mint)
            .map(|e| e.category)
    }
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
    /// 4 stale mandate, 5 instruction arrived inside content the agent read,
    /// 6 the book was wider than the mandate allows, 7 the sector is already
    /// at its cap, 8 past the hard ceiling the owner set on the agent,
    /// 9 the owner halted everything.
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

    /// What has been cleared into each sector so far, in basis points.
    ///
    /// Without this the position cap was not a position cap. Every proposal
    /// was judged on its own size against the ceiling, so ten cleared trades
    /// at four percent each sat at forty percent under a mandate that says
    /// fifteen, and every one of them was recorded as cleared. A cap that
    /// only ever sees one trade at a time is a trade cap wearing the wrong
    /// name.
    ///
    /// Public, and that is consistent rather than careless: the verdict log
    /// already publishes the sector and the size of every decision, so the
    /// running total says nothing the entries do not already say together.
    /// What stays private is the holding itself, which lives encrypted and
    /// is what the confidential gate exists to check.
    pub exposure_bps: [u16; CATEGORY_COUNT],

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

    /// How much room is left in a sector under the mandate's ceiling.
    ///
    /// An out of range sector has no room at all rather than unlimited room,
    /// which is the right way round for a number that decides whether a trade
    /// goes through.
    pub fn headroom(&self, category: u8, cap_bps: u16) -> u16 {
        let i = category as usize;
        if i >= CATEGORY_COUNT {
            return 0;
        }
        cap_bps.saturating_sub(self.exposure_bps[i])
    }

    /// Move a decision that went through into the running total. Entries add to
    /// a sector, exits take away from it.
    pub fn apply_exposure(&mut self, category: u8, side: u8, bps: u16) {
        let i = category as usize;
        if i >= CATEGORY_COUNT {
            return;
        }
        self.exposure_bps[i] = if side == 0 {
            self.exposure_bps[i].saturating_add(bps)
        } else {
            self.exposure_bps[i].saturating_sub(bps)
        };
    }
}

/// What the agent is allowed to spend keeping itself alive.
///
/// The mandate says what the agent may do with the client's money. This says
/// what it may do with its own, and the two are different questions that get
/// answered in the same place for a reason.
///
/// An agent that proposes trades has running costs: inference, market data, the
/// fee on its own transactions. Under x402 those are paid per call, which is
/// the honest way to buy them, and it also means an agent with a wallet and a
/// loop can spend without limit if nothing stops it. Open Wallet Standard will
/// hold the key and refuse to sign against a policy, which is the right shape,
/// but its policies are a local file: they can say which chain and until when,
/// and a spend ceiling has to be written as a script the operator also controls.
///
/// A ceiling the operator controls is not a ceiling the client can rely on. So
/// this account holds it instead, the client sets it, the agent cannot raise it,
/// and the payment itself runs through this program, which means the limit is
/// enforced by the chain rather than promised by a policy file.
#[account]
#[derive(InitSpace)]
pub struct AgentSpend {
    pub owner: Pubkey,

    /// The wallet the agent signs its own payments with. It never holds the
    /// client's assets and has no authority over the vault.
    pub agent: Pubkey,

    /// The most that may leave this account in one period.
    pub ceiling_lamports: u64,

    /// How long a period lasts. Bounded at both ends, see the constants.
    pub period_secs: i64,

    /// Spent so far in the current period.
    pub spent_lamports: u64,

    /// When the current period began. Rolls forward lazily, on the first
    /// payment after it lapses, so nobody has to run a cron to reset it.
    pub period_start: i64,

    /// Lifetime totals, kept separately so they never roll over. The point of
    /// a diary is that it does not forget.
    pub lifetime_lamports: u64,
    pub payments: u32,

    /// Refused because the next payment would have breached the ceiling. This
    /// is the number worth showing: it is the agent being stopped.
    pub refusals: u32,

    pub bump: u8,
}

impl AgentSpend {
    /// What is left in the period, treating a lapsed period as already reset.
    pub fn remaining(&self, now: i64) -> u64 {
        if now >= self.period_start.saturating_add(self.period_secs) {
            return self.ceiling_lamports;
        }
        self.ceiling_lamports.saturating_sub(self.spent_lamports)
    }
}

/// One question, parked while the network answers it.
///
/// This used to be four fields on the VerdictLog, shared by every computation
/// that owner had outstanding. That was wrong twice over.
///
/// First, it let anyone write into anyone's log. A callback receives the
/// circuit's output and nothing else, so ours read the context back off
/// whatever log account it was handed, and the accounts a callback is handed
/// are not constrained by Arcium: the macro checks that a genuine
/// `callback_computation` immediately precedes the callback and says nothing
/// about which accounts follow it. So a stranger could run a cheap computation
/// against their own vault, name somebody else's log, and push a verdict into a
/// record they have nothing to do with, evicting a real refusal from a sixteen
/// entry ring. The public record of what an agent was stopped from doing is the
/// thing this product sells, and it was writable by anybody.
///
/// Second, one shared slot cannot hold two questions. Two proposals in flight
/// at once meant the second overwrote the first's context, and whichever
/// callback landed first wrote a verdict pairing one computation's answer with
/// the other's size and sector.
///
/// Seeding this by the computation account fixes both. The address derives from
/// a computation that already exists, the owner is recorded when the question is
/// asked, and the callback derives the log from the owner written here rather
/// than trusting the account it was passed.
#[account]
#[derive(InitSpace)]
pub struct Pending {
    /// Whose question this is. The callback trusts this and nothing else.
    pub owner: Pubkey,
    /// Who paid for the parking space, and who gets the rent back when the
    /// answer lands.
    pub payer: Pubkey,
    /// The mandate version as it read when the question was asked, so a mandate
    /// edited while the network was thinking cannot have its answer recorded
    /// against a version that is no longer in force.
    pub mandate_version: u16,
    /// Sector, not instrument. Bounds checked on the way in.
    pub category: u8,
    /// What the agent asked for.
    pub proposed_bps: u16,
    /// What the public caps already trimmed it to before it was sent. The
    /// circuit was asked about this number, so the callback writes a clamp
    /// whenever it came out below what was asked.
    pub effective_bps: u16,
    /// Which cap did the trimming, so the entry says why rather than guessing.
    /// 0 nothing trimmed, 2 the single trade cap, 7 the sector already full.
    pub clamp_reason: u8,
    /// 0 to add to a position, 1 to reduce one.
    pub side: u8,
    pub bump: u8,
}

/// Where the fee on a clearance lands.
///
/// It needs to be a real account rather than a bare address, because an
/// address holding lamports with no data and no rent exemption is collected
/// by the runtime at the end of the transaction that funded it. The first
/// fees this product ever charged were swept away that way, which is a
/// cheerful sort of bug to have.
///
/// It has no authority over anything. Nothing in this program moves value
/// from the treasury back toward a vault, an agent or an owner.
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    /// Everything ever collected, which is a fact about the product rather
    /// than a balance, since the balance also carries its own rent.
    pub collected: u64,
    pub clearances: u64,
    pub bump: u8,
}
