use arcis::*;

/// The gate.
///
/// The whole product turns on this being small. It takes the client's real
/// holdings, which nobody outside the computation ever sees, and a proposal the
/// agent made in the open, and it returns one of three words. Not the position,
/// not the size, not a percentage anyone could work backwards from. One word.
#[encrypted]
mod circuits {
    use arcis::*;

    /// What the client actually holds, in quote units. Encrypted end to end.
    /// `exposure` is the current value sitting in the category being proposed;
    /// `total` is the whole book, needed to turn a cap in basis points into a
    /// number this circuit can compare against.
    pub struct Holdings {
        exposure: u32,
        total: u32,
    }

    /// 0 cleared, 1 clamped to the single trade cap, 2 refused.
    ///
    /// Returned in the clear on purpose. A verdict is the one thing this design
    /// wants public, because a refusal is the product working and it has to be
    /// showable to somebody without handing them the book.
    ///
    /// Note what is deliberately NOT returned: any clamped size is the mandate's
    /// own trade cap, which is already public on chain, so the caller learns
    /// nothing new. Returning remaining headroom instead would have been more
    /// useful and would have leaked the exposure exactly, since headroom and the
    /// cap together give you the position.
    #[instruction]
    pub fn gate_trade(
        holdings: Enc<Shared, Holdings>,
        proposed_bps: u16,
        max_position_bps: u16,
        max_trade_bps: u16,
    ) -> u8 {
        let h = holdings.to_arcis();

        // Trimming to the single trade cap is a comparison between two public
        // numbers, so it costs nothing and happens first.
        let clamped = proposed_bps > max_trade_bps;
        let effective_bps = if clamped { max_trade_bps } else { proposed_bps };

        // One secret comparison, and no division anywhere.
        //
        // The obvious form of this test divides twice:
        //   exposure + total * effective / 10000  >  total * cap / 10000
        // Division on secret values is the expensive operation in MPC, and both
        // divisions are by the same constant, so multiplying through by 10000
        // removes them and leaves an identical comparison. That one change took
        // the circuit from 516,550,996 ACUs to the figure in the build output.
        let requested = (h.exposure as u64) * 10_000 + (h.total as u64) * (effective_bps as u64);
        let allowance = (h.total as u64) * (max_position_bps as u64);
        let breaches = requested > allowance;

        let outcome = if breaches {
            2u8
        } else if clamped {
            1u8
        } else {
            0u8
        };

        outcome.reveal()
    }
}
