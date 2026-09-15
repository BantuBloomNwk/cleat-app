use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// ID, ID_CONST and ArciumSignerAccount are crate root items: declare_id! and the
// arcium_program macro both expand in lib.rs, and the account macros below
// reference them unqualified.
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::{ArciumSignerAccount, ID, ID_CONST};

use crate::constants::*;
use crate::error::CleatError;
use crate::state::{Mandate, Pending, Vault, Verdict, VerdictLog};

pub const COMP_DEF_OFFSET_GATE_BREACH: u32 = comp_def_offset("gate_breach_v7");

#[init_computation_definition_accounts("gate_breach_v7", payer)]
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
#[queue_computation_accounts("gate_breach_v7", payer)]
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_GATE_BREACH))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    /// Where this particular question waits for its answer.
    ///
    /// Seeded by the computation, not by the owner, so two proposals in flight
    /// cannot land in the same slot and a callback cannot be aimed at a log it
    /// has nothing to do with. Closed when the answer arrives.
    #[account(
        init,
        payer = payer,
        space = 8 + Pending::INIT_SPACE,
        seeds = [PENDING_SEED, computation_account.key().as_ref()],
        bump,
    )]
    pub pending: Box<Account<'info, Pending>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("gate_breach_v7")]
#[derive(Accounts)]
pub struct GateBreachV7Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_GATE_BREACH))]
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
    /// The question this is the answer to.
    ///
    /// Everything below is derived from what is written here rather than from
    /// what the caller passed, which is the only reason the accounts on a
    /// callback can be trusted at all. Arcium validates that a genuine
    /// `callback_computation` immediately precedes this instruction and does
    /// not look at the accounts that follow it, so an unconstrained account on
    /// a callback is an account any stranger may choose.
    #[account(
        mut,
        seeds = [PENDING_SEED, computation_account.key().as_ref()],
        bump = pending.bump,
    )]
    pub pending: Box<Account<'info, Pending>>,

    /// The log the verdict lands in, pinned to the owner who asked.
    #[account(mut, seeds = [VERDICT_SEED, pending.owner.as_ref()], bump = log.bump)]
    pub log: Box<Account<'info, VerdictLog>>,

    /// Read again on the way out, because the network takes seconds to answer
    /// and the owner can edit their mandate inside that window. An answer
    /// computed against a sentence that is no longer in force is recorded as a
    /// refusal rather than applied.
    #[account(seeds = [MANDATE_SEED, pending.owner.as_ref()], bump = mandate.bump)]
    pub mandate: Box<Account<'info, Mandate>>,

    /// CHECK: rent destination, pinned to whoever paid for the pending account.
    #[account(mut, address = pending.payer)]
    pub payer: UncheckedAccount<'info>,
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

