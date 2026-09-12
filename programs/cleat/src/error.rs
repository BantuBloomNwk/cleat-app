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
}
