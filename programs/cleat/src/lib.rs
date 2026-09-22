pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("2B7Efr1WtxSZ9RqJ4hapyUtKJDs3sx3tkAsXc6JfuigL");

/// Cleat holds a line under load and releases only when a person lets it go.
///
/// An agent proposes trades. A mandate written by the owner decides whether a
/// proposal is allowed, and the owner is the only signer who can change that
/// mandate. Holdings are not stored here in the clear; a vault carries a handle
/// to an encrypted position set instead, so the operator running the agent
/// cannot read what the agent is trading against.
#[ephemeral]
#[arcium_program]
pub mod cleat {
    use super::*;

    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        index: u16,
        text: String,
        max_position_bps: u16,
        max_trade_bps: u16,
        max_spread_bps: u16,
        denied: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::mandate::exec_create_mandate(
            ctx,
            index,
            text,
            max_position_bps,
            max_trade_bps,
            max_spread_bps,
            denied,
        )
    }

    pub fn update_mandate(
        ctx: Context<UpdateMandate>,
        index: u16,
        text: String,
        max_position_bps: u16,
        max_trade_bps: u16,
        max_spread_bps: u16,
        denied: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::mandate::exec_update_mandate(
            ctx,
            index,
            text,
            max_position_bps,
            max_trade_bps,
            max_spread_bps,
            denied,
        )
    }

    pub fn set_halted(ctx: Context<SetHalted>, index: u16, halted: bool) -> Result<()> {
        instructions::mandate::exec_set_halted(ctx, index, halted)
    }

    pub fn adopt_mandate(ctx: Context<AdoptMandate>, index: u16, text: String) -> Result<()> {
        instructions::mandate::exec_adopt_mandate(ctx, index, text)
    }

    pub fn declare_universe(
        ctx: Context<DeclareUniverse>,
        index: u16,
        entries: Vec<AssetEntry>,
    ) -> Result<()> {
        instructions::mandate::exec_declare_universe(ctx, index, entries)
    }

    pub fn open_vault(ctx: Context<OpenVault>, index: u16) -> Result<()> {
        instructions::vault::exec_open_vault(ctx, index)
    }

    pub fn set_agent(
        ctx: Context<SetAgent>,
        index: u16,
        agent: Pubkey,
        ttl_seconds: i64,
        max_trade: u64,
    ) -> Result<()> {
        instructions::vault::exec_set_agent(ctx, index, agent, ttl_seconds, max_trade)
    }

    pub fn revoke_agent(ctx: Context<RevokeAgent>, index: u16) -> Result<()> {
        instructions::vault::exec_revoke_agent(ctx, index)
    }

    pub fn deposit(ctx: Context<Deposit>, index: u16, lamports: u64) -> Result<()> {
        instructions::vault::exec_deposit(ctx, index, lamports)
    }

    pub fn withdraw(ctx: Context<Withdraw>, index: u16, lamports: u64) -> Result<()> {
        instructions::vault::exec_withdraw(ctx, index, lamports)
    }

    pub fn set_book_size(ctx: Context<SetBookSize>, index: u16, quote_units: u64) -> Result<()> {
        instructions::vault::exec_set_book_size(ctx, index, quote_units)
    }

    pub fn set_position_handle(
        ctx: Context<SetPositionHandle>,
        index: u16,
        handle: [u8; 32],
    ) -> Result<()> {
        instructions::vault::exec_set_position_handle(ctx, index, handle)
    }

    pub fn open_verdict_log(ctx: Context<OpenVerdictLog>, index: u16) -> Result<()> {
        instructions::verdict::exec_open_verdict_log(ctx, index)
    }

    pub fn open_treasury(ctx: Context<OpenTreasury>) -> Result<()> {
        instructions::verdict::exec_open_treasury(ctx)
    }

    pub fn migrate_verdict_log(ctx: Context<MigrateVerdictLog>, index: u16) -> Result<()> {
        instructions::verdict::exec_migrate_verdict_log(ctx, index)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn propose_trade(
        ctx: Context<ProposeTrade>,
        index: u16,
        category: u8,
        proposed_bps: u16,
        from_ingested_content: bool,
        side: u8,
        observed_spread_bps: u16,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::verdict::exec_propose_trade(
            ctx,
            index,
            category,
            proposed_bps,
            from_ingested_content,
            side,
            observed_spread_bps,
            mint,
        )
    }

    pub fn init_gate_comp_def(ctx: Context<InitGateCompDef>) -> Result<()> {
        instructions::gate::exec_init_gate_comp_def(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn gate_trade(
        ctx: Context<GateTrade>,
        computation_offset: u64,
        index: u16,
        exposure_ct: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        category: u8,
        proposed_bps: u16,
        side: u8,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::gate::exec_gate_trade(
            ctx,
            computation_offset,
            index,
            exposure_ct,
            pubkey,
            nonce,
            category,
            proposed_bps,
            side,
            mint,
        )
    }

    #[arcium_callback(encrypted_ix = "gate_breach_v7")]
    pub fn gate_breach_v7_callback(
        ctx: Context<GateBreachV7Callback>,
        output: SignedComputationOutputs<GateBreachV7Output>,
    ) -> Result<()> {
        instructions::gate::exec_gate_callback(ctx, output)
    }

    pub fn delegate_vault(ctx: Context<DelegateVault>, index: u16) -> Result<()> {
        instructions::per::exec_delegate_vault(ctx, index)
    }

    pub fn seal_vault(ctx: Context<SealVault>, index: u16) -> Result<()> {
        instructions::per::exec_seal_vault(ctx, index)
    }

    pub fn release_vault(ctx: Context<ReleaseVault>, index: u16) -> Result<()> {
        instructions::per::exec_release_vault(ctx, index)
    }


    // ── The control ───────────────────────────────────────────────────
    // A circuit known to work on this cluster, deployed here to find out
    // whether the fault is our circuit or this MXE. Goes once answered.
    pub fn init_control_comp_def(ctx: Context<InitControlCompDef>) -> Result<()> {
        instructions::control::exec_init_control_comp_def(ctx)
    }

    pub fn queue_control(ctx: Context<ControlQueue>, computation_offset: u64) -> Result<()> {
        instructions::control::exec_queue_control(ctx, computation_offset)
    }

    #[arcium_callback(encrypted_ix = "control_init_pool_v3")]
    pub fn control_init_pool_v3_callback(
        ctx: Context<ControlInitPoolV3Callback>,
        output: SignedComputationOutputs<ControlInitPoolV3Output>,
    ) -> Result<()> {
        instructions::control::exec_control_callback(ctx, output)
    }

    // ── What the agent may spend on itself ────────────────────────────
    //
    // Separate from the mandate on purpose. The mandate bounds what the
    // agent may do with the client's money; this bounds what it may do
    // with its own, and an agent that pays per call for its own inference
    // needs both or it has only half a leash.
    pub fn open_spend_account(
        ctx: Context<OpenSpendAccount>,
        index: u16,
        agent: Pubkey,
        ceiling_lamports: u64,
        period_secs: i64,
    ) -> Result<()> {
        instructions::spend::exec_open_spend_account(ctx, index, agent, ceiling_lamports, period_secs)
    }

    pub fn set_spend_cap(
        ctx: Context<SetSpendCap>,
        index: u16,
        ceiling_lamports: u64,
        period_secs: i64,
    ) -> Result<()> {
        instructions::spend::exec_set_spend_cap(ctx, index, ceiling_lamports, period_secs)
    }

    pub fn fund_spend_account(ctx: Context<FundSpendAccount>, index: u16, lamports: u64) -> Result<()> {
        instructions::spend::exec_fund_spend_account(ctx, index, lamports)
    }

    pub fn pay_agent_cost(ctx: Context<PayAgentCost>, index: u16, lamports: u64, purpose: u8) -> Result<()> {
        instructions::spend::exec_pay_agent_cost(ctx, index, lamports, purpose)
    }


}
