use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// ID, ID_CONST and ArciumSignerAccount are crate root items: declare_id! and the
// arcium_program macro both expand in lib.rs, and the account macros below
// reference them unqualified.
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::{ArciumSignerAccount, ID, ID_CONST};

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{Mandate, Vault, Verdict, VerdictLog};

pub const COMP_DEF_OFFSET_GATE_TRADE: u32 = comp_def_offset("gate_trade");

#[init_computation_definition_accounts("gate_trade", payer)]
#[derive(Accounts)]
pub struct InitGateCompDef<'info> {
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

/// Ask the gate.
///
/// The agent hands over a proposal in the open and a sealed copy of what the
/// client holds. The holdings are encrypted to the client's own key and this
/// program never sees inside them; it only forwards them to the computation.
/// The caps travel in the clear because they are already public on the mandate,
/// and sending them as plaintext keeps them out of the expensive part of the
/// circuit.
#[queue_computation_accounts("gate_trade", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct GateTrade<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Boxed, all three. Anchor builds this struct on the BPF stack, which is
    // 4KB a frame, and Arcium's own account set already fills most of it. A
    // Mandate carries a 280 byte string and a VerdictLog sixteen entries, so
    // adding them unboxed overflows the frame and the program dies with an
    // access violation in an unallocated region, before a single line of the
    // handler runs and with no error worth reading.
    #[account(seeds = [VAULT_SEED, vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(seeds = [MANDATE_SEED, vault.owner.as_ref()], bump = mandate.bump)]
    pub mandate: Box<Account<'info, Mandate>>,
    #[account(mut, seeds = [VERDICT_SEED, vault.owner.as_ref()], bump = log.bump)]
    pub log: Box<Account<'info, VerdictLog>>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_GATE_TRADE))]
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

#[callback_accounts("gate_trade")]
#[derive(Accounts)]
pub struct GateTradeCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_GATE_TRADE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: validated by the arcium program; verify_output reads it.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: checked by the account constraint.
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// The log the verdict lands in, passed through as an extra callback account.
    #[account(mut)]
    pub log: Box<Account<'info, VerdictLog>>,
}

#[event]
pub struct GateDecided {
    pub vault: Pubkey,
    pub outcome: u8,
    pub proposed_bps: u16,
    pub allowed_bps: u16,
}

pub fn exec_init_gate_comp_def(ctx: Context<InitGateCompDef>) -> Result<()> {
    init_computation_def(ctx.accounts, None)?;
    Ok(())
}

pub fn exec_gate_trade(
    ctx: Context<GateTrade>,
    computation_offset: u64,
    exposure_ct: [u8; 32],
    total_ct: [u8; 32],
    pubkey: [u8; 32],
    nonce: u128,
    category: u8,
    proposed_bps: u16,
) -> Result<()> {
    require!(proposed_bps > 0, CleatError::EmptyProposal);

    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.payer.key();
    let vault = &ctx.accounts.vault;
    if signer != vault.owner {
        require!(vault.agent_is_live(now), CleatError::AgentNotLive);
        require_keys_eq!(signer, vault.agent, CleatError::NotOwner);
    }
    require!(
        vault.mandate_version == ctx.accounts.mandate.version,
        CleatError::StaleMandate
    );

    // Park what the callback will need. It receives the circuit's answer and
    // nothing else, so the question has to be recorded before it is asked.
    let clamp_to = ctx.accounts.mandate.max_trade_bps;
    let max_position_bps = ctx.accounts.mandate.max_position_bps;
    {
        let log = &mut ctx.accounts.log;
        log.pending_offset = computation_offset;
        log.pending_category = category;
        log.pending_bps = proposed_bps;
        log.pending_clamp_bps = clamp_to;
    }
    let log_key = ctx.accounts.log.key();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Argument order has to match the circuit exactly. An Enc<Shared, T>
    // expands to the sender's x25519 key, the nonce, then one entry per field.
    let args = ArgBuilder::new()
        .x25519_pubkey(pubkey)
        .plaintext_u128(nonce)
        .encrypted_u32(exposure_ct)
        .encrypted_u32(total_ct)
        .plaintext_u16(proposed_bps)
        .plaintext_u16(max_position_bps)
        .plaintext_u16(clamp_to)
        .build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![GateTradeCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: log_key,
                is_writable: true,
            }],
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

/// What the gate decided, written down.
///
/// The computation returned one number. Everything else in the entry comes from
/// what was parked before the question was asked, which is why the log carries
/// the pending fields at all.
pub fn exec_gate_callback(
    ctx: Context<GateTradeCallback>,
    output: SignedComputationOutputs<GateTradeOutput>,
) -> Result<()> {
    let outcome = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(GateTradeOutput { field_0 }) => field_0,
        Err(_) => return Err(CleatError::GateAborted.into()),
    };

    let log = &mut ctx.accounts.log;
    let proposed_bps = log.pending_bps;
    let category = log.pending_category;
    let vault_key = log.vault;
    let allowed_bps = match outcome {
        0 => proposed_bps,
        1 => log.pending_clamp_bps,
        _ => 0,
    };
    let reason = match outcome {
        0 => 0u8,
        1 => 2u8,
        _ => 1u8,
    };

    log.push(Verdict {
        slot: Clock::get()?.slot,
        mandate_version: 0,
        category,
        proposed_bps,
        allowed_bps,
        outcome,
        reason,
    });
    log.pending_offset = 0;
    log.pending_bps = 0;

    emit!(GateDecided {
        vault: vault_key,
        outcome,
        proposed_bps,
        allowed_bps,
    });
    Ok(())
}
