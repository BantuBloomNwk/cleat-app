use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::constants::*;
use crate::error::CleatError;
use crate::state::Mandate;

fn validate_caps(max_position_bps: u16, max_trade_bps: u16, max_spread_bps: u16) -> Result<()> {
    // Zero means the owner did not ask for a spread cap. Anything above the
    // whole width of the market is not a cap either, so it is rejected
    // rather than quietly stored.
    require!(max_spread_bps <= BPS_DENOM, CleatError::CapsInconsistent);
    require!(
        max_position_bps > 0 && max_position_bps <= BPS_DENOM,
        CleatError::CapOutOfRange
    );
    require!(
        max_trade_bps > 0 && max_trade_bps <= BPS_DENOM,
        CleatError::CapOutOfRange
    );
    // A single trade allowed to be larger than the position cap would let one
    // fill break the cap it was supposed to respect.
    require!(max_trade_bps <= max_position_bps, CleatError::CapsInconsistent);
    Ok(())
}

#[derive(Accounts)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, owner.key().as_ref()],
        bump
    )]
    pub mandate: Account<'info, Mandate>,
    pub system_program: Program<'info, System>,
}

pub fn exec_create_mandate(
    ctx: Context<CreateMandate>,
    text: String,
    max_position_bps: u16,
    max_trade_bps: u16,
    max_spread_bps: u16,
    denied: Vec<Pubkey>,
) -> Result<()> {
    require!(text.len() <= MANDATE_TEXT_MAX, CleatError::TextTooLong);
    require!(denied.len() <= DENY_MAX, CleatError::DenyListFull);
    validate_caps(max_position_bps, max_trade_bps, max_spread_bps)?;

    let now = Clock::get()?.unix_timestamp;
    let m = &mut ctx.accounts.mandate;
    m.owner = ctx.accounts.owner.key();
    m.version = 1;
    m.text_hash = hash(text.as_bytes()).to_bytes();
    m.text = text;
    m.max_position_bps = max_position_bps;
    m.max_spread_bps = max_spread_bps;
    m.max_trade_bps = max_trade_bps;
    m.denied = denied;
    m.adopted_from = None;
    m.adopt_count = 0;
    m.created_at = now;
    m.updated_at = now;
    m.bump = ctx.bumps.mandate;
    Ok(())
}

/// The only write path to a mandate, and it requires the owner's signature.
///
/// This is the load bearing constraint of the whole product. An agent reads a
/// mandate and can never reach this instruction, so an instruction smuggled in
/// through a news headline has no privilege path to loosen a limit. That is the
/// exact failure that emptied the Grok wallet in May 2026: permissions were
/// mutable by something the agent ingested.
#[derive(Accounts)]
pub struct UpdateMandate<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, owner.key().as_ref()],
        bump = mandate.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub mandate: Account<'info, Mandate>,
}

pub fn exec_update_mandate(
    ctx: Context<UpdateMandate>,
    text: String,
    max_position_bps: u16,
    max_trade_bps: u16,
    max_spread_bps: u16,
    denied: Vec<Pubkey>,
) -> Result<()> {
    require!(text.len() <= MANDATE_TEXT_MAX, CleatError::TextTooLong);
    require!(denied.len() <= DENY_MAX, CleatError::DenyListFull);
    validate_caps(max_position_bps, max_trade_bps, max_spread_bps)?;

    let m = &mut ctx.accounts.mandate;
    m.version = m.version.saturating_add(1);
    m.text_hash = hash(text.as_bytes()).to_bytes();
    m.text = text;
    m.max_position_bps = max_position_bps;
    m.max_spread_bps = max_spread_bps;
    m.max_trade_bps = max_trade_bps;
    m.denied = denied;
    m.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[event]
pub struct MandateAdopted {
    pub parent: Pubkey,
    pub child: Pubkey,
    pub adopter: Pubkey,
}

/// Taking on somebody else's mandate.
///
/// Adopting copies the parent's caps so the default is whatever the parent
/// actually ran, then the adopter edits the prose in their own words. Nothing
/// about the parent's holdings is read, because nothing about the parent's
/// holdings is readable.
#[derive(Accounts)]
pub struct AdoptMandate<'info> {
    #[account(mut)]
    pub adopter: Signer<'info>,
    #[account(mut)]
    pub parent: Account<'info, Mandate>,
    #[account(
        init,
        payer = adopter,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, adopter.key().as_ref()],
        bump
    )]
    pub child: Account<'info, Mandate>,
    pub system_program: Program<'info, System>,
}

pub fn exec_adopt_mandate(ctx: Context<AdoptMandate>, text: String) -> Result<()> {
    require!(text.len() <= MANDATE_TEXT_MAX, CleatError::TextTooLong);
    require_keys_neq!(
        ctx.accounts.parent.key(),
        ctx.accounts.child.key(),
        CleatError::SelfAdopt
    );

    let now = Clock::get()?.unix_timestamp;
    let parent = &mut ctx.accounts.parent;
    parent.adopt_count = parent.adopt_count.saturating_add(1);

    let child = &mut ctx.accounts.child;
    child.owner = ctx.accounts.adopter.key();
    child.version = 1;
    child.text_hash = hash(text.as_bytes()).to_bytes();
    child.text = text;
    child.max_position_bps = parent.max_position_bps;
    child.max_trade_bps = parent.max_trade_bps;
    child.denied = parent.denied.clone();
    child.adopted_from = Some(parent.key());
    child.adopt_count = 0;
    child.created_at = now;
    child.updated_at = now;
    child.bump = ctx.bumps.child;

    emit!(MandateAdopted {
        parent: parent.key(),
        child: child.key(),
        adopter: ctx.accounts.adopter.key(),
    });
    Ok(())
}
