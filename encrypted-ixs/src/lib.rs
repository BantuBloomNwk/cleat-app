use arcis::*;

/// The gate.
///
/// One secret comparison, one revealed bit, nothing else. The shape is copied
/// deliberately from a circuit already proven on this cluster, which does
/// `let covered = amount <= b.amount;` and returns `covered.reveal()`.
///
/// The previous version revealed a u8 assembled by a nested if/else that mixed a
/// secret condition with a public one, and every computation finalised as a
/// failure with a signed failure envelope and no output bytes. Both of those
/// differences are gone here: a single secret comparison, and a bool out.
///
/// It also reveals strictly less than before. The only thing leaving the
/// computation is whether the position cap would be breached. Whether the trade
/// additionally needed trimming is decided on chain, where the proposal and the
/// caps are already public, so asking the network that question was wasted work
/// and wasted disclosure.
#[encrypted]
mod circuits {
    use arcis::*;

    /// Current exposure to the proposed category, in basis points of the
    /// client's own portfolio. Encrypted end to end and never seen by this
    /// program, the agent, or whoever operates them.
    pub struct Holdings {
        exposure_bps: u16,
    }

    /// True when allowing this would put the category past its cap.
    ///
    /// `effective_bps` arrives already trimmed to the single trade cap, because
    /// that is a comparison between two public numbers and belongs on chain.
    #[instruction]
    pub fn gate_breach_v2(
        holdings: Enc<Shared, Holdings>,
        effective_bps: u16,
        max_position_bps: u16,
    ) -> bool {
        let h = holdings.to_arcis();
        let breaches = (h.exposure_bps + effective_bps) > max_position_bps;
        breaches.reveal()
    }

    // ── The probes ────────────────────────────────────────────────────
    //
    // gate_breach_v2 finalises and comes back a signed failure with no
    // output bytes, every time. Everything around it is known good: the
    // computation reaches the cluster, executes, finalises, and the
    // callback is delivered. What is left is this circuit body, and
    // guessing at it one deploy at a time costs fifteen minutes a guess.
    //
    // So four shapes go up together, each one step further from a circuit
    // shape already proven on this cluster, and whichever is the first to
    // fail is the answer:
    //
    //   a  secret against a constant
    //   b  secret against a plaintext argument
    //   c  secret plus a plaintext argument, against another  (= v2)
    //   d  the same as c at u64 instead of u16
    //
    // The proven circuit compares two u64 secrets, so d separating from c
    // would mean the width, and b separating from a would mean mixing a
    // plaintext argument into the comparison at all.

    /// Secret against a constant. Nothing public enters the comparison.
    #[instruction]
    pub fn probe_a(holdings: Enc<Shared, Holdings>) -> bool {
        let h = holdings.to_arcis();
        let over = h.exposure_bps > 0;
        over.reveal()
    }

    /// Secret against a plaintext argument.
    #[instruction]
    pub fn probe_b(holdings: Enc<Shared, Holdings>, max_position_bps: u16) -> bool {
        let h = holdings.to_arcis();
        let over = h.exposure_bps > max_position_bps;
        over.reveal()
    }
}
