//! A guard in front of a Squads spending limit.
//!
//! Squads v4 already lets a multisig hand someone a spending limit: an amount
//! per day, week or month, out of one vault, optionally only to listed
//! destinations. What it does not do is remember the times it said no. An
//! over-limit `spending_limit_use` returns an error, an error rolls back every
//! account change, and the attempt leaves nothing behind but a failed
//! transaction nobody is indexing. For an agent that is the number that matters.
//!
//! So the agent is never put on the spending limit itself. The guard's own
//! address is, and the agent pays through the guard. The guard reads the
//! spending limit first, applies the same rules Squads will apply, and when the
//! answer is no it records a refusal (a count and a reason, never the amount or
//! what was left) and succeeds without moving anything. When the answer is yes
//! it signs `spending_limit_use` as the member and Squads moves the money.
//!
//! Nothing here can move money Squads would not move. The guard only ever adds
//! a no: it can pause, and it refuses early, but the limit, the vault and the
//! destinations stay the multisig's, changed only by its own vote. Taking the
//! guard off the spending limit, or deleting the limit, ends the agent's access
//! without touching this program.
//!
//! The order a multisig sets this up in: open the guard (its address is known
//! before anything exists, from the spending limit and the agent), then vote an
//! AddSpendingLimit naming the guard's address as the member.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke_signed, set_return_data},
};

use crate::constants::*;
use crate::error::CleatError;
use crate::state::SquadsGuard;

#[derive(Accounts)]
pub struct OpenSquadsGuard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Who may pause, resume and close the guard. Usually the multisig's vault
    /// or the person who runs the agent. It has no say over the limit itself.
    pub authority: Signer<'info>,

    /// CHECK: owner and layout are checked in the handler; it must be a Squads
    /// v4 SpendingLimit.
    #[account(owner = SQUADS_PROGRAM_ID @ CleatError::NotSquadsSpendingLimit)]
    pub spending_limit: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + SquadsGuard::INIT_SPACE,
        seeds = [SQUADS_GUARD_SEED, spending_limit.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub guard: Box<Account<'info, SquadsGuard>>,

    /// CHECK: only its address is kept. The agent signs every payment later.
    pub agent: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSquadsGuardPaused<'info> {
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority @ CleatError::NotGuardAuthority)]
    pub guard: Box<Account<'info, SquadsGuard>>,
}

#[derive(Accounts)]
pub struct CloseSquadsGuard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, close = authority, has_one = authority @ CleatError::NotGuardAuthority)]
    pub guard: Box<Account<'info, SquadsGuard>>,
}

/// Every account `spending_limit_use` takes, in its order, plus the agent and
/// the guard. For a SOL limit the four token accounts are the Squads program
/// id, which is how Anchor reads an optional account that is absent. Squads
/// checks all of them; the guard checks only what it needs to decide.
#[derive(Accounts)]
pub struct SquadsGuardPay<'info> {
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [SQUADS_GUARD_SEED, guard.spending_limit.as_ref(), agent.key().as_ref()],
        bump = guard.bump,
        has_one = agent @ CleatError::NotTheAgent,
        has_one = spending_limit @ CleatError::NotSquadsSpendingLimit,
    )]
    pub guard: Box<Account<'info, SquadsGuard>>,

    /// CHECK: Squads checks its seeds; the guard checks it is the limit's own.
    #[account(address = guard.multisig @ CleatError::WrongSquadsMultisig)]
    pub multisig: UncheckedAccount<'info>,

    /// CHECK: owner checked here, layout in the handler.
    #[account(mut, owner = SQUADS_PROGRAM_ID @ CleatError::NotSquadsSpendingLimit)]
    pub spending_limit: UncheckedAccount<'info>,

    /// CHECK: Squads derives and checks the vault.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: the guard checks it against the limit's destinations; Squads
    /// checks it again and checks the token account belongs to it.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    /// CHECK: passed through.
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: passed through, or the Squads program id for a SOL limit.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: passed through, or the Squads program id for a SOL limit.
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: passed through, or the Squads program id for a SOL limit.
    #[account(mut)]
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: passed through, or the Squads program id for a SOL limit.
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: pinned to Squads v4.
    #[account(address = SQUADS_PROGRAM_ID)]
    pub squads_program: UncheckedAccount<'info>,
}

#[event]
pub struct SquadsGuardPaid {
    pub guard: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

/// A refusal says why and how many times, and nothing about the limit: no
/// amount asked, nothing about what was left.
#[event]
pub struct SquadsGuardRefused {
    pub guard: Pubkey,
    pub reason: u8,
    pub refusals: u32,
}

/// The parts of a Squads v4 SpendingLimit the guard decides on.
struct SpendingLimitView {
    multisig: Pubkey,
    amount: u64,
    period_secs: Option<i64>,
    remaining: u64,
    last_reset: i64,
    members: Vec<Pubkey>,
    destinations: Vec<Pubkey>,
}

impl SpendingLimitView {
    fn read(info: &AccountInfo) -> Result<Self> {
        let data = info.try_borrow_data()?;
        require!(data.len() >= 8 && data[..8] == SQUADS_SPENDING_LIMIT_DISC, CleatError::NotSquadsSpendingLimit);
        let mut at = 8usize;
        let mut take = |n: usize| -> Result<std::ops::Range<usize>> {
            require!(data.len() >= at + n, CleatError::NotSquadsSpendingLimit);
            at += n;
            Ok(at - n..at)
        };
        let key = |r: std::ops::Range<usize>| Pubkey::new_from_array(data[r].try_into().unwrap());
        let u64_ = |r: std::ops::Range<usize>| u64::from_le_bytes(data[r].try_into().unwrap());

        let multisig = key(take(32)?);
        take(32)?; // create_key
        take(1)?; // vault_index
        take(32)?; // mint
        let amount = u64_(take(8)?);
        let period_secs = match data[take(1)?.start] {
            0 => None,
            1 => Some(24 * 60 * 60),
            2 => Some(7 * 24 * 60 * 60),
            3 => Some(30 * 24 * 60 * 60),
            _ => return err!(CleatError::NotSquadsSpendingLimit),
        };
        let remaining = u64_(take(8)?);
        let last_reset = u64_(take(8)?) as i64;
        take(1)?; // bump
        let mut lists = [Vec::new(), Vec::new()]; // members, destinations
        for list in lists.iter_mut() {
            let n = u32::from_le_bytes(data[take(4)?].try_into().unwrap()) as usize;
            for _ in 0..n {
                list.push(key(take(32)?));
            }
        }
        let [members, destinations] = lists;
        Ok(Self { multisig, amount, period_secs, remaining, last_reset, members, destinations })
    }

