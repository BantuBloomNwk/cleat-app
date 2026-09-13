use arcis::*;

/// The gate.
///
/// One secret comparison, one revealed bit, and the shape copied from a
/// circuit that is proven on this exact cluster rather than one that looked
/// reasonable.
///
/// Two earlier versions aborted. Both took the holdings as a struct with a
/// single u16 field, `Enc<Shared, Holdings>`, and both came back as a signed
/// failure with no output bytes. A probe cut down to the smallest possible
/// circuit, decrypt one u16 and compare it to a constant, aborted the same
/// way in two seconds, which ruled out everything that had been suspected
/// until then: the arithmetic, the public argument, the mixing of the two,
/// the cost, the cluster's willingness to do secret comparisons at all.
///
/// What it left was the encrypted input itself. Ilowa's shielded_stake_v2
/// runs on this same cluster and does the same two things this needs, a
/// secret comparison and a revealed bool, and it differs in exactly two
/// ways: it takes `Enc<Shared, u64>` rather than a u16, and it takes the
/// value bare rather than wrapped in a struct. So this takes it bare, at
/// u64, and the basis points are widened on the way in.
///
/// The widening costs nothing worth having. Basis points fit in a u16 and
/// that is why it was one, but the only thing that buys is a smaller
/// ciphertext in a circuit whose cost is dominated by the comparison.
#[encrypted]
mod circuits {
    use arcis::*;

    /// True when allowing this would put the category past its cap.
    ///
    /// `effective_bps` arrives already trimmed to the single trade cap,
    /// because that is a comparison between two public numbers and belongs
    /// on chain rather than in an MPC round.
    ///
    /// Nothing about the holding leaves here. The caller learns one bit,
    /// whether the cap would break, and the size of the position that
    /// decided it is never revealed to anyone, including this program and
    /// whoever runs the agent.
    #[instruction]
    pub fn gate_breach_v4(
        exposure_bps: Enc<Shared, u64>,
        effective_bps: u64,
        max_position_bps: u64,
    ) -> (Enc<Shared, u64>, bool) {
        let held = exposure_bps.to_arcis();
        let next = held + effective_bps;
        let breaches = next > max_position_bps;

        // The exposure the client would be left holding, sealed straight
        // back to their own key. A refused trade leaves it where it was.
        //
        // This exists for two reasons and the smaller one is the useful
        // one: the caller gets their position back updated without ever
        // having decrypted it. The larger one is that the previous version
        // returned a bare bool, never touched the caller's key, and the
        // compiler said so: "the value of input exposure_bps.owner.public_key
        // is unused or could be optimized out". The program passes that key
        // as an argument on every call. A circuit that has optimized it
        // away is not the circuit the program is calling.
        let updated = if breaches { held } else { next };
        (exposure_bps.owner.from_arcis(updated), breaches.reveal())
    }
}
