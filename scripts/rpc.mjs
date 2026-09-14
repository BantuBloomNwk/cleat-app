import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/// Where the endpoint comes from.
///
/// Never the public devnet endpoint. It rate limits a circuit upload into
/// failure, it drops delegation transactions, and it silently truncates
/// paginated reads, so a run against it fails in ways that look like bugs in
/// this repo. Point CLEAT_RPC at a provider endpoint before running anything
/// here.
///
/// Checked in order: the environment, a .env beside this repo, then
/// ~/.config/cleat/rpc. Nothing here reads a path outside the repo or the
/// user's own config directory.
const KEY = "SOLANA_RPC_URL=";

function fromEnvFile(file) {
  try {
    const line = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(KEY));
    return line ? line.slice(KEY.length).trim() : null;
  } catch {
    return null;
  }
}

export function baseRpc() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const found =
    process.env.CLEAT_RPC ||
    process.env.SOLANA_RPC_URL ||
    fromEnvFile(path.join(here, "..", ".env")) ||
    (() => {
      try {
        return fs
          .readFileSync(path.join(os.homedir(), ".config/cleat/rpc"), "utf8")
          .trim();
      } catch {
        return null;
      }
    })();

  if (!found) {
    throw new Error(
      "no rpc endpoint. set CLEAT_RPC, or put SOLANA_RPC_URL= in .env at the repo root. " +
        "the public devnet endpoint will not work for this."
    );
  }
  return found;
}

export default baseRpc;
