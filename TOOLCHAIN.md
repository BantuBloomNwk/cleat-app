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

## Arcium on devnet cluster 456: what actually goes wrong

Written down because five separate theories were chased here and every one
of them was wrong, and the evidence that settled it was cheap to get and
came late.

### Rate limits look like a hang, not an error

`uploadCircuit` sends its chunks as fast as the event loop allows. Helius
answers 429 and the SDK retries with a backoff that never gives up, so the
process sits there with an empty log and no error for as long as you let
it. A 71KB circuit is 89 chunks.

Throttle the connection rather than the helper, because web3.js takes a
custom `fetch`:

```js
let chain = Promise.resolve();
const throttledFetch = (url, init) => {
  const turn = chain.then(() => new Promise((r) => setTimeout(r, 260)));
  chain = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
};
new Connection(rpc, { commitment: "confirmed", fetch: throttledFetch });
```

260ms for the upload. Then drop it to about 60 for anything else, because
a global queue also delays the send of a transaction whose blockhash was
fetched before it, and that surfaces as `Blockhash not found` on the
finalize after a long upload.

### A callback that returns Err throws away the answer

The natural way to write an Arcium callback is to verify the output and
return an error if verification fails. That is what we did, and for days
every failure read as our own `GateAborted` custom error, which says
nothing about why.

A callback that logs the verification result instead, and returns Ok
either way, prints the reason into the transaction log:

```
Program log: PROBE probe_a rejected: AnchorError { error_name: "AbortedComputation" }
```

Write one of those before theorising. It is the difference between a fact
and a sixth guess.

### Bisect with probes in one deploy, not one guess per deploy

A deploy here is roughly 4.7 SOL of buffer rent and half an hour of
upload, so guessing one circuit change at a time is expensive. Put several
circuits that differ by one step each into a single deploy and let them
say which step breaks.

Ours went: secret against a constant, secret against a public argument,
secret plus a public argument against another. The first one failed, which
meant none of the arithmetic anyone had been suspecting was involved.

### Enc<Shared, T> carries a key the circuit has to use

This was the actual bug, and the compiler printed it on every build:

```
warning: the value of input `exposure_bps.owner.public_key`
         is unused or could be optimized out
```

An `Enc<Shared, T>` carries the caller's x25519 public key so the circuit
can seal a result back to them. A circuit that only reveals a value never
touches that key, the compiler drops it, and the program goes on passing
it as an argument on every call.

Seal something back to `.owner` and the warning goes away:

```rust
pub fn gate_breach_v4(
    exposure_bps: Enc<Shared, u64>,
    effective_bps: u64,
    max_position_bps: u64,
) -> (Enc<Shared, u64>, bool) {
    let held = exposure_bps.to_arcis();
    let next = held + effective_bps;
    let breaches = next > max_position_bps;
    let updated = if breaches { held } else { next };
    (exposure_bps.owner.from_arcis(updated), breaches.reveal())
}
```

Read the revealed value off the end of the output rather than the front,
because the sealed value is now in front of it.

### Things that were suspected and were not the problem

Worth listing so they are not chased again: the cost of the circuit (the
reference circuit for adding two u8s is 470 million ACUs, so a large
number there means nothing), unfinalized MXE keys, the cluster refusing
secret comparisons, u16 against u64, a struct wrapper around the encrypted
value, and the arithmetic in the comparison. None of them.

## The gate: a reproduction, not a theory

Six circuit versions aborted. The one that settled it was not a seventh
version, it was a control.

### The reproduction

Take Ilowa's `init_pool_state_v4`, which runs on devnet cluster 456 today
under MXE `DWQWnzjNk7EhsADBkKeCn2vHVFWuf3tzhnvT1TXjuWfN`:

```rust
#[instruction]
pub fn control_init_pool() -> Enc<Mxe, PoolState> {
    Mxe::get().from_arcis(PoolState { yes: 0, no: 0 })
}
```

No input, so nothing about encryption on the way in can be wrong. Compile
it unchanged into a second program and run it on the same cluster under
MXE `DMNi8mRDCMDnnQv4q9WBsZPDxKN1dk26kDWWYw2nwLow`:

```
CONTROL rejected: AnchorError { error_name: "AbortedComputation",
                                error_code_number: 6000 }
```

Same cluster, same circuit, same compiler, same toolchain pin. One MXE
runs it and the other does not.

### What that rules out

Everything we spent six deploys on. The width of the number, a struct
against a bare value, the arithmetic, a bool against a tuple, whether the
caller's x25519 key is used, whether anything is sealed to the MXE. All of
those were varied and all of them died the same way, which should have
been the signal much earlier: when six dimensions give one answer, the
thing being varied is not the thing that is wrong.

### What it is not

The MXE looks healthy by every measure Arcium exposes. Status active,
cluster 456, the authority correct, `utilityPubkeys` populated with an
x25519 key and an ed25519 verifying key, and `getMXEPublicKey` returns a
real key. Its keygen computation is finalized. Asking the network to redo
the keygen is refused, in Arcium's own words:

```
MxeKeysAlreadySet: The MXE keys are already set, i.e. all the nodes of
the MXE cluster already agreed on the MXE keys.
```

So this is not an unfinalized MXE, not an unfinalized comp def, not a
missing key, and not the cluster refusing the work, since the cluster does
the same work for somebody else.

### The one difference found

Cleat's keygen computation account still exists and reads `finalized`.
Ilowa's is closed, which is the normal end state once a computation has
been consumed. Whether that is the cause or another symptom is not
something this end can tell.

### What to do with it

Report it with the control attached rather than keep rewriting the
circuit. A minimal reproduction where the same bytes succeed under one MXE
and fail under another, on one cluster, is worth more than six more
guesses, and there is nothing further to try from this side without
Arcium's help.
