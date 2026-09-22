use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{AssetUniverse, Mandate, Treasury, Vault, Verdict, VerdictLog};

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct OpenVerdictLog<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, owner.key().as_ref(), &index_seed(index)],
        bump = vault.bump,
        has_one = owner @ CleatError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        space = 8 + VerdictLog::INIT_SPACE,
        seeds = [VERDICT_SEED, owner.key().as_ref(), &index_seed(index)],
        bump
    )]
    pub log: Account<'info, VerdictLog>,
    pub system_program: Program<'info, System>,
}

pub fn exec_open_verdict_log(ctx: Context<OpenVerdictLog>, _index: u16) -> Result<()> {
    let l = &mut ctx.accounts.log;
    l.owner = ctx.accounts.owner.key();
    l.vault = ctx.accounts.vault.key();
    l.head = 0;
    l.cleared = 0;
    l.clamped = 0;
    l.refused = 0;
    l.entries = Vec::new();
    l.exposure_bps = [0u16; CATEGORY_COUNT];
    l.bump = ctx.bumps.log;
    Ok(())
}

#[event]
pub struct ProposalDecided {
    /// What this clearance cost, in lamports. Zero on every refusal.
    pub fee: u64,
    pub vault: Pubkey,
    pub mandate_version: u16,
    pub category: u8,
    pub proposed_bps: u16,
    pub allowed_bps: u16,
    pub outcome: u8,
    pub reason: u8,
}

/// The agent asks. The mandate answers. Neither the agent nor whoever runs it
/// gets to write the answer.
///
/// The verdict is computed here from the mandate's own caps rather than passed
/// in, which is the difference between a policy and a log of claims. An agent
/// that has been talked into asking for forty percent of the book still only
/// gets whatever the sentence its owner wrote allows, and the attempt is
/// recorded either way.
///
/// `reason` 5 exists for the case that motivated the whole product: the caller
/// can flag that the proposal originated in content the agent ingested rather
/// than in its own reasoning. It changes nothing about enforcement, because
/// enforcement never trusted the agent in the first place. It is there so the
/// record says what happened.
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct ProposeTrade<'info> {
    /// The granted agent, or the owner acting on their own behalf.
    pub signer: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), &index_seed(index)],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        seeds = [MANDATE_SEED, vault.owner.as_ref(), &index_seed(index)],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(
        mut,
        seeds = [VERDICT_SEED, vault.owner.as_ref(), &index_seed(index)],
        bump = log.bump
    )]
    pub log: Account<'info, VerdictLog>,

    /// The instruments this mandate declared, if it declared any.
    ///
    /// Unchecked because it is allowed not to exist: every mandate written
    /// before universes did is judged the old way rather than bricked. The
    /// address is still derived from the mandate, so an agent cannot hand over
    /// a friendlier list, and the contents are deserialised in the handler
    /// where the absence can be distinguished from the emptiness.
    /// CHECK: address constrained by seeds, contents validated in the handler.
    #[account(seeds = [UNIVERSE_SEED, mandate.key().as_ref()], bump)]
    pub universe: UncheckedAccount<'info>,
    /// Where the fee on a clearance goes. No authority over anything, and
    /// nothing in this program moves value out of it toward a vault, an
    /// agent or an owner.
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
}

