use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::CleatError;

/// Take a sleeve down, everything under it, and give the owner back every
/// lamport it held.
///
/// This is what "delete my account" means on chain. The transactions that
/// built these accounts stay in the ledger's history, because nothing can
/// remove those, but the accounts themselves stop existing and nothing Cleat
/// reads can find them again.
///
/// Every account is taken as unchecked and matched by its seeds, which all
/// start from the signer's own key, so nobody can close anyone else's. Not
/// deserialising them is deliberate: decision logs from before the current
/// layout would fail to load as the current type, and an owner has to be able
/// to delete an old account as surely as a new one. Any of the five may be
/// missing; a sleeve that never opened a spend account still closes.
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CloseSleeve<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: matched by seeds off the signer, closed by hand below.
    #[account(mut, seeds = [MANDATE_SEED, owner.key().as_ref(), &index_seed(index)], bump)]
    pub mandate: UncheckedAccount<'info>,

    /// CHECK: matched by seeds off the mandate above, closed by hand below.
    #[account(mut, seeds = [UNIVERSE_SEED, mandate.key().as_ref()], bump)]
    pub universe: UncheckedAccount<'info>,

    /// CHECK: matched by seeds off the signer, closed by hand below.
    #[account(mut, seeds = [VAULT_SEED, owner.key().as_ref(), &index_seed(index)], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: matched by seeds off the signer, closed by hand below.
    #[account(mut, seeds = [VERDICT_SEED, owner.key().as_ref(), &index_seed(index)], bump)]
    pub log: UncheckedAccount<'info>,

    /// CHECK: matched by seeds off the signer, closed by hand below.
    #[account(mut, seeds = [SPEND_SEED, owner.key().as_ref(), &index_seed(index)], bump)]
    pub spend: UncheckedAccount<'info>,
}

pub fn exec_close_sleeve(ctx: Context<CloseSleeve>, index: u16) -> Result<()> {
    let owner = ctx.accounts.owner.to_account_info();

    // The vault first. If it is out on the rollup, its owner on base is the
    // delegation program and this program cannot touch it. Refusing the whole
    // thing beats closing the sentence and stranding the money behind it.
    require!(
        ctx.accounts.vault.lamports() == 0
            || *ctx.accounts.vault.owner != ephemeral_rollups_sdk::id(),
        CleatError::VaultDelegated
    );

    let mut returned = 0u64;
    for acc in [
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.spend.to_account_info(),
        ctx.accounts.log.to_account_info(),
        ctx.accounts.universe.to_account_info(),
        ctx.accounts.mandate.to_account_info(),
    ] {
        returned = returned.saturating_add(close_raw(&acc, &owner)?);
    }

    emit!(SleeveClosed {
        owner: owner.key(),
        index,
        returned,
    });
    Ok(())
}

/// Anchor's own close, without the deserialise.
///
/// Only accounts this program owns are closed. Anything else sitting at one of
/// these addresses, such as a stray transfer to a PDA that was never opened, is
/// owned by the system program and is not ours to move, so it is left alone.
fn close_raw<'info>(acc: &AccountInfo<'info>, to: &AccountInfo<'info>) -> Result<u64> {
    let lamports = acc.lamports();
    if lamports == 0 || *acc.owner != crate::ID {
        return Ok(0);
    }
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(lamports)
        .ok_or(CleatError::VaultEmpty)?;
    **acc.try_borrow_mut_lamports()? = 0;
    acc.assign(&system_program::ID);
    acc.resize(0)?;
    Ok(lamports)
}

#[event]
pub struct SleeveClosed {
    pub owner: Pubkey,
    pub index: u16,
    pub returned: u64,
}
