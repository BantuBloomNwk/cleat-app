# Toolchain, pinned on purpose

Versions here are exact, not caret ranges. A one week build cannot absorb a
dependency moving under it, and the failure this prevents already happened once
in this repo: `anchor-lang` resolved to 1.2.0 from a `"1.0.2"` caret while the
installed `anchor-cli` was still 1.0.2. The CLI is what runs the SBF build and
derives IDL discriminators, so a CLI and a library on different minor versions
is how an IDL stops matching the deployed program.

| Piece | Pinned | Why this one |
|---|---|---|
| `anchor-cli` | 1.2.0 | latest, and now equal to the library version |
| `anchor-lang` | `=1.2.0` | exact, so it cannot drift ahead of the CLI again |
| `solana-cli` | 3.1.10 | already installed and matches the sbpf toolchain |
| rust (host) | 1.89.0 | set by `rust-toolchain.toml` |
| platform-tools | v1.57, rust 1.95.0 | what `anchor build` selected and what the devnet loader accepted |
| `solana-sha256-hasher` | `=3.1.0` | anchor 1.x re-exports a slim `solana_program` shim with no hash module, so hashing needs its own crate |
| `ephemeral-rollups-sdk` | 0.17.0 when PER lands | latest, and safely past the 0.16.2 floor that fixed the `#[ephemeral]` macro issue |
| Arcium CLI | 0.14.1 | latest, installed alongside 0.13.2 rather than replacing it |

## Two traps worth writing down

**Do not run `arcup use`.** Arcium 0.14.1 is installed next to 0.13.2, and the
global `arcium` symlink deliberately still points at 0.13.2 because another
project's MXE on devnet cluster 456 was deployed under it. Call `arcium-0.14.1`
explicitly from this project. Switching the default would repoint that other
project's tooling without telling anyone.

**This builds on platform-tools v1.57, and that was verified by deploying.**
The history here is that a v1.54 (4.1.0-beta) toolchain was observed emitting
bytecode the devnet loader mishandles, faulting every instruction with an access
violation at deploy time including unchanged ones. Since v1.57 is newer than the
version that broke, the skeleton was deployed to devnet on day one specifically
to find out, and it deployed clean. So v1.57 is cleared for this program.

Getting there took two fixes worth remembering. `anchor build` replaced the
rustup toolchain link, removing `1.89.0-sbpf-solana-v1.52` and creating
`1.95.0-sbpf-solana-v1.57` pointed at the Solana release's own sbf dependencies.
While that download was still in flight the extracted tree had `rust` but no
`llvm`, and `cargo-build-sbf` panicked on an `Option::unwrap()` in
`toolchain.rs:381` rather than saying the toolchain was incomplete. Retrying
after the extract finished built first time. Forcing `--tools-version v1.52` is
not the fallback it looks like, because the rustup toolchain that version needs
has already been unlinked; re-linking it by hand would come first.

**Stale symlinks in `~/.cargo/bin` shadow version managers, twice on this box.**
`anchor` was hard linked straight to `anchor-1.0.2` instead of avm's dispatcher,
so `avm use` silently did nothing and every project got 1.0.2 regardless. It now
points at `~/.avm/bin/anchor`, which lets avm pick the CLI that matches
each project's own `anchor-lang`. The same shape of bug had `arcium` pinned to
0.10.3 while 0.13.2 was installed. Check what a version manager's binary
actually resolves to before believing its version output.
