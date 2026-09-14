//! A pipe for putting a locally listed equity on chain.
//!
//! Every tokenized equity live on Solana today is an American name, and no
//! tokenized blue chip or index exists on any chain for any emerging
//! market. Not the Nikkei, the Hang Seng, the STI or the KLCI. Not the JSE,
//! the NGX, the EGX or Tadawul. Not the ASX or the NZX. That is a gap
//! rather than a law, and this is the smallest honest thing that closes it.
//!
//! ## The shape, and why this one
//!
//! Every issuer doing this does the same thing underneath. A licensed
//! entity holds the real shares, something attests that they are held, and
//! a token is minted against that attestation. Ondo's version is the one
//! worth copying for a single detail: **the attestation signer is a
//! configurable address rather than the program's own authority.** Swap the
//! signer and the same pipe serves a different exchange in a different
//! country under a different licence.
//!
//! That separation is what lets the software exist before the licence does.
//! The mechanism here is complete; the only open question is whose key sits
//! in `attestor`, and that is a commercial question rather than a technical
//! one.
//!
//! ## What this deliberately does not do
//!
//! It does not custody anything, it does not price anything, and it does
//! not claim the token is a security or is not one. It records that a named
//! attestor asserted a quantity of a named listing is held, and it lets
//! that assertion be revoked. Everything about what the token then *is* is
//! decided by the entity whose key signed, which is the only party in a
//! position to decide it.
//!
//! Cleat's mandate enforcement does not care which listing a position is
//! in, so the day a Bursa or an NGX name exists here, the same sentence a
//! client already wrote governs it with no change.

use anchor_lang::prelude::*;

declare_id!("37ueS3JcgaPyhAjW3Aj43dytLWq66UZHQ3Z4KEz6jrGg");

#[program]
pub mod listing {
    use super::*;

    /// Register a venue whose equities may be tokenized, and name the key
    /// that is allowed to attest for it.
    ///
    /// The registrar is whoever runs this deployment. The attestor should
    /// not be: it is the licensed party that actually holds shares, and
    /// keeping the two separate is the whole point of the design.
    pub fn open_venue(
        ctx: Context<OpenVenue>,
        code: [u8; 8],
        name: String,
        jurisdiction: [u8; 2],
        attestor: Pubkey,
    ) -> Result<()> {
        require!(name.len() <= VENUE_NAME_MAX, ListingError::NameTooLong);
        let v = &mut ctx.accounts.venue;
        v.registrar = ctx.accounts.registrar.key();
        v.code = code;
        v.name = name;
        v.jurisdiction = jurisdiction;
        v.attestor = attestor;
        v.listings = 0;
        v.paused = false;
        v.bump = ctx.bumps.venue;
        Ok(())
    }

    /// Point a venue at a different attestor.
    ///
    /// Needed because a licensing relationship ends, and when it does the
    /// pipe should be repointable rather than abandoned. It does not touch
    /// anything already attested, which stays valid until revoked by
    /// whoever signed it.
    pub fn set_attestor(ctx: Context<AdminVenue>, attestor: Pubkey) -> Result<()> {
        ctx.accounts.venue.attestor = attestor;
        Ok(())
    }

    /// Stop a venue accepting new attestations. Existing ones are untouched.
    pub fn set_paused(ctx: Context<AdminVenue>, paused: bool) -> Result<()> {
        ctx.accounts.venue.paused = paused;
        Ok(())
    }

    /// Describe one instrument on a venue.
    ///
    /// The identifiers are the boring part and the important part. A ticker
    /// is ambiguous across exchanges, an ISIN is not, and a pipe that
    /// cannot say exactly which security it means is not infrastructure.
    pub fn list_instrument(
        ctx: Context<ListInstrument>,
        symbol: String,
        isin: [u8; 12],
        lot_size: u64,
        decimals: u8,
    ) -> Result<()> {
        require!(symbol.len() <= SYMBOL_MAX, ListingError::NameTooLong);
        require!(lot_size > 0, ListingError::BadLot);
        require!(decimals <= 9, ListingError::BadDecimals);

        let venue = &mut ctx.accounts.venue;
        require!(!venue.paused, ListingError::VenuePaused);

        let l = &mut ctx.accounts.instrument;
        l.venue = venue.key();
        l.symbol = symbol;
        l.isin = isin;
        l.lot_size = lot_size;
        l.decimals = decimals;
        l.attested_units = 0;
        l.bump = ctx.bumps.instrument;

        venue.listings = venue.listings.saturating_add(1);
        Ok(())
    }

    /// The attestor says a quantity is held.
    ///
    /// This is the only instruction that can increase supply, and the only
    /// signer it accepts is the venue's attestor. Not the registrar, not
    /// the program's upgrade authority, not whoever paid the fee. If the
    /// licensed party's key is not on the transaction, nothing is created.
    pub fn attest_holding(ctx: Context<Attest>, units: u64, reference: [u8; 32]) -> Result<()> {
        require!(units > 0, ListingError::EmptyAttestation);
        let venue = &ctx.accounts.venue;
        require!(!venue.paused, ListingError::VenuePaused);
        require_keys_eq!(
            ctx.accounts.attestor.key(),
            venue.attestor,
            ListingError::NotTheAttestor
        );

        let l = &mut ctx.accounts.instrument;
        require!(
            units % l.lot_size == 0,
            ListingError::NotAWholeLot
        );
        l.attested_units = l
            .attested_units
            .checked_add(units)
            .ok_or(ListingError::SupplyOverflow)?;

        emit!(HoldingAttested {
            venue: venue.key(),
            instrument: l.key(),
            units,
            total: l.attested_units,
            reference,
        });
        Ok(())
    }

