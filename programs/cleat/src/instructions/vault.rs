use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{Mandate, Vault};

#[derive(Accounts)]
pub struct OpenVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [MANDATE_SEED, owner.key().as_ref()],
        bump = mandate.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn exec_open_vault(ctx: Context<OpenVault>) -> Result<()> {
    let v = &mut ctx.accounts.vault;
    v.owner = ctx.accounts.owner.key();
    v.mandate = ctx.accounts.mandate.key();
    v.mandate_version = ctx.accounts.mandate.version;
    // No agent at rest. Somebody has to be granted authority explicitly, and
    // the default of nobody is the state we want a half finished signup to
    // leave behind.
    v.agent = Pubkey::default();
    v.agent_expires_at = 0;
    v.agent_max_trade = 0;
    v.position_handle = [0u8; 32];
    v.deposited = 0;
    v.created_at = Clock::get()?.unix_timestamp;
    v.bump = ctx.bumps.vault;
    Ok(())
}

#[event]
pub struct AgentGranted {
    pub vault: Pubkey,
    pub agent: Pubkey,
    pub expires_at: i64,
    pub max_trade: u64,
}

/// Hand an agent the ability to propose, for a while, up to a size.
///
/// Three separate limits, set by the owner and only by the owner: who, for how
/// long, and how large. An agent cannot extend any of them, because this
/// instruction takes the owner as a signer and there is no other way in.
#[derive(Accounts)]
pub struct SetAgent<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        seeds = [MANDATE_SEED, owner.key().as_ref()],
        bump = mandate.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub mandate: Account<'info, Mandate>,
}

pub fn exec_set_agent(
    ctx: Context<SetAgent>,
    agent: Pubkey,
    ttl_seconds: i64,
    max_trade: u64,
) -> Result<()> {
    require!(ttl_seconds > 0, CleatError::AgentExpired);
    require!(ttl_seconds <= AGENT_MAX_TTL, CleatError::AgentTtlTooLong);

    let now = Clock::get()?.unix_timestamp;
    let v = &mut ctx.accounts.vault;
    v.agent = agent;
    v.agent_expires_at = now.saturating_add(ttl_seconds);
    v.agent_max_trade = max_trade;
    // Pin the grant to the mandate as it reads right now. If the owner edits
    // the mandate afterwards the version moves, and a proposal checked against
    // the old one no longer matches.
    v.mandate_version = ctx.accounts.mandate.version;

    emit!(AgentGranted {
        vault: v.key(),
        agent,
        expires_at: v.agent_expires_at,
        max_trade,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
}

/// Always available, takes effect immediately, needs no reason.
pub fn exec_revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
    let v = &mut ctx.accounts.vault;
    require!(v.agent != Pubkey::default(), CleatError::NoAgent);
    v.agent = Pubkey::default();
    v.agent_expires_at = 0;
    v.agent_max_trade = 0;
    Ok(())
}