#[allow(clippy::too_many_arguments)]
pub fn exec_gate_trade(
    ctx: Context<GateTrade>,
    computation_offset: u64,
    exposure_ct: [u8; 32],
    pubkey: [u8; 32],
    nonce: u128,
    category: u8,
    proposed_bps: u16,
    side: u8,
    mint: Pubkey,
) -> Result<()> {
    require!(proposed_bps > 0, CleatError::EmptyProposal);
    require!(
        (category as usize) < CATEGORY_COUNT,
        CleatError::BadCategory
    );
    // The circuit adds the proposed size to the held exposure, which is right
    // for an entry and backwards for an exit. Rather than let an exit be
    // judged as though it were a purchase, the confidential path takes entries
    // only and exits go through propose_trade, where the arithmetic is public
    // and correct. Widening this means a second circuit, not a flag.
    require!(side == 0, CleatError::ExitNotGated);

    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.payer.key();
    let vault = &ctx.accounts.vault;
    if signer != vault.owner {
        require!(vault.agent_is_live(now), CleatError::AgentNotLive);
        require_keys_eq!(signer, vault.agent, CleatError::NotOwner);
    }
    require!(!ctx.accounts.mandate.halted, CleatError::Halted);
    require!(
        vault.mandate_version == ctx.accounts.mandate.version,
        CleatError::StaleMandate
    );

    // The exposure the circuit is asked about has to be the one the owner
    // published, not one the caller made up. Without this the encrypted input
    // was simply an argument, and an agent that wanted a trade cleared could
    // seal a small number to its own key and hand that over instead. The
    // handle moves only under the owner's signature, in set_position_handle.
    require!(
        exposure_ct == vault.position_handle,
        CleatError::ExposureNotBound
    );

    // Things the mandate refuses outright, decided in public because they are
    // public. A deny list is a list of mints on an account anyone can read, so
    // asking the network about one would spend a computation to learn
    // something already on chain.
    require!(
        !ctx.accounts.mandate.denied.contains(&mint),
        CleatError::DeniedAsset
    );

    let mandate = &ctx.accounts.mandate;
    let clamp_to = mandate.max_trade_bps;
    let max_position_bps = mandate.max_position_bps;

    // What is still free in this sector after everything already cleared.
    // The circuit checks the owner's true holding against the same ceiling;
    // this checks what this program has let through. They are two independent
    // bounds on the same number and the tighter one wins, which is the right
    // way round.
    let headroom = ctx.accounts.log.headroom(category, max_position_bps);
    require!(headroom > 0, CleatError::SectorCapBreached);

    // Trimming is a comparison between public numbers, so it happens here
    // rather than inside the computation. Only the trimmed size goes to the
    // network, which is cheaper and says less.
    let mut effective_bps = proposed_bps;
    let mut clamp_reason = 0u8;
    if effective_bps > clamp_to {
        effective_bps = clamp_to;
        clamp_reason = 2;
    }
    if effective_bps > headroom {
        effective_bps = headroom;
        clamp_reason = 7;
    }

    // The other ceiling, in money rather than in percent, because a percentage
    // cap alone misbehaves when the book is small. Nothing here is taken on
    // the agent's word: the size comes from the vault's own deposited total
    // and the cap comes from a field only the owner writes.
    if vault.agent_max_trade > 0 && signer != vault.owner {
        let notional = (vault.deposited as u128)
            .saturating_mul(effective_bps as u128)
            / BPS_DENOM as u128;
        require!(
            notional <= vault.agent_max_trade as u128,
            CleatError::HardCeilingBreached
        );
    }

    {
        let p = &mut ctx.accounts.pending;
        p.owner = vault.owner;
        p.payer = signer;
        p.mandate_version = mandate.version;
        p.category = category;
        p.proposed_bps = proposed_bps;
        p.effective_bps = effective_bps;
        p.clamp_reason = clamp_reason;
        p.side = side;
        p.bump = ctx.bumps.pending;
    }

    let pending_key = ctx.accounts.pending.key();
    let log_key = ctx.accounts.log.key();
    let mandate_key = ctx.accounts.mandate.key();
    let payer_key = signer;

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Argument order has to match the circuit exactly. An Enc<Shared, T>
    // expands to the sender's x25519 key, the nonce, then one entry per field.
    let args = ArgBuilder::new()
        .x25519_pubkey(pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(exposure_ct)
        .plaintext_u64(effective_bps as u64)
        .plaintext_u64(max_position_bps as u64)
        .build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![GateBreachV7Callback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            // Order matters twice over. It has to match the field order on
            // GateBreachV7Callback, and every one of these is constrained
            // there, because the node will pass along whatever is named here
            // and nothing downstream re-derives it for us.
            &[
                CallbackAccount { pubkey: pending_key, is_writable: true },
                CallbackAccount { pubkey: log_key, is_writable: true },
                CallbackAccount { pubkey: mandate_key, is_writable: false },
                CallbackAccount { pubkey: payer_key, is_writable: true },
            ],
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

/// What the gate decided, written down.
///
/// The computation returns one bit. Everything else in the entry comes off the
/// pending account this computation created, which is why the question has to
/// be parked before it is asked.
pub fn exec_gate_callback(
    ctx: Context<GateBreachV7Callback>,
    output: SignedComputationOutputs<GateBreachV7Output>,
) -> Result<()> {
    // verify_output_raw, not verify_output, and the difference is the whole
    // reason every computation came back as an abort.
    //
    // verify_output decodes the payload into O and verifies over a re-serialized
    // copy sized by O::SIZE. This circuit reveals a plaintext u8, so O::SIZE is
    // one byte while the node signed a larger envelope, so the BLS check ran
    // over the wrong bytes and failed every time. The computation itself had
    // succeeded on every attempt: Arcium's CallbackComputation logged success
    // and delivered the output, and only our own verification rejected it.
    //
    // The raw variant verifies against the bytes actually on the wire and hands
    // them back undecoded, which is correct whenever the decoded type is a
    // prefix of the signed output rather than the whole of it.
    let bytes = match output.verify_output_raw(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(b) => b,
        Err(_) => return Err(CleatError::GateAborted.into()),
    };
    // The output is an MXE sealed copy, a caller sealed copy, then the bit. The
    // bool is still the last byte and everything in front of it is ciphertext
    // this program cannot read and has no business reading.
    let breaches = *bytes.last().ok_or(CleatError::GateAborted)? != 0;

    let proposed_bps = ctx.accounts.pending.proposed_bps;
    let effective_bps = ctx.accounts.pending.effective_bps;
    let category = ctx.accounts.pending.category;
    let side = ctx.accounts.pending.side;
    let asked_version = ctx.accounts.pending.mandate_version;
    let clamp_reason = ctx.accounts.pending.clamp_reason;

    // The network takes seconds. An owner who tightened their mandate inside
    // that window should not have an answer computed against the old one
    // applied to them, so a version that has moved is a refusal rather than a
    // silently stale clearance.
    let stale = ctx.accounts.mandate.version != asked_version;

    let (outcome, reason, allowed_bps) = if ctx.accounts.mandate.halted {
        // Thrown while the network was still thinking. The answer arrives and
        // is recorded, and it is recorded as a refusal, because a halt that
        // only applied to proposals not yet sent would leave a window exactly
        // as long as a computation takes.
        (2u8, 9u8, 0u16)
    } else if stale {
        (2u8, 4u8, 0u16)
    } else if breaches {
        (2u8, 1u8, 0u16)
    } else if effective_bps < proposed_bps {
        (1u8, clamp_reason, effective_bps)
    } else {
        (0u8, 0u8, effective_bps)
    };

    let vault_key = ctx.accounts.log.vault;
    {
        let log = &mut ctx.accounts.log;
        log.push(Verdict {
            slot: Clock::get()?.slot,
            mandate_version: asked_version,
            category,
            proposed_bps,
            allowed_bps,
            outcome,
            reason,
        });
        if outcome != 2 {
            log.apply_exposure(category, side, allowed_bps);
        }
    }

    // The question has been answered, so the space it was parked in goes back
    // to whoever paid for it.
    ctx.accounts
        .pending
        .close(ctx.accounts.payer.to_account_info())?;

    emit!(GateDecided {
        vault: vault_key,
        outcome,
        proposed_bps,
        allowed_bps,
    });
    Ok(())
}
