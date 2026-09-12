use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
    TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::*;
use crate::error::CleatError;
use crate::state::Vault;

/// Hand the vault to the attested rollup.
///
/// After this the account is no longer writable on base, and every change to it
/// happens inside the enclave until it is released. The validator is pinned to
/// the TDX one on purpose: an ordinary ephemeral rollup would give us the speed
/// and none of the confidentiality.
#[delegate]
#[derive(Accounts)]
pub struct DelegateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: the delegate macro takes this as a raw account, and ownership is
    /// checked by the seeds below rather than by deserialising it.
    #[account(mut, del, seeds = [VAULT_SEED, owner.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
}

pub fn exec_delegate_vault(ctx: Context<DelegateVault>) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    ctx.accounts.delegate_vault(
        &ctx.accounts.owner,
        &[VAULT_SEED, owner.as_ref()],
        DelegateConfig {
            commit_frequency_ms: COMMIT_FREQUENCY_MS,
            validator: Some(TEE_VALIDATOR),
        },
    )?;
    Ok(())
}

/// Mark the vault private inside the rollup, and say who may see what.
///
/// This runs on the ephemeral rollup, not on base, and it is the instruction the
/// whole confidentiality claim rests on. The flags are the point:
///
/// The owner gets `TX_BALANCES_FLAG`, so they can see their own position.
/// The agent gets `TX_LOGS_FLAG` and nothing else, so it can see that it acted
/// and cannot see what it acted on. Nobody else is listed at all, and that
/// includes whoever operates this service.
///
/// Earlier versions of this SDK offered one switch that hid an account from the
/// world while whitelisting the operator as reader, which is a weaker claim than
/// it sounds: it protects you from strangers, not from us. The per member flags
/// here are what let the reader be the owner instead.
#[derive(Accounts)]
pub struct SealVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: derived and verified against the permission program below.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: the rollup's rent collector for ephemeral accounts, a fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,

    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

pub fn exec_seal_vault(ctx: Context<SealVault>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let owner = vault.owner;

    // The permission account is derived from the account it governs, so a caller
    // cannot point this at somebody else's permission and rewrite it.
    let (expected, _) = EphemeralPermission::find_pda(&vault.key());
    require_keys_eq!(
        ctx.accounts.permission.key(),
        expected,
        CleatError::NotOwner
    );

    let mut members = vec![Member {
        flags: AUTHORITY_FLAG
            | TX_LOGS_FLAG
            | TX_BALANCES_FLAG
            | TX_MESSAGE_FLAG
            | ACCOUNT_SIGNATURES_FLAG,
        pubkey: owner,
    }];

    // An agent that has been granted authority gets to watch itself work and
    // nothing more. If no agent is set, nobody is added, which is the state a
    // fresh vault should sit in.
    if vault.agent != Pubkey::default() {
        members.push(Member {
            flags: TX_LOGS_FLAG,
            pubkey: vault.agent,
        });
    }

    let bump = vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), &[bump]];

    // The sponsor funds the ephemeral permission's storage, 6208 lamports for a
    // 134 byte account at the rollup's 32 lamports per byte, and it has to be
    // both delegated to the rollup and holding lamports to spare. Those two
    // requirements pick the account for you. The signing wallet has spare
    // balance but is not delegated, so the magic program refuses it with
    // InvalidAccountForFee. The vault is delegated, so it sponsors, and it must
    // therefore carry a little more than its rent exempt minimum or the same
    // call fails with InsufficientFundsForRent instead.
    CreateEphemeralPermissionCpi {
        permissioned_account: ctx.accounts.vault.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        payer: ctx.accounts.vault.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs {
            is_private: true,
            members,
        },
    }
    .invoke_signed(&[seeds])?;

    Ok(())
}

/// Bring the vault back to base and stop paying for the rollup.
///
/// What lands on base is the settled state, not the journey. Everything that
/// happened inside the enclave stays there.
#[derive(Accounts)]
pub struct ReleaseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: the rollup's context account, a fixed address.
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,

    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

pub fn exec_release_vault(ctx: Context<ReleaseVault>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.vault.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}
