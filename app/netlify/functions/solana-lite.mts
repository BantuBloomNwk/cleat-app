// The four Solana primitives this needs, and not the library they come in.
//
// @solana/web3.js cannot run in a serverless function here. Importing anything
// from it pulls in Connection, which pulls in rpc-websockets for a
// subscription layer nothing here uses, which does require() of an ESM uuid,
// which Node refuses outright. The function returns nothing at all and the
// platform reports a response it could not decode, which is the least
// informative failure an edge runtime can produce.
//
// What is actually needed is base58, an ed25519 signature, the legacy
// transaction wire format, and JSON-RPC over fetch. All four are small and
// specified, so they are here rather than dragged in behind a websocket
// client.
import { ed25519 } from "@noble/curves/ed25519";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error(`not base58: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  // Every leading '1' is a leading zero byte, which the bigint has dropped.
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Solana's compact-u16: seven bits a byte, high bit continues. */
function shortVec(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    if (n < 0x80) {
      out.push(n);
      return out;
    }
    out.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
}

export interface AccountRef {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * One instruction, one signer, one legacy transaction.
 *
 * Account order is not cosmetic: the runtime reads the header counts against
 * the position of each key, so signers come first, then writable, then
 * read only, and the program id sits at the end among the read only.
 */
export function buildSignedTx(opts: {
  secretKey: Uint8Array;
  programId: string;
  accounts: AccountRef[];
  data: Uint8Array;
  recentBlockhash: string;
}): { wire: Uint8Array; signature: string } {
  const payer = b58encode(opts.secretKey.slice(32, 64));

  const writableSigners = [payer];
  const readonlySigners: string[] = [];
  const writable: string[] = [];
  const readonly: string[] = [];
  for (const a of opts.accounts) {
    if (a.pubkey === payer) continue;
    if (a.isSigner) (a.isWritable ? writableSigners : readonlySigners).push(a.pubkey);
    else (a.isWritable ? writable : readonly).push(a.pubkey);
  }
  readonly.push(opts.programId);

  const keys = [...writableSigners, ...readonlySigners, ...writable, ...readonly];
  const index = (k: string) => keys.indexOf(k);

  const message: number[] = [
    writableSigners.length + readonlySigners.length,
    readonlySigners.length,
    readonly.length,
    ...shortVec(keys.length),
  ];
  for (const k of keys) message.push(...b58decode(k));
  message.push(...b58decode(opts.recentBlockhash));

  message.push(...shortVec(1));
  message.push(index(opts.programId));
  message.push(...shortVec(opts.accounts.length));
  for (const a of opts.accounts) message.push(index(a.pubkey));
  message.push(...shortVec(opts.data.length));
  message.push(...opts.data);

  const msg = Uint8Array.from(message);
  const sig = ed25519.sign(msg, opts.secretKey.slice(0, 32));

  return {
    wire: Uint8Array.from([...shortVec(1), ...sig, ...msg]),
    signature: b58encode(sig),
  };
}

/** JSON-RPC over fetch. No websocket, no subscription, no library. */
export async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "failed"}`);
  return body.result;
}

const toBytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
export { toBytes };