    /// The attestor withdraws an assertion, because shares were sold,
    /// redeemed, or should never have been attested.
    ///
    /// Supply that cannot be withdrawn is a claim nobody can honour, so
    /// this exists from the first version rather than being added once
    /// something goes wrong.
    pub fn revoke_holding(ctx: Context<Attest>, units: u64, reference: [u8; 32]) -> Result<()> {
        require!(units > 0, ListingError::EmptyAttestation);
        require_keys_eq!(
            ctx.accounts.attestor.key(),
            ctx.accounts.venue.attestor,
            ListingError::NotTheAttestor
        );

        let l = &mut ctx.accounts.instrument;
        l.attested_units = l
            .attested_units
            .checked_sub(units)
            .ok_or(ListingError::MoreThanAttested)?;

        emit!(HoldingRevoked {
            instrument: l.key(),
            units,
            total: l.attested_units,
            reference,
        });
        Ok(())
    }
}

pub const VENUE_NAME_MAX: usize = 48;
pub const SYMBOL_MAX: usize = 16;

/// An exchange, and who may speak for it here.
#[account]
#[derive(InitSpace)]
pub struct Venue {
    pub registrar: Pubkey,
    /// A short code, "XNGX", "XKLS", "XSES", "XASX", "XNZE", "XJSE", "XTAD".
    pub code: [u8; 8],
    #[max_len(VENUE_NAME_MAX)]
    pub name: String,
    /// ISO 3166 alpha 2, so the jurisdiction is on the account rather than
    /// implied by the name.
    pub jurisdiction: [u8; 2],
    /// The licensed party whose signature creates supply. Deliberately not
    /// the registrar.
    pub attestor: Pubkey,
    pub listings: u32,
    pub paused: bool,
    pub bump: u8,
}

/// One security on one venue.
#[account]
#[derive(InitSpace)]
pub struct Instrument {
    pub venue: Pubkey,
    #[max_len(SYMBOL_MAX)]
    pub symbol: String,
    /// The identifier that is actually unambiguous across exchanges.
    pub isin: [u8; 12],
    /// The smallest quantity the venue will trade. A pipe that lets someone
    /// attest a third of a lot is describing something the market cannot
    /// settle.
    pub lot_size: u64,
    pub decimals: u8,
    pub attested_units: u64,
    pub bump: u8,
}

#[event]
pub struct HoldingAttested {
    pub venue: Pubkey,
    pub instrument: Pubkey,
    pub units: u64,
    pub total: u64,
    /// Whatever the attestor uses to find this in their own records. A
    /// custody reference, a settlement id. Opaque here on purpose.
    pub reference: [u8; 32],
}

#[event]
pub struct HoldingRevoked {
    pub instrument: Pubkey,
    pub units: u64,
    pub total: u64,
    pub reference: [u8; 32],
}

#[derive(Accounts)]
#[instruction(code: [u8; 8])]
pub struct OpenVenue<'info> {
    #[account(mut)]
    pub registrar: Signer<'info>,
    #[account(
        init,
        payer = registrar,
        space = 8 + Venue::INIT_SPACE,
        seeds = [b"venue", code.as_ref()],
        bump,
    )]
    pub venue: Account<'info, Venue>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminVenue<'info> {
    pub registrar: Signer<'info>,
    #[account(
        mut,
        seeds = [b"venue", venue.code.as_ref()],
        bump = venue.bump,
        has_one = registrar @ ListingError::NotTheRegistrar,
    )]
    pub venue: Account<'info, Venue>,
}

#[derive(Accounts)]
#[instruction(symbol: String, isin: [u8; 12])]
pub struct ListInstrument<'info> {
    #[account(mut)]
    pub registrar: Signer<'info>,
    #[account(
        mut,
        seeds = [b"venue", venue.code.as_ref()],
        bump = venue.bump,
        has_one = registrar @ ListingError::NotTheRegistrar,
    )]
    pub venue: Account<'info, Venue>,
    #[account(
        init,
        payer = registrar,
        space = 8 + Instrument::INIT_SPACE,
        seeds = [b"instrument", venue.key().as_ref(), isin.as_ref()],
        bump,
    )]
    pub instrument: Account<'info, Instrument>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Attest<'info> {
    /// The licensed party. The only signature that moves supply.
    pub attestor: Signer<'info>,
    #[account(
        seeds = [b"venue", venue.code.as_ref()],
        bump = venue.bump,
    )]
    pub venue: Account<'info, Venue>,
    #[account(
        mut,
        seeds = [b"instrument", venue.key().as_ref(), instrument.isin.as_ref()],
        bump = instrument.bump,
        constraint = instrument.venue == venue.key() @ ListingError::WrongVenue,
    )]
    pub instrument: Account<'info, Instrument>,
}

#[error_code]
pub enum ListingError {
    #[msg("That name is longer than the account can hold.")]
    NameTooLong,
    #[msg("A lot size has to be at least one.")]
    BadLot,
    #[msg("Nine decimals is the most this will carry.")]
    BadDecimals,
    #[msg("Only the registrar of this venue can do that.")]
    NotTheRegistrar,
    #[msg("Only the attestor this venue names can create or withdraw supply.")]
    NotTheAttestor,
    #[msg("This venue is not accepting attestations right now.")]
    VenuePaused,
    #[msg("An attestation of nothing is not an attestation.")]
    EmptyAttestation,
    #[msg("That quantity is not a whole number of lots.")]
    NotAWholeLot,
    #[msg("That is more than has been attested.")]
    MoreThanAttested,
    #[msg("That instrument belongs to a different venue.")]
    WrongVenue,
    #[msg("Attested supply would overflow.")]
    SupplyOverflow,
}
