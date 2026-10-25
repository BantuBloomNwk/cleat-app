//! What the agent may spend, in a token.
//!
//! The same allowance as spend.rs, for the money agents actually pay with. Under
//! x402 a call is paid in USDC, so a ceiling counted in lamports could not
//! bound the thing it was written to bound.
//!
//! The tokens sit in an account owned by the allowance itself. The owner opens
//! it, sets the ceiling and can take the rest back at any time. The agent can
//! only pay out of it, only up to what is left of the ceiling in the period,
//! and only by signing as the agent the owner named. Anyone can top it up by
//! sending tokens to the vault; that needs no instruction.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::CleatError;
use crate::state::AgentTokenSpend;

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct OpenTokenSpend<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentTokenSpend::INIT_SPACE,
        seeds = [SPEND_TOKEN_SEED, owner.key().as_ref(), mint.key().as_ref(), &index_seed(index)],
        bump,
    )]
    pub spend: Box<Account<'info, AgentTokenSpend>>,

    /// Where the allowance's tokens sit: the allowance's own token account.
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = spend,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct SetTokenSpendCap<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SPEND_TOKEN_SEED, owner.key().as_ref(), spend.mint.as_ref(), &index_seed(index)],
        bump = spend.bump,
        has_one = owner @ CleatError::NotOwner,
    )]
    pub spend: Box<Account<'info, AgentTokenSpend>>,
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct PayAgentToken<'info> {
    /// The agent's own wallet. It names itself; it has no authority over the
    /// allowance beyond paying under the ceiling.
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [SPEND_TOKEN_SEED, spend.owner.as_ref(), spend.mint.as_ref(), &index_seed(index)],
        bump = spend.bump,
    )]
    pub spend: Box<Account<'info, AgentTokenSpend>>,

    #[account(address = spend.mint @ CleatError::WrongSpendMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = spend)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// Whoever is being paid. The program has no opinion about who the agent
    /// buys from, only that it is paid in this token and within the ceiling.
    #[account(mut, token::mint = mint)]
    pub payee: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct WithdrawTokenSpend<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [SPEND_TOKEN_SEED, owner.key().as_ref(), spend.mint.as_ref(), &index_seed(index)],
        bump = spend.bump,
        has_one = owner @ CleatError::NotOwner,
    )]
    pub spend: Box<Account<'info, AgentTokenSpend>>,

    #[account(address = spend.mint @ CleatError::WrongSpendMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = spend)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// The owner's own token account. Withdrawals only ever go back to her.
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CloseTokenSpend<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [SPEND_TOKEN_SEED, owner.key().as_ref(), spend.mint.as_ref(), &index_seed(index)],
        bump = spend.bump,
        has_one = owner @ CleatError::NotOwner,
    )]
    pub spend: Box<Account<'info, AgentTokenSpend>>,

    #[account(address = spend.mint @ CleatError::WrongSpendMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = spend)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct AgentPaidToken {
    pub owner: Pubkey,
    pub payee: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub purpose: u8,
}

#[event]
pub struct AgentTokenPaymentRefused {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub asked: u64,
    pub remaining: u64,
}

fn spend_seeds<'a>(spend: &'a AgentTokenSpend, index: &'a [u8], bump: &'a [u8]) -> [&'a [u8]; 5] {
    [SPEND_TOKEN_SEED, spend.owner.as_ref(), spend.mint.as_ref(), index, bump]
}

pub fn exec_open_token_spend(
    ctx: Context<OpenTokenSpend>,
    _index: u16,
    agent: Pubkey,
    ceiling: u64,
    period_secs: i64,
) -> Result<()> {
    require!(
        (SPEND_PERIOD_MIN..=SPEND_PERIOD_MAX).contains(&period_secs),
        CleatError::BadSpendPeriod
    );
    let spend = &mut ctx.accounts.spend;
    spend.owner = ctx.accounts.owner.key();
    spend.agent = agent;
    spend.mint = ctx.accounts.mint.key();
    spend.ceiling = ceiling;
    spend.period_secs = period_secs;
    spend.spent = 0;
    spend.period_start = Clock::get()?.unix_timestamp;
    spend.lifetime = 0;
    spend.payments = 0;
    spend.refusals = 0;
    spend.bump = ctx.bumps.spend;
    Ok(())
}

