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

/// Publish the handle to the encrypted position set.
///
/// The gate compares the sealed exposure it is handed against this field and
/// refuses anything else, which is what stops an agent from sealing a
/// flattering number to its own key and asking the network about that instead.
/// So the handle has to move, and only the owner may move it: they decrypt the
/// copy the circuit sealed back to them, satisfy themselves it is right, and
/// write it here under their own signature.
///
/// Nothing readable passes through this instruction. The handle is ciphertext
/// on the way in, ciphertext at rest, and the program has no key for it.
#[derive(Accounts)]
pub struct SetPositionHandle<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
}

pub fn exec_set_position_handle(
    ctx: Context<SetPositionHandle>,
    handle: [u8; 32],
) -> Result<()> {
    ctx.accounts.vault.position_handle = handle;
    Ok(())
}

/// State the size of the book the percentages are percentages of.
///
/// The mandate is written in basis points, and basis points of nothing are
/// nothing. Until the vault custodies the assets itself, the owner declares
/// what the book is worth, which is what turns the agent's cash ceiling from a
/// number in an account into a bound that actually fires. Owner only: an agent
/// that could restate the size of the book could clear any trade it liked by
/// calling the book enormous.
///
/// This is a declaration rather than a deposit and the field is public, which
/// is deliberate. The pool total being visible is not the same as the split
/// inside it being visible, and it is the split that the confidential gate
/// exists to protect.
#[derive(Accounts)]
pub struct SetBookSize<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
}

pub fn exec_set_book_size(ctx: Context<SetBookSize>, quote_units: u64) -> Result<()> {
    ctx.accounts.vault.deposited = quote_units;
    Ok(())
}

/// Put money in.
///
/// The vault held authority and never value, which made `deposited` a number
/// the owner typed rather than a balance, and made the agent's cash ceiling a
/// bound on a declaration. Anyone may fund a vault, because adding to
/// somebody's account is not an attack and requiring the owner to be present
/// would stop a salary or a parent paying in.
///
/// Lamports on devnet stand in for USDC on mainnet. The custody question is
/// identical either way: the program holds it, the owner alone can take it
/// out, and the agent has no instruction that moves it anywhere.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn exec_deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
    require!(lamports > 0, CleatError::EmptyPayment);
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        lamports,
    )?;
    let v = &mut ctx.accounts.vault;
    v.deposited = v.deposited.saturating_add(lamports);
    emit!(VaultFunded {
        vault: v.key(),
        payer: ctx.accounts.payer.key(),
        lamports,
        deposited: v.deposited,
    });
    Ok(())
}

#[event]
pub struct VaultFunded {
    pub vault: Pubkey,
    pub payer: Pubkey,
    pub lamports: u64,
    pub deposited: u64,
}

/// Take money out. Owner only, always, no conditions.
///
/// There is no ceiling on this, no delay, no approval and no agent in the
/// path. A product whose argument is that you keep the account has to mean it
/// at the one instruction where it counts, and anything that could hold a
/// withdrawal is a place somebody could be made to hold one.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
}

pub fn exec_withdraw(ctx: Context<Withdraw>, lamports: u64) -> Result<()> {
    require!(lamports > 0, CleatError::EmptyPayment);

    // Rent has to stay behind or the account closes and takes the agent
    // grant, the mandate version pin and the position handle with it.
    let info = ctx.accounts.vault.to_account_info();
    let floor = Rent::get()?.minimum_balance(info.data_len());
    let free = info.lamports().saturating_sub(floor);
    require!(lamports <= free, CleatError::VaultEmpty);

    **info.try_borrow_mut_lamports()? -= lamports;
    **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += lamports;

    let v = &mut ctx.accounts.vault;
    v.deposited = v.deposited.saturating_sub(lamports);
    emit!(VaultDrawn {
        vault: v.key(),
        lamports,
        deposited: v.deposited,
    });
    Ok(())
}

#[event]
pub struct VaultDrawn {
    pub vault: Pubkey,
    pub lamports: u64,
    pub deposited: u64,
}
