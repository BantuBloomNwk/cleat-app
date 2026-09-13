use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{Mandate, Vault, Verdict, VerdictLog};

#[derive(Accounts)]
pub struct OpenVerdictLog<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        space = 8 + VerdictLog::INIT_SPACE,
        seeds = [VERDICT_SEED, owner.key().as_ref()],
        bump
    )]
    pub log: Account<'info, VerdictLog>,
    pub system_program: Program<'info, System>,
}

pub fn exec_open_verdict_log(ctx: Context<OpenVerdictLog>) -> Result<()> {
    let l = &mut ctx.accounts.log;
    l.owner = ctx.accounts.owner.key();
    l.vault = ctx.accounts.vault.key();
    l.head = 0;
    l.cleared = 0;
    l.clamped = 0;
    l.refused = 0;
    l.entries = Vec::new();
    l.bump = ctx.bumps.log;
    Ok(())
}

#[event]
pub struct ProposalDecided {
    pub vault: Pubkey,
    pub mandate_version: u16,
    pub category: u8,
    pub proposed_bps: u16,
    pub allowed_bps: u16,
    pub outcome: u8,
    pub reason: u8,
}

/// The agent asks. The mandate answers. Neither the agent nor whoever runs it
/// gets to write the answer.
///
/// The verdict is computed here from the mandate's own caps rather than passed
/// in, which is the difference between a policy and a log of claims. An agent
/// that has been talked into asking for forty percent of the book still only
/// gets whatever the sentence its owner wrote allows, and the attempt is
/// recorded either way.
///
/// `reason` 5 exists for the case that motivated the whole product: the caller
/// can flag that the proposal originated in content the agent ingested rather
/// than in its own reasoning. It changes nothing about enforcement, because
/// enforcement never trusted the agent in the first place. It is there so the
/// record says what happened.
#[derive(Accounts)]
pub struct ProposeTrade<'info> {
    /// The granted agent, or the owner acting on their own behalf.
    pub signer: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        seeds = [MANDATE_SEED, vault.owner.as_ref()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(
        mut,
        seeds = [VERDICT_SEED, vault.owner.as_ref()],
        bump = log.bump
    )]
    pub log: Account<'info, VerdictLog>,
}

pub fn exec_propose_trade(
    ctx: Context<ProposeTrade>,
    category: u8,
    proposed_bps: u16,
    from_ingested_content: bool,
    side: u8,
    observed_spread_bps: u16,
) -> Result<()> {
    // side is 0 to add to a position and 1 to reduce one, and it matters
    // because the harm is not symmetric in the way a size cap assumes. A
    // cap on how much may be bought is also a cap on how much may be sold
    // at once, which is right at three in the morning in a thin book and
    // wrong when the owner is trying to get out. So an exit runs to the
    // position cap rather than the trade cap, and stays bound by everything
    // else.
    //
    // observed_spread_bps is how wide the book is where this would land.
    // It is public information the agent reads off the venue, so passing it
    // in the clear costs no privacy. It is also the agent's own
    // measurement, and the agent could lie about it, which is worth being
    // plain about: this bounds an honest agent that would otherwise trade
    // into an illiquid book, and it is not a defence against a hostile one.
    // What defends against a hostile agent is the size caps, which it
    // cannot influence at all.
    require!(proposed_bps > 0, CleatError::EmptyProposal);
    require!(side <= 1, CleatError::BadSide);

    let vault = &ctx.accounts.vault;
    let mandate = &ctx.accounts.mandate;
    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.signer.key();

    // Either the owner, or an agent whose grant is still live. An expired grant
    // is not a soft warning, it simply cannot get past here.
    if signer != vault.owner {
        require!(vault.agent_is_live(now), CleatError::AgentNotLive);
        require_keys_eq!(signer, vault.agent, CleatError::NotOwner);
    }

    // A grant is pinned to the mandate as it read when it was issued. If the
    // owner has edited the mandate since, the agent is working from an older
    // sentence and does not get to act on it.
    let mut outcome: u8;
    let mut reason: u8;
    let mut allowed_bps: u16;

    if vault.mandate_version != mandate.version {
        outcome = 2;
        reason = 4;
        allowed_bps = 0;
    } else if proposed_bps > mandate.max_position_bps {
        // Past the position cap entirely. Refuse rather than trim, because a
        // request this far out is not a sizing error.
        outcome = 2;
        reason = 1;
        allowed_bps = 0;
    } else if side == 0 && proposed_bps > mandate.max_trade_bps {
        // Inside the position cap but larger than one trade may be, so trim it
        // to what a single trade is allowed to move. Entries only: getting
        // out of something should not be rationed by the cap that governs
        // getting into it.
        outcome = 1;
        reason = 2;
        allowed_bps = mandate.max_trade_bps;
    } else {
        outcome = 0;
        reason = 0;
        allowed_bps = proposed_bps;
    }

    // The book, which is the other way to lose money in a trade that passed
    // every size check. Applied to both directions, because a thin book
    // punishes an exit exactly as hard as an entry, and an owner who has
    // asked not to trade into one did not mean only when buying.
    if mandate.max_spread_bps > 0
        && observed_spread_bps > mandate.max_spread_bps
        && outcome != 2
    {
        outcome = 2;
        reason = 6;
        allowed_bps = 0;
    }

    // Anything that arrived through content the agent read is refused outright,
    // whatever its size. The size was never the problem.
    if from_ingested_content && outcome != 2 {
        outcome = 2;
        reason = 5;
        allowed_bps = 0;
    }

    let v = Verdict {
        slot: Clock::get()?.slot,
        mandate_version: mandate.version,
        category,
        proposed_bps,
        allowed_bps,
        outcome,
        reason,
    };
    ctx.accounts.log.push(v);

    emit!(ProposalDecided {
        vault: vault.key(),
        mandate_version: mandate.version,
        category,
        proposed_bps,
        allowed_bps,
        outcome,
        reason,
    });
    Ok(())
}
