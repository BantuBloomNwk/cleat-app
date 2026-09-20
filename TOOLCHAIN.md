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
| Arcium CLI | 0.14.1 | latest on npm since 2026-07-29, though the changelog stops at 0.13.2. Installed alongside rather than replacing it |

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

## Arcium on devnet: what actually goes wrong

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

## The gate: solved, and the answer was not where anyone looked

**Resolved 15 September 2026.** Six circuits came back as signed failures over
several days. Five theories were written up here and all five were wrong. The
answer was that the uploaded circuit was corrupt, and Arcium's node had been
saying so the whole time in a log line nobody read:

```
Program log: Computation failed for reason: CircuitFailure(CircuitSerialization).
```

It could not deserialize what it fetched. Reading the raw circuit account back
and diffing it against the file on disk:

```
total differing bytes 3947 of 34438
first differing runs: 10584..10584, 10592..10624, 10628..10628, 10640..10672
runs total 2359
onchain at 10584: 0000000000000000000000000000000000000000000000000000000000000000
local   at 10584: 2000000000000000862a1cc88f165839fa656d99168556a3de55863cb39c8aff
```

Zeros on chain where the artifact had data. The upload had dropped chunks.

### Three faults in uploadCircuit, fatal only together

Reading `@arcium-hq/client/src/onchain.ts`:

1. **One blockhash for the whole loop.** `uploadToCircuitAcc` fetches a single
   blockhash before its send loop and reuses it for every chunk. A blockhash
   lives about a minute. Behind any rate limiting a forty chunk upload takes
   longer than that, and the cluster drops whatever is still in flight when it
   expires. Nothing throws. The function returns the signatures it managed.

2. **It finalises regardless.** `uploadCircuit` sends a finalise transaction at
   the end whether or not the chunks arrived, so the first partial upload seals
   that circuit permanently. After that every write returns
   `ComputationDefinitionAlreadyCompleted` and the only way forward is a new
   circuit name.

3. **Retrying repairs nothing.** `uploadToCircuitAcc` returns early when the
   account merely exists at the right size. It checks `data.length` and never
   the contents, so once the space is allocated every later upload writes
   nothing at all and reports success.

This repo made the first fault certain by adding a 260ms gap in front of every
RPC call to stop Helius answering 429. That was a real fix for a real problem
and it converted an intermittent upload bug into a deterministic one. The same
stale blockhash failure had already been found and fixed for the finalise
transaction, and nobody went back for the chunks.

It also explains the control experiment that looked so damning. A circuit of
Ilowa's copied byte for byte failed here too, which was read as proof that the
fault was in this MXE. It was proof of nothing: the circuit was never the
variable, the upload path was, and both circuits went through the same one.

### What replaced it

`scripts/circuit-repair.mjs` does the upload itself: `initRawCircuitAcc`,
`embiggenRawCircuitAcc` until the account is big enough, then one
`uploadCircuit` instruction per 814 byte window, serialised, with a fresh
blockhash every eight. Then it reads the bytes back, diffs them against the
file, and only finalises when they match. Control uploaded 43 of 43 windows
clean. The gate, 116 of 116.

```
pass 1: 116 of 116 windows to write
pass 2: 0 of 116 windows to write
on chain matches the artifact
finalized
```

And then, first time of asking:

```
3% of tech, with 1% already held there    cleared   asked 3%  allowed 3%
3% of tech, with 14% already held there   refused   asked 3%  allowed 0%
```

### The cluster detour, recorded because it cost four hours

Before the real cause was found, the theory was that cluster 456 was at fault:
two nodes carrying 1,283 MXEs, and Cerberus aborts rather than return a wrong
answer when a node's share does not check out. Arcium's own docs name cluster
migration as the recovery for exactly that.

Cluster 789 looked ideal, three nodes and nearly empty, and it stalled four
times. `arcium mempool 789` explains why: tier **Tiny**, one computation in
flight at a time, and one already stuck in its execpool. It has one MXE
because nobody successfully uses it. **Registered nodes and serving nodes are
not the same thing, and `list-clusters` does not distinguish them. Read the
tier and the pools before choosing.**

Migrating to 4500 succeeded and changed nothing, which is the useful part:
`migrate-cluster` **recovers** the existing key material onto the new cluster
rather than generating fresh keys. Arcium's docs say so plainly. So migration
can never fix a key problem, and the fact that it did not fix ours was
evidence the keys were never wrong.

The MXE stays on 4500. Three nodes against 456's two, seven MXEs against
1,282, and five consecutive successful computations on it. 456 is the only
devnet cluster Arcium's documentation names, which is worth knowing, but
working beats documented.

### And then 4500 stopped working, 2026-09-20

Reversed. The MXE is back on 456. Recorded because the reversal is more useful
than the original decision was.

