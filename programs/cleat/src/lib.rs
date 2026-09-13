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
        text: String,
        max_position_bps: u16,
        max_trade_bps: u16,
        denied: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::mandate::exec_create_mandate(ctx, text, max_position_bps, max_trade_bps, denied)
    }

    pub fn update_mandate(
        ctx: Context<UpdateMandate>,
        text: String,
        max_position_bps: u16,
        max_trade_bps: u16,
        denied: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::mandate::exec_update_mandate(ctx, text, max_position_bps, max_trade_bps, denied)
    }

    pub fn adopt_mandate(ctx: Context<AdoptMandate>, text: String) -> Result<()> {
        instructions::mandate::exec_adopt_mandate(ctx, text)
    }

    pub fn open_vault(ctx: Context<OpenVault>) -> Result<()> {
        instructions::vault::exec_open_vault(ctx)
    }

    pub fn set_agent(
        ctx: Context<SetAgent>,
        agent: Pubkey,
        ttl_seconds: i64,
        max_trade: u64,
    ) -> Result<()> {
        instructions::vault::exec_set_agent(ctx, agent, ttl_seconds, max_trade)
    }

    pub fn revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
        instructions::vault::exec_revoke_agent(ctx)
    }

    pub fn open_verdict_log(ctx: Context<OpenVerdictLog>) -> Result<()> {
        instructions::verdict::exec_open_verdict_log(ctx)
    }

    pub fn propose_trade(
        ctx: Context<ProposeTrade>,
        category: u8,
        proposed_bps: u16,
        from_ingested_content: bool,
    ) -> Result<()> {
        instructions::verdict::exec_propose_trade(ctx, category, proposed_bps, from_ingested_content)
    }

    pub fn init_gate_comp_def(ctx: Context<InitGateCompDef>) -> Result<()> {
        instructions::gate::exec_init_gate_comp_def(ctx)
    }

    pub fn gate_trade(
        ctx: Context<GateTrade>,
        computation_offset: u64,
        exposure_ct: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        category: u8,
        proposed_bps: u16,
    ) -> Result<()> {
        instructions::gate::exec_gate_trade(
            ctx, computation_offset, exposure_ct, pubkey, nonce, category, proposed_bps,
        )
    }

    #[arcium_callback(encrypted_ix = "gate_breach_v2")]
    pub fn gate_breach_v2_callback(
        ctx: Context<GateBreachV2Callback>,
        output: SignedComputationOutputs<GateBreachV2Output>,
    ) -> Result<()> {
        instructions::gate::exec_gate_callback(ctx, output)
    }

    pub fn delegate_vault(ctx: Context<DelegateVault>) -> Result<()> {
        instructions::per::exec_delegate_vault(ctx)
    }

    pub fn seal_vault(ctx: Context<SealVault>) -> Result<()> {
        instructions::per::exec_seal_vault(ctx)
    }

    pub fn release_vault(ctx: Context<ReleaseVault>) -> Result<()> {
        instructions::per::exec_release_vault(ctx)
    }

    // ── The probes ────────────────────────────────────────────────────
    // Temporary. They exist to find out why gate_breach_v2 comes back a
    // signed failure, and they go once it does not.

    pub fn init_probe_a_comp_def(ctx: Context<InitProbeACompDef>) -> Result<()> {
        instructions::probe::exec_init_probe_a(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn queue_probe_a(
        ctx: Context<ProbeAQueue>,
        computation_offset: u64,
        exposure_ct: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        a: u64,
        b: u64,
    ) -> Result<()> {
        instructions::probe::exec_queue_probe_a(
            ctx, computation_offset, exposure_ct, pubkey, nonce, a, b,
        )
    }

    #[arcium_callback(encrypted_ix = "probe_a")]
    pub fn probe_a_callback(
        ctx: Context<ProbeACallback>,
        output: SignedComputationOutputs<ProbeAOutput>,
    ) -> Result<()> {
        instructions::probe::exec_probe_a_callback(ctx, output)
    }

    pub fn init_probe_b_comp_def(ctx: Context<InitProbeBCompDef>) -> Result<()> {
        instructions::probe::exec_init_probe_b(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn queue_probe_b(
        ctx: Context<ProbeBQueue>,
        computation_offset: u64,
        exposure_ct: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        a: u64,
        b: u64,
    ) -> Result<()> {
        instructions::probe::exec_queue_probe_b(
            ctx, computation_offset, exposure_ct, pubkey, nonce, a, b,
        )
    }

    #[arcium_callback(encrypted_ix = "probe_b")]
    pub fn probe_b_callback(
        ctx: Context<ProbeBCallback>,
        output: SignedComputationOutputs<ProbeBOutput>,
    ) -> Result<()> {
        instructions::probe::exec_probe_b_callback(ctx, output)
    }


}
