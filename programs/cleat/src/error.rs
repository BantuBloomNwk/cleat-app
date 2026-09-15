use anchor_lang::prelude::*;

#[error_code]
pub enum CleatError {
    #[msg("Only the owner can change a mandate. An agent has no write path to one.")]
    NotOwner,
    #[msg("Mandate text is longer than a mandate should be.")]
    TextTooLong,
    #[msg("A cap cannot exceed the whole portfolio.")]
    CapOutOfRange,
    #[msg("A single trade cap above the position cap would let one trade break the position cap.")]
    CapsInconsistent,
    #[msg("Too many denied assets for one mandate.")]
    DenyListFull,
    #[msg("That authority has already expired.")]
    AgentExpired,
    #[msg("An agent grant cannot run longer than thirty days.")]
    AgentTtlTooLong,
    #[msg("This vault has no agent to revoke.")]
    NoAgent,
    #[msg("A mandate cannot be adopted from itself.")]
    SelfAdopt,
    #[msg("No live agent grant. It was never given, or it expired.")]
    AgentNotLive,
    #[msg("This proposal was checked against a mandate version that has since changed.")]
    StaleMandate,
    #[msg("A proposal has to be for some fraction of the portfolio.")]
    EmptyProposal,
    #[msg("The confidential gate aborted rather than returning a verdict.")]
    GateAborted,
    #[msg("A trade has to say which way it goes.")]
    BadSide,
    #[msg("A spending period has to be between an hour and a month.")]
    BadSpendPeriod,
    #[msg("Only the agent the owner named can spend this allowance.")]
    NotTheAgent,
    #[msg("A payment of nothing is not a payment.")]
    EmptyPayment,
    #[msg("The agent's spending ceiling would be breached by this payment.")]
    SpendCapBreached,
    #[msg("The spending allowance has nothing left to pay from.")]
    SpendAccountEmpty,
    #[msg("That sector is not one this mandate can account for.")]
    BadCategory,
    #[msg("The mandate refuses this asset by name.")]
    DeniedAsset,
    #[msg("This sector is already at the position cap, so there is nothing left to clear.")]
    SectorCapBreached,
    #[msg("This trade is larger than the hard ceiling the owner set on the agent.")]
    HardCeilingBreached,
    #[msg("The sealed exposure is not the one this vault published.")]
    ExposureNotBound,
    #[msg("The confidential gate judges entries. An exit goes through propose_trade.")]
    ExitNotGated,
    #[msg("There is less in the vault than that, once rent is left behind.")]
    VaultEmpty,
    #[msg("This log is already on the current layout.")]
    LogAlreadyMigrated,
    #[msg("The owner has halted this mandate. Nothing proposes until they lift it.")]
    Halted,
}
