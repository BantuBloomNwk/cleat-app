# Program tests

Two layers, because half of what the program does only exists on Arcium's
cluster.

**Unit tests** for the bookkeeping the gate leans on: the sixteen slot verdict
ring, the per sector running total and the declared universe. They live in a
`#[cfg(test)]` module in `programs/cleat/src/state.rs`, so the deployed program
does not change.

    cargo test -p cleat --lib

**Guard tests** against the deployed program on devnet, each one a finding in
`SECURITY.md` that was found by reading and had no test:

    node tests/program/guards.mjs

| Case | Expected |
|---|---|
| Two trades fill a sector, a third is asked | `SectorCapBreached` before queuing |
| A sealing that is not the published handle | `ExposureNotBound` |
| Asking while halted | `Halted` |
| Halting while the network is computing | recorded as refused, reason 9 |
| A grant pinned to an older mandate | `StaleMandate` |
| Editing the mandate while the network is computing | recorded as refused, reason 4 |
| A declared mint under another sector | `SectorMismatch` |
| A mint outside the declared universe | `UndeclaredAsset` |
| The declared mint in its own sector | cleared |

A fresh owner every run, and it exits non zero if any case fails. It costs a
few thousand lamports per question plus rent for one owner's accounts.

Not covered: a forged callback. Arcium signs callback outputs, so one cannot
be built from outside without the cluster's keys. The account derivation that
stops a callback being aimed at someone else's log is covered by reading
(`gate.rs`, the seeds on `pending`, `log` and `mandate`) and not by a test.