#[allow(clippy::too_many_arguments)]
pub fn exec_propose_trade(
    ctx: Context<ProposeTrade>,
    _index: u16,
    category: u8,
    proposed_bps: u16,
    from_ingested_content: bool,
    side: u8,
    observed_spread_bps: u16,
    mint: Pubkey,
) -> Result<()> {
    // side is 0 to add to a position and 1 to reduce one, and it matters
    // because the harm is not symmetric in the way a size cap assumes. A
    // cap on how much may be bought is also a cap on how much may be sold
    // at once, which is right at three in the morning in a thin book and
    // wrong when the owner is trying to get out. So an exit runs to the
    // position cap rather than the trade cap, and stays bound by everything
    // else.
    //
    // observed_spread_bps is how wide the book is where this would land.
    // It is public information the agent reads off the venue, so passing it
    // in the clear costs no privacy. It is also the agent's own
    // measurement, and the agent could lie about it, which is worth being
    // plain about: this bounds an honest agent that would otherwise trade
    // into an illiquid book, and it is not a defence against a hostile one.
    // What defends against a hostile agent is the size caps, which it
    // cannot influence at all.
    require!(proposed_bps > 0, CleatError::EmptyProposal);
    require!(side <= 1, CleatError::BadSide);
    require!(
        (category as usize) < CATEGORY_COUNT,
        CleatError::BadCategory
    );

    let vault = &ctx.accounts.vault;
    let mandate = &ctx.accounts.mandate;
    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.signer.key();

    // Either the owner, or an agent whose grant is still live. An expired grant
    // is not a soft warning, it simply cannot get past here.
    if signer != vault.owner {
        require!(vault.agent_is_live(now), CleatError::AgentNotLive);
        require_keys_eq!(signer, vault.agent, CleatError::NotOwner);
    }

    // A grant is pinned to the mandate as it read when it was issued. If the
    // owner has edited the mandate since, the agent is working from an older
    // sentence and does not get to act on it.
    let mut outcome: u8;
    let mut reason: u8;
    let mut allowed_bps: u16;

    // What is still free in this sector, counting everything already cleared.
    //
    // Without this the position cap was not a position cap. Every proposal was
    // judged on its own size against the ceiling, so ten cleared trades at four
    // percent each sat at forty percent under a mandate that says fifteen, and
    // every one of them was recorded as cleared. Exits are not bounded by it,
    // because reducing a position cannot break a ceiling on how large one may
    // be.
    let headroom = ctx.accounts.log.headroom(category, mandate.max_position_bps);

    // What the owner said this instrument is, if they said anything.
    //
    // `declared` is None when the mandate predates declared universes, and the
    // old behaviour applies. Otherwise it answers two questions the agent used
    // to answer for itself: whether this instrument is in scope at all, and
    // which sector it counts against. An agent cannot reach a friendlier answer
    // by passing a different account, because the address is derived from the
    // mandate it is already bound to.
    let declared: Option<Option<u8>> = {
        let info = ctx.accounts.universe.to_account_info();
        if info.data_is_empty() {
            None
        } else {
            let data = info.try_borrow_data()?;
            let u = AssetUniverse::try_deserialize(&mut &data[..])?;
            require_keys_eq!(u.mandate, mandate.key(), CleatError::NotOwner);
            Some(u.category_of(&mint))
        }
    };

    if mandate.halted {
        // First, and above everything. A halted mandate refuses an exit as
        // readily as an entry, because the owner who threw the switch did not
        // ask for a judgement call about which trades were probably fine.
        outcome = 2;
        reason = 9;
        allowed_bps = 0;
    } else if vault.mandate_version != mandate.version {
        outcome = 2;
        reason = 4;
        allowed_bps = 0;
    } else if declared == Some(None) {
        // The owner never said this instrument exists for this mandate. Refused
        // without reaching a size check, because an undeclared name is not a
        // sizing question. This is the hole the deny list left: a list of what
        // is forbidden says nothing at all about everything else.
        outcome = 2;
        reason = 10;
        allowed_bps = 0;
    } else if matches!(declared, Some(Some(c)) if c != category) {
        // The instrument is declared, and the agent called it something else.
        // Sector caps are only caps if the sector cannot be chosen by the party
        // the cap is aimed at.
        outcome = 2;
        reason = 11;
        allowed_bps = 0;
    } else if side == 0 && mandate.denied.contains(&mint) {
        // The English clause resolved into a list of mints, and this is one of
        // them. Size never enters into it.
        outcome = 2;
        reason = 3;
        allowed_bps = 0;
    } else if proposed_bps > mandate.max_position_bps {
        // Past the position cap entirely. Refuse rather than trim, because a
        // request this far out is not a sizing error.
        outcome = 2;
        reason = 1;
        allowed_bps = 0;
    } else if side == 0 && headroom == 0 {
        // The sector is full. Nothing to trim to.
        outcome = 2;
        reason = 7;
        allowed_bps = 0;
    } else if side == 0 && proposed_bps > mandate.max_trade_bps {
        // Inside the position cap but larger than one trade may be, so trim it
        // to what a single trade is allowed to move. Entries only: getting
        // out of something should not be rationed by the cap that governs
        // getting into it.
        outcome = 1;
        reason = 2;
        allowed_bps = mandate.max_trade_bps.min(headroom);
    } else if side == 0 && proposed_bps > headroom {
        // Small enough on its own, too large for what is left in the sector.
        outcome = 1;
        reason = 7;
        allowed_bps = headroom;
    } else {
        outcome = 0;
        reason = 0;
        allowed_bps = proposed_bps;
    }

    // The book, which is the other way to lose money in a trade that passed
    // every size check. Applied to both directions, because a thin book
    // punishes an exit exactly as hard as an entry, and an owner who has
    // asked not to trade into one did not mean only when buying.
    if mandate.max_spread_bps > 0
        && observed_spread_bps > mandate.max_spread_bps
        && outcome != 2
    {
        outcome = 2;
        reason = 6;
        allowed_bps = 0;
    }

    // Anything that arrived through content the agent read is refused outright,
    // whatever its size. The size was never the problem.
    if from_ingested_content && outcome != 2 {
        outcome = 2;
        reason = 5;
        allowed_bps = 0;
    }

    // The second ceiling, in money rather than in percent, because a percentage
    // cap alone misbehaves when the book is small. The owner sets it in
    // set_agent and it binds nobody else. Nothing here is taken on the agent's
    // word: the size is computed from the vault's own declared book.
    //
    // Entries only, for the same reason the single trade cap is entries only. A
    // ceiling on how much may be bought at once is protection. The same ceiling
    // applied to a sale is a rule that says the larger the position, the harder
    // it is to leave, and that is the wrong way round at three in the morning.
    //
    // Last of the checks, so it can only refuse something that was otherwise
    // going to go through. A trade already refused for its size, its book or
    // where the instruction came from keeps the reason it was refused for,
    // because that is the reason worth reading.
    if vault.agent_max_trade > 0 && signer != vault.owner && side == 0 && outcome != 2 {
        let notional = (vault.deposited as u128).saturating_mul(allowed_bps as u128)
            / BPS_DENOM as u128;
        if notional > vault.agent_max_trade as u128 {
            outcome = 2;
            reason = 8;
            allowed_bps = 0;
        }
    }

    // The fee, and the only place one is taken.
    //
    // Charged on what cleared, never on what was refused, and moved out of
    // the vault the owner funded rather than billed separately. A refusal
    // costs nothing, so nobody is ever paid for an agent being stopped, and
    // there is no arrangement under which letting something through pays
    // better than refusing it.
    let mut fee = 0u64;
    if outcome != 2 && vault.deposited > 0 {
        let notional = (vault.deposited as u128).saturating_mul(allowed_bps as u128)
            / BPS_DENOM as u128;
        let raw = notional.saturating_mul(PROTOCOL_FEE_BPS as u128) / BPS_DENOM as u128;
        fee = (raw as u64).min(PROTOCOL_FEE_CAP);

        let vault_info = ctx.accounts.vault.to_account_info();
        let floor = Rent::get()?.minimum_balance(vault_info.data_len());
        if fee > 0 && vault_info.lamports().saturating_sub(floor) >= fee {
            **vault_info.try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += fee;
            let t = &mut ctx.accounts.treasury;
            t.collected = t.collected.saturating_add(fee);
            t.clearances = t.clearances.saturating_add(1);
        } else {
            // Not enough to pay it. The verdict still stands, because a
            // boundary that stops working when the fee cannot be collected
            // would be a boundary that money can switch off.
            fee = 0;
        }
    }

    let v = Verdict {
        slot: Clock::get()?.slot,
        mandate_version: mandate.version,
        category,
        proposed_bps,
        allowed_bps,
        outcome,
        reason,
    };
    ctx.accounts.log.push(v);
    if outcome != 2 {
        ctx.accounts.log.apply_exposure(category, side, allowed_bps);
    }

    emit!(ProposalDecided {
        fee,
        vault: vault.key(),
        mandate_version: mandate.version,
        category,
        proposed_bps,
        allowed_bps,
        outcome,
        reason,
    });
    Ok(())
}