    /// What Squads will see as remaining when it runs, including the reset it
    /// does first. Same arithmetic, same strict comparison.
    fn remaining_at(&self, now: i64) -> u64 {
        match self.period_secs {
            Some(p) if now.saturating_sub(self.last_reset) > p => self.amount,
            _ => self.remaining,
        }
    }
}

pub fn exec_open_squads_guard(ctx: Context<OpenSquadsGuard>) -> Result<()> {
    let limit = SpendingLimitView::read(&ctx.accounts.spending_limit)?;
    let guard = &mut ctx.accounts.guard;
    guard.authority = ctx.accounts.authority.key();
    guard.agent = ctx.accounts.agent.key();
    guard.multisig = limit.multisig;
    guard.spending_limit = ctx.accounts.spending_limit.key();
    guard.paused = false;
    guard.payments = 0;
    guard.refusals = 0;
    guard.bump = ctx.bumps.guard;
    Ok(())
}

pub fn exec_set_squads_guard_paused(ctx: Context<SetSquadsGuardPaused>, paused: bool) -> Result<()> {
    ctx.accounts.guard.paused = paused;
    Ok(())
}

/// The agent pays through the guard. As in spend.rs, a refusal succeeds as a
/// transaction so the count can rise, and the return data says which it was.
pub fn exec_squads_guard_pay(ctx: Context<SquadsGuardPay>, amount: u64, decimals: u8) -> Result<()> {
    require!(amount > 0, CleatError::EmptyPayment);
    let limit = SpendingLimitView::read(&ctx.accounts.spending_limit)?;
    let guard_key = ctx.accounts.guard.key();

    // A guard that is not on the limit is a setup mistake, not a decision, so
    // it fails loudly instead of being counted as the agent's refusal.
    require!(limit.members.contains(&guard_key), CleatError::GuardNotOnLimit);

    let now = Clock::get()?.unix_timestamp;
    let destination = ctx.accounts.destination.key();
    let reason = if ctx.accounts.guard.paused {
        Some(GUARD_REFUSED_PAUSED)
    } else if !limit.destinations.is_empty() && !limit.destinations.contains(&destination) {
        Some(GUARD_REFUSED_DESTINATION)
    } else if amount > limit.remaining_at(now) {
        Some(GUARD_REFUSED_OVER_LIMIT)
    } else {
        None
    };

    if let Some(reason) = reason {
        let guard = &mut ctx.accounts.guard;
        guard.refusals = guard.refusals.saturating_add(1);
        emit!(SquadsGuardRefused { guard: guard_key, reason, refusals: guard.refusals });
        set_return_data(&[REFUSED]);
        return Ok(());
    }

    let a = &ctx.accounts;
    let mut data = SQUADS_SPENDING_LIMIT_USE_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    data.push(0); // memo: None
    let ix = Instruction {
        program_id: SQUADS_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(a.multisig.key(), false),
            AccountMeta::new_readonly(guard_key, true),
            AccountMeta::new(a.spending_limit.key(), false),
            AccountMeta::new(a.vault.key(), false),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(a.system_program.key(), false),
            AccountMeta::new_readonly(a.mint.key(), false),
            AccountMeta::new(a.vault_token_account.key(), false),
            AccountMeta::new(a.destination_token_account.key(), false),
            AccountMeta::new_readonly(a.token_program.key(), false),
        ],
        data,
    };
    let infos = [
        a.multisig.to_account_info(),
        a.guard.to_account_info(),
        a.spending_limit.to_account_info(),
        a.vault.to_account_info(),
        a.destination.to_account_info(),
        a.system_program.to_account_info(),
        a.mint.to_account_info(),
        a.vault_token_account.to_account_info(),
        a.destination_token_account.to_account_info(),
        a.token_program.to_account_info(),
        a.squads_program.to_account_info(),
    ];
    let bump = [a.guard.bump];
    let seeds: &[&[u8]] = &[SQUADS_GUARD_SEED, a.guard.spending_limit.as_ref(), a.guard.agent.as_ref(), &bump];
    invoke_signed(&ix, &infos, &[seeds])?;

    let guard = &mut ctx.accounts.guard;
    guard.payments = guard.payments.saturating_add(1);
    emit!(SquadsGuardPaid { guard: guard_key, destination, amount });
    set_return_data(&[PAID]);
    Ok(())
}