Five days after the move, every computation queued to 4500 sat in its execpool
and was never executed. Three of them, across two different owners and two
different scripts, one of which was the unchanged script that had produced
verdicts on 15 September. Meanwhile `list-clusters` reported 4500 as 3/3 nodes
active and its mempool as empty, which is exactly the trap named above. The
nodes accept work and never finish it, and nothing on chain says so directly.

**How to tell a serving cluster from a registered one, cheaply.** Not
`test-cluster`, which does not work: it generates a temp project and deploys
against `http://127.0.0.1:8899` whatever `--rpc-url` you hand it, so it fails on
a local validator it never started and charges you a program deploy first. Read
the chain instead, which costs nothing:

1. `arcium execpool <cluster>`. Work sitting there is work nobody is doing. An
   empty execpool on a busy cluster is the healthy shape.
2. `getSignaturesForAddress` on the cluster account, then read the logs of the
   recent ones. What you want to see is `Instruction: CallbackComputation`
   succeeding, and ideally a second one failing right after it with
   `AlreadyCallbackedComputation` (error 6204). That error is a good sign: it
   means several nodes raced to deliver a finished result and one won. A cluster
   producing 6204s is a cluster doing work.
3. Only then migrate.

On 456 those callbacks were landing about five seconds apart. On 4500 the
cluster account had not been touched in 110 hours by anyone but us.

**`migrate-cluster` back to 456 cost 0.09 SOL and took a few minutes.** It
deploys a temporary MXE, waits for recovery peers to submit key shares, runs the
recovery computation, swaps the cluster on the real MXE and closes the temporary
program, refunding its rent. The recovered x25519 key was byte identical to the
old one, which is the documented behaviour and means nothing encrypted to the
MXE needs redoing.

**What changes in the code on a cluster move.** Only three addresses: the
mempool, the execpool and the cluster account. The MXE account, the comp def,
the fee pool, the clock and the sign PDA are all derived from the program or are
global, so they stay. `node scripts/gate-addresses.mjs <cluster>` prints the
full set. The three places that hold them are
`app/netlify/functions/gate.mts`, `scripts/gate-sandbox.mjs` and
`scripts/gate-run.mjs`.

### Publishing the IDL, which is chunked and lies about succeeding

Anchor 1.x does not update the published IDL when you upgrade a program. It is
a separate step, against a Program Metadata account (`ProgM6JCC…`) rather than
the legacy `anchor:idl` PDA, and `anchor idl upgrade` can never work on a
program that already has one because it tries to initialise what exists.

**The payload is deterministic, so verify instead of believing.** What lands on
chain is `zlib.compress(target/idl/cleat.json, level 6)` at **byte 96** of the
account. So:

    python3 -c "import zlib;open('/tmp/want','wb').write(zlib.compress(open('target/idl/cleat.json','rb').read(),6))"

then fetch the account with `getAccountInfo`, take `raw[96:]` and compare byte
for byte. **Do this every time.** Both of these tools print `[Success]` on writes
that only partly landed.

**Close and init is not reliable at this size.** It chunks straight into the
live account and drops writes. Three attempts on 2026-09-20 left 8,773 to 9,740
bytes of the 15,409 missing, all of them zero-filled holes, and raising the
priority fee from 50,000 to 500,000 made no difference. It happened to work at
14,360 bytes earlier the same day, which is the trap: it fails by size and by
luck rather than by configuration.

**Use the buffer route instead.** The chunking then happens into a buffer you
can inspect and repair, and the swap into the live account is a single
instruction:

1. `program-metadata create-buffer target/idl/cleat.json --rpc <url> -k <keypair>`
   The buffer address is in the output, not the last base58 string on the line,
   which is the authority. `program-metadata list-buffers <authority>` is the
   reliable way to find it.
2. Verify the buffer the same way, at offset 96. Repair with
   `program-metadata update-buffer <buffer> <file>` and verify again.
3. `anchor idl write-buffer <program> -b <buffer> --close-buffer`
4. Verify the metadata account, then `anchor idl fetch` as the outsider's check.

That worked first time where close and init had failed three times.

**The CLI underneath is already on disk** at
`~/.npm/_npx/336f3017a2a5e128/node_modules/.bin/program-metadata` and exposes
commands Anchor does not: `list-buffers`, `close-buffer`, `fetch-buffer`,
`update-buffer` and `--export instruction-list`. Run `list-buffers` after any
failed attempt; a failed run on 2026-09-20 turned up **five** orphaned buffers
holding 0.074 SOL each, only two of which anyone knew about.

### What to take from this

**An upload that reports success is not an upload that happened.** Anything
written to a chain in pieces needs reading back and comparing before it is
treated as done. Five theories were argued from the shape of the failure when
the node had already said the reason out loud, in a log line one
`getTransaction` away.

