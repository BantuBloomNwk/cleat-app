//! Four probes that exist only to find out why the gate aborts.
//!
//! They carry no vault, no mandate and no log. Each takes an encrypted
//! number and a couple of public ones, asks the network a slightly
//! different question about them, and its callback writes down whether a
//! signed output came back rather than erroring on it. That last part is
//! the point: a callback that returns Err takes the whole transaction
//! with it and the logs say only that it failed, which is the position we
//! have been in for days. These say what came back.
//!
//! Delete this module once the gate works.

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::{ArciumSignerAccount, ID, ID_CONST};

/// Builds the three account structs and the two handlers a single Arcium
/// circuit needs. Everything here differs only by the circuit's name and
/// the type of its output, so writing it out four times would be four
/// chances to get one of them subtly wrong.
macro_rules! probe {
    (
        $name:literal,
        $offset:ident,
        $init:ident,
        $queue:ident,
        $callback:ident,
        $exec_init:ident,
        $exec_queue:ident,
        $exec_cb:ident,
        $out:ty,
        $args:expr
    ) => {
        pub const $offset: u32 = comp_def_offset($name);

        #[init_computation_definition_accounts($name, payer)]
        #[derive(Accounts)]
        pub struct $init<'info> {
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

        #[queue_computation_accounts($name, payer)]
        #[derive(Accounts)]
        #[instruction(computation_offset: u64)]
        pub struct $queue<'info> {
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
            #[account(address = derive_comp_def_pda!($offset))]
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

        #[callback_accounts($name)]
        #[derive(Accounts)]
        pub struct $callback<'info> {
            pub arcium_program: Program<'info, Arcium>,
            #[account(address = derive_comp_def_pda!($offset))]
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

        pub fn $exec_init(ctx: Context<$init>) -> Result<()> {
            init_computation_def(ctx.accounts, None)?;
            Ok(())
        }

        #[allow(clippy::too_many_arguments)]
        pub fn $exec_queue(
            ctx: Context<$queue>,
            computation_offset: u64,
            exposure_ct: [u8; 32],
            pubkey: [u8; 32],
            nonce: u128,
            a: u64,
            b: u64,
        ) -> Result<()> {
            ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
            let args = $args(pubkey, nonce, exposure_ct, a, b);
            queue_computation(
                ctx.accounts,
                computation_offset,
                args,
                vec![$callback::callback_ix(
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

        /// Never returns Err. The whole reason this module exists is to
        /// read what came back, and an Err would throw it away.
        pub fn $exec_cb(
            ctx: Context<$callback>,
            output: SignedComputationOutputs<$out>,
        ) -> Result<()> {
            match output.verify_output_raw(
                &ctx.accounts.cluster_account,
                &ctx.accounts.computation_account,
            ) {
                Ok(bytes) => msg!(
                    "PROBE {} ok bytes={} first={}",
                    $name,
                    bytes.len(),
                    bytes.first().copied().unwrap_or(255)
                ),
                Err(e) => msg!("PROBE {} rejected: {:?}", $name, e),
            }
            Ok(())
        }
    };
}

probe!(
    "probe_a", COMP_DEF_OFFSET_PROBE_A,
    InitProbeACompDef, ProbeAQueue, ProbeACallback,
    exec_init_probe_a, exec_queue_probe_a, exec_probe_a_callback,
    ProbeAOutput,
    |pubkey, nonce, ct, _a: u64, _b: u64| ArgBuilder::new()
        .x25519_pubkey(pubkey)
        .plaintext_u128(nonce)
        .encrypted_u16(ct)
        .build()
);

probe!(
    "probe_b", COMP_DEF_OFFSET_PROBE_B,
    InitProbeBCompDef, ProbeBQueue, ProbeBCallback,
    exec_init_probe_b, exec_queue_probe_b, exec_probe_b_callback,
    ProbeBOutput,
    |pubkey, nonce, ct, a: u64, _b: u64| ArgBuilder::new()
        .x25519_pubkey(pubkey)
        .plaintext_u128(nonce)
        .encrypted_u16(ct)
        .plaintext_u16(a as u16)
        .build()
);