pub fn exec_set_token_spend_cap(ctx: Context<SetTokenSpendCap>, _index: u16, ceiling: u64, period_secs: i64) -> Result<()> {
    require!(
        (SPEND_PERIOD_MIN..=SPEND_PERIOD_MAX).contains(&period_secs),
        CleatError::BadSpendPeriod
    );
    let spend = &mut ctx.accounts.spend;
    spend.ceiling = ceiling;
    spend.period_secs = period_secs;
    Ok(())
}

/// The agent pays, and the chain decides whether it may. As in spend.rs, a
/// refusal succeeds as a transaction so the refusal count actually rises; the
/// return data says which it was (1 paid, 0 refused).
pub fn exec_pay_agent_token(ctx: Context<PayAgentToken>, index: u16, amount: u64, purpose: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_keys_eq!(ctx.accounts.agent.key(), ctx.accounts.spend.agent, CleatError::NotTheAgent);
    require!(amount > 0, CleatError::EmptyPayment);

    {
        let spend = &mut ctx.accounts.spend;
        if now >= spend.period_start.saturating_add(spend.period_secs) {
            spend.period_start = now;
            spend.spent = 0;
        }
        let remaining = spend.ceiling.saturating_sub(spend.spent);
        if amount > remaining {
            spend.refusals = spend.refusals.saturating_add(1);
            emit!(AgentTokenPaymentRefused { owner: spend.owner, mint: spend.mint, asked: amount, remaining });
            set_return_data(&[REFUSED]);
            return Ok(());
        }
    }

    require!(ctx.accounts.vault.amount >= amount, CleatError::SpendAccountEmpty);
    let idx = index_seed(index);
    let bump = [ctx.accounts.spend.bump];
    let seeds = spend_seeds(&ctx.accounts.spend, &idx, &bump);
    let signer: &[&[&[u8]]] = &[&seeds];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.payee.to_account_info(),
                authority: ctx.accounts.spend.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let spend = &mut ctx.accounts.spend;
    spend.spent = spend.spent.saturating_add(amount);
    spend.lifetime = spend.lifetime.saturating_add(amount);
    spend.payments = spend.payments.saturating_add(1);
    emit!(AgentPaidToken {
        owner: spend.owner,
        payee: ctx.accounts.payee.key(),
        mint: spend.mint,
        amount,
        remaining: spend.ceiling.saturating_sub(spend.spent),
        purpose,
    });
    set_return_data(&[PAID]);
    Ok(())
}

/// The owner takes tokens back. Only ever to her own account.
pub fn exec_withdraw_token_spend(ctx: Context<WithdrawTokenSpend>, index: u16, amount: u64) -> Result<()> {
    require!(amount > 0, CleatError::EmptyPayment);
    require!(ctx.accounts.vault.amount >= amount, CleatError::SpendAccountEmpty);
    let idx = index_seed(index);
    let bump = [ctx.accounts.spend.bump];
    let seeds = spend_seeds(&ctx.accounts.spend, &idx, &bump);
    let signer: &[&[&[u8]]] = &[&seeds];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_token.to_account_info(),
                authority: ctx.accounts.spend.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )
}

/// Close the allowance: every token back to the owner, the vault closed, its
/// rent and the allowance's returned to her.
pub fn exec_close_token_spend(ctx: Context<CloseTokenSpend>, index: u16) -> Result<()> {
    let idx = index_seed(index);
    let bump = [ctx.accounts.spend.bump];
    let seeds = spend_seeds(&ctx.accounts.spend, &idx, &bump);
    let signer: &[&[&[u8]]] = &[&seeds];
    let left = ctx.accounts.vault.amount;
    if left > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.spend.to_account_info(),
                },
                signer,
            ),
            left,
            ctx.accounts.mint.decimals,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.spend.to_account_info(),
        },
        signer,
    ))
}
