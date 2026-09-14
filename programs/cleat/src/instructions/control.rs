//! A control, and nothing this product needs.
//!
//! Five of our circuits have aborted and they differ from each other in
//! every dimension we could think to vary: the width of the number, struct
//! against bare, the arithmetic, bool against tuple, whether the caller's
//! key is used, whether anything is sealed to the MXE. All five died the
//! same way, which usually means the thing being varied is not the thing
//! that is wrong.
//!
//! So this deploys a circuit that is known to work. It is Ilowa's
//! init_pool_state_v4, running today on this same cluster under a
//! different MXE, copied without changes. It takes no input, so there is
//! no encryption on the way in to get wrong, and returns one value sealed
//! to the MXE.
//!
//! If it works here, the fault is in our circuit and the bisect continues
//! with the space cut in half. If it aborts here, the fault is in this MXE
//! or this program, and no rewrite of the gate was ever going to fix it.
//!
//! Delete once that question is answered.

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::{ArciumSignerAccount, ID, ID_CONST};

pub const COMP_DEF_OFFSET_CONTROL: u32 = comp_def_offset("control_init_pool");

#[init_computation_definition_accounts("control_init_pool", payer)]
#[derive(Accounts)]
pub struct InitControlCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: not initialised yet, so the arcium program checks it.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: the address lookup table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("control_init_pool", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ControlQueue<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CONTROL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("control_init_pool")]
#[derive(Accounts)]
pub struct ControlInitPoolCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CONTROL))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: validated by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: checked by the account constraint.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn exec_init_control_comp_def(ctx: Context<InitControlCompDef>) -> Result<()> {
    init_computation_def(ctx.accounts, None)?;
    Ok(())
}

pub fn exec_queue_control(ctx: Context<ControlQueue>, computation_offset: u64) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    queue_computation(
        ctx.accounts,
        computation_offset,
        ArgBuilder::new().build(),
        vec![ControlInitPoolCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[],
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

/// Says what came back rather than erroring on it, which is the only
/// reason the probes told us anything.
pub fn exec_control_callback(
    ctx: Context<ControlInitPoolCallback>,
    output: SignedComputationOutputs<ControlInitPoolOutput>,
) -> Result<()> {
    match output.verify_output_raw(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(bytes) => msg!("CONTROL ok, {} output bytes", bytes.len()),
        Err(e) => msg!("CONTROL rejected: {:?}", e),
    }
    Ok(())
}
