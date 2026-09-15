// What the network actually said, rather than what our callback made of it.
//
// control-run reports "AbortedComputation", which is our own program's error
// after Arcium hands it a failed computation. Arcium itself emits a
// FinalizeComputationEvent carrying an execution status, and the node may log
// a reason beyond the bare abort. This dumps every log the Arcium program
// wrote for a computation, so the difference between "the circuit was too
// expensive", "the node could not fetch it", and "the key material is wrong"
// stops being invisible.
//
// Run: node scripts/why-aborted.mjs <computationAccountPubkey>
import { Connection, PublicKey } from "@solana/web3.js";
import { baseRpc } from "./rpc.mjs";

const ARCIUM = "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ";

const target = process.argv[2];
if (!target) {
  console.error("need a computation account pubkey");
  process.exit(1);
}

const c = new Connection(baseRpc(), "confirmed");
const sigs = await c.getSignaturesForAddress(new PublicKey(target), { limit: 25 });
console.log(`${sigs.length} transactions touched ${target}\n`);

for (const s of sigs.reverse()) {
  const tx = await c.getTransaction(s.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const logs = tx?.meta?.logMessages ?? [];
  if (!logs.length) continue;
  console.log(`── ${s.signature.slice(0, 18)}…  slot ${s.slot}  ${s.err ? "FAILED" : "ok"}`);
  for (const l of logs) {
    // Everything the Arcium program itself said, plus any of ours that
    // mentions the outcome.
    if (/Program log:/.test(l) || /invoke|success|failed/.test(l)) {
      const t = l.replace(/^Program log: /, "  ");
      if (/Arcj82pX|Instruction:|Error|abort|Abort|fail|Fail|reason|Reason|status|Status|CONTROL/.test(t)) {
        console.log("   " + t.slice(0, 200));
      }
    }
  }
  console.log();
}
