pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
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
#[program]
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

    pub fn delegate_vault(ctx: Context<DelegateVault>) -> Result<()> {
        instructions::per::exec_delegate_vault(ctx)
    }

    pub fn seal_vault(ctx: Context<SealVault>) -> Result<()> {
        instructions::per::exec_seal_vault(ctx)
    }

    pub fn release_vault(ctx: Context<ReleaseVault>) -> Result<()> {
        instructions::per::exec_release_vault(ctx)
    }
}
