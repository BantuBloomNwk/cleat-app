//! What the agent may spend keeping itself alive.
//!
//! The rest of this program bounds what the agent can do with the client's
//! money. This bounds what it can do with its own, and the reason that needs
//! to be on chain at all is worth stating.
//!
//! Under x402 an agent pays per call for the things it needs: inference,
//! market data, the fee on its own transactions. Open Wallet Standard holds
//! the key and refuses to sign against a policy, which is the right shape and
//! keeps the key out of the model's context entirely. But OWS policies are a
//! local file, and the rules it ships natively are the chain it may use and
//! when the grant expires. A spend ceiling has to be written as a script, and
//! a script lives on the same machine as the agent, under the same operator.
//!
//! A ceiling the operator controls is not a ceiling the client can rely on.
//! So the number lives here, the client writes it, the agent cannot raise it,
//! and the payment runs through this program. That last part is what turns it
//! from a promise into a limit: there is no path to the money that does not
//! pass the check.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{AgentSpend, Vault};

#[derive(Accounts)]
pub struct OpenSpendAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentSpend::INIT_SPACE,
        seeds = [SPEND_SEED, owner.key().as_ref()],
        bump,
    )]
    pub spend: Box<Account<'info, AgentSpend>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSpendCap<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SPEND_SEED, owner.key().as_ref()],
        bump = spend.bump,
        has_one = owner @ CleatError::NotOwner,
    )]
    pub spend: Box<Account<'info, AgentSpend>>,
}

/// Fund the allowance. Anyone may top it up; only the owner may raise the
/// ceiling, which is the distinction that matters.
#[derive(Accounts)]
pub struct FundSpendAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [SPEND_SEED, spend.owner.as_ref()],
        bump = spend.bump,
    )]
    pub spend: Box<Account<'info, AgentSpend>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayAgentCost<'info> {
    /// The agent's own wallet. It signs to say the payment is its, and it is
    /// not the owner and has no authority over the vault.
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [SPEND_SEED, spend.owner.as_ref()],
        bump = spend.bump,
    )]
    pub spend: Box<Account<'info, AgentSpend>>,

    /// Whoever is being paid. An x402 server, an inference endpoint, a data
    /// feed. Unchecked because the program has no opinion about who the agent
    /// buys from, only about how much.
    #[account(mut)]
    /// CHECK: the payee, constrained only by the ceiling.
    pub payee: UncheckedAccount<'info>,
}

#[event]
pub struct AgentPaid {
    pub owner: Pubkey,
    pub payee: Pubkey,
    pub lamports: u64,
    pub remaining: u64,
    /// A short tag naming what was bought, so the diary can say it.
    pub purpose: u8,
}

#[event]
pub struct AgentPaymentRefused {
    pub owner: Pubkey,
    pub asked: u64,
    pub remaining: u64,
}

pub fn exec_open_spend_account(
    ctx: Context<OpenSpendAccount>,
    agent: Pubkey,
    ceiling_lamports: u64,
    period_secs: i64,
) -> Result<()> {
    require!(
        (SPEND_PERIOD_MIN..=SPEND_PERIOD_MAX).contains(&period_secs),
        CleatError::BadSpendPeriod
    );

    let spend = &mut ctx.accounts.spend;
    spend.owner = ctx.accounts.owner.key();
    spend.agent = agent;
    spend.ceiling_lamports = ceiling_lamports;
    spend.period_secs = period_secs;
    spend.spent_lamports = 0;
    spend.period_start = Clock::get()?.unix_timestamp;
    spend.lifetime_lamports = 0;
    spend.payments = 0;
    spend.refusals = 0;
    spend.bump = ctx.bumps.spend;
    Ok(())
}

pub fn exec_set_spend_cap(
    ctx: Context<SetSpendCap>,
    ceiling_lamports: u64,
    period_secs: i64,
) -> Result<()> {
    require!(
        (SPEND_PERIOD_MIN..=SPEND_PERIOD_MAX).contains(&period_secs),
        CleatError::BadSpendPeriod
    );
    let spend = &mut ctx.accounts.spend;
    spend.ceiling_lamports = ceiling_lamports;
    spend.period_secs = period_secs;
    Ok(())
}

pub fn exec_fund_spend_account(ctx: Context<FundSpendAccount>, lamports: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.spend.to_account_info(),
            },
        ),
        lamports,
    )
}

/// The agent buys something, and the chain decides whether it may.
///
/// Two things are checked and neither is negotiable from the agent's side:
/// the signer has to be the agent the owner named, and the payment has to fit
/// under what is left of the ceiling. A refusal is recorded rather than
/// silently dropped, because the count of times the agent was stopped is the
/// same kind of fact as the count of trades it was stopped from making, and
/// this product exists to show people that number.
pub fn exec_pay_agent_cost(
    ctx: Context<PayAgentCost>,
    lamports: u64,
    purpose: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let spend = &mut ctx.accounts.spend;

    require_keys_eq!(
        ctx.accounts.agent.key(),
        spend.agent,
        CleatError::NotTheAgent
    );
    require!(lamports > 0, CleatError::EmptyPayment);

    // The period rolls forward here rather than on a schedule, so nothing has
    // to be running for the allowance to refill.
    if now >= spend.period_start.saturating_add(spend.period_secs) {
        spend.period_start = now;
        spend.spent_lamports = 0;
    }

    let remaining = spend.ceiling_lamports.saturating_sub(spend.spent_lamports);
    if lamports > remaining {
        spend.refusals = spend.refusals.saturating_add(1);
        emit!(AgentPaymentRefused {
            owner: spend.owner,
            asked: lamports,
            remaining,
        });
        return Err(CleatError::SpendCapBreached.into());
    }

    // The allowance has to keep enough to stay alive, or the account is closed
    // by the runtime and the ceiling goes with it.
    let rent_floor = Rent::get()?.minimum_balance(8 + AgentSpend::INIT_SPACE);
    let info = spend.to_account_info();
    let balance = info.lamports();
    require!(
        balance.saturating_sub(lamports) >= rent_floor,
        CleatError::SpendAccountEmpty
    );

    // A direct debit rather than a system transfer, because the source is
    // owned by this program and the system program will not move lamports out
    // of an account it does not own.
    **info.try_borrow_mut_lamports()? = balance
        .checked_sub(lamports)
        .ok_or(CleatError::SpendAccountEmpty)?;
    **ctx.accounts.payee.try_borrow_mut_lamports()? = ctx
        .accounts
        .payee
        .lamports()
        .checked_add(lamports)
        .ok_or(CleatError::SpendCapBreached)?;

    spend.spent_lamports = spend.spent_lamports.saturating_add(lamports);
    spend.lifetime_lamports = spend.lifetime_lamports.saturating_add(lamports);
    spend.payments = spend.payments.saturating_add(1);

    emit!(AgentPaid {
        owner: spend.owner,
        payee: ctx.accounts.payee.key(),
        lamports,
        remaining: spend.ceiling_lamports.saturating_sub(spend.spent_lamports),
        purpose,
    });
    Ok(())
}