/// Move an existing log onto the layout that tracks running exposure.
///
/// The log used to carry four fields holding whatever question was in flight,
/// and those are gone. A callback can be aimed at any log it likes unless the
/// context comes from an account seeded by the computation itself, and one
/// shared slot could not hold two questions at once anyway. What replaces them
/// is a per sector running total, which is what turns the position cap into an
/// actual position cap rather than a cap on one trade at a time.
///
/// Where the tail of the account sits depends on how many verdicts are in it,
/// so it is computed rather than assumed, and nothing before the entries moves.
/// Every recorded verdict and every lifetime total survives this untouched.
///
/// The owner signs, and only the owner. Running it again zeroes that owner's
/// own sector totals, which is worth stating plainly: it is a thing an owner
/// can do to their own accounting, the same way they can raise a cap by editing
/// their own mandate. It is not a thing an agent can do, because an agent
/// cannot sign this.
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct MigrateVerdictLog<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: read as raw bytes on purpose. A log written by an older program
    /// does not deserialize into the current struct, which is the whole reason
    /// this instruction exists. The seeds pin it to the signer's own log.
    #[account(mut, seeds = [VERDICT_SEED, owner.key().as_ref(), &index_seed(index)], bump)]
    pub log: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn exec_migrate_verdict_log(ctx: Context<MigrateVerdictLog>, _index: u16) -> Result<()> {
    // discriminator, owner, vault, head, cleared, clamped, refused
    const PREFIX: usize = 8 + 32 + 32 + 1 + 4 + 4 + 4;
    const ENTRY: usize = 8 + 2 + 1 + 2 + 2 + 1 + 1;

    let info = ctx.accounts.log.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, CleatError::NotOwner);

    // The oldest logs were allocated before the sector totals existed and are
    // twelve bytes short of holding a full ring of sixteen verdicts alongside
    // them. Nothing goes wrong until the sixteenth lands, which is exactly the
    // sort of thing that goes wrong during a demo, so the space is taken now
    // and the owner tops up the rent that keeps it exempt.
    let target = 8 + VerdictLog::INIT_SPACE;
    if info.data_len() < target {
        let short = Rent::get()?
            .minimum_balance(target)
            .saturating_sub(info.lamports());
        if short > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: info.clone(),
                    },
                ),
                short,
            )?;
        }
        info.resize(target)?;
    }

    let mut data = info.try_borrow_mut_data()?;
    require!(
        data.len() > PREFIX + 4 && data[..8] == *VerdictLog::DISCRIMINATOR,
        CleatError::LogAlreadyMigrated
    );
    // Owner is the first field after the discriminator, so a log that belongs
    // to somebody else cannot be reached even if the seeds were somehow
    // satisfied by a different account.
    require!(
        data[8..40] == ctx.accounts.owner.key().to_bytes(),
        CleatError::NotOwner
    );

    let count = u32::from_le_bytes(
        data[PREFIX..PREFIX + 4]
            .try_into()
            .map_err(|_| error!(CleatError::LogAlreadyMigrated))?,
    ) as usize;
    require!(count <= VERDICT_CAPACITY, CleatError::LogAlreadyMigrated);

    let tail = PREFIX + 4 + count * ENTRY;
    let need = CATEGORY_COUNT * 2 + 1;
    require!(tail + need <= data.len(), CleatError::LogAlreadyMigrated);

    // Everything cleared before this point went unaccounted for, so the sectors
    // start empty. That is the generous reading and it is also the honest one:
    // the program has no record of which of those trades were entries and which
    // were exits, and inventing a total would be worse than starting at zero.
    for b in data[tail..tail + CATEGORY_COUNT * 2].iter_mut() {
        *b = 0;
    }
    data[tail + CATEGORY_COUNT * 2] = ctx.bumps.log;
    Ok(())
}


/// Create the treasury, once, by anybody.
///
/// Opening it is not a privileged act: it holds fees and grants nothing. It
/// has to exist before the first clearance can pay one, and it has to carry
/// data so the runtime does not collect it for being a rent poor account
/// with nothing in it.
#[derive(Accounts)]
pub struct OpenTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: Account<'info, Treasury>,
    pub system_program: Program<'info, System>,
}

pub fn exec_open_treasury(ctx: Context<OpenTreasury>) -> Result<()> {
    let t = &mut ctx.accounts.treasury;
    t.collected = 0;
    t.clearances = 0;
    t.bump = ctx.bumps.treasury;
    Ok(())
}
